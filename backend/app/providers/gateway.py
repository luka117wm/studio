"""Единая точка платного вызова (принципы 5, 6, 8) и сборка слоя провайдеров из конфигов.

Порядок вызова: маршрут → оценка (и лимит референсов) → хэш входов → кэш (`cached`, $0) →
референсы с диска → бюджет (`refused`) → резерв (`estimated`) → вызов → `charged` или `failed` →
файл результата и строка `assets`. Бюджет и резерв — одна транзакция `BEGIN IMMEDIATE`: два
воркера не пройдут в лимит вдвоём. Отказ по бюджету — `BudgetExceeded`, без перехода на модель
дешевле. Соединения с БД — свои, короткие, в потоке вызывающего (L-014).

Вызов уровня канала (M5.3) — `CallContext(channel=…)` без выпуска: файл — в каталог канона
канала, строка `assets` и журнала — без выпуска, бюджет — только месячный. Референсы — только
файлы канона канала (принципы 9, 13), в ключ кэша идут их хэши. Картинка вопроса `vision` (M6.6)
— только файл своего выпуска (версия кадра), в ключ кэша идёт её хэш; ответ ложится файлом, и
перепроверка той же картинки тем же вопросом берётся из кэша.
"""

import asyncio
import hashlib
import json
import logging
import sqlite3
import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.cost import ledger
from app.cost.budget import BudgetExceeded, check_budget, load_budgets
from app.cost.ledger import LedgerContext
from app.cost.pricing import Pricing, today_utc
from app.providers.anthropic import AnthropicProvider
from app.providers.base import (
    AnyRequest,
    Cost,
    ImageRef,
    ImageRequest,
    KeyStatus,
    Provider,
    RefImage,
    Result,
    Route,
    RouteError,
    VisionRequest,
    image_mime,
)
from app.providers.elevenlabs import ElevenLabsProvider
from app.providers.fake import FakeProvider
from app.providers.gemini import GeminiProvider
from app.providers.registry import Profile, Registry, load_providers_config
from app.settings import Settings
from app.storage.atomic import write_bytes_atomic
from app.storage.db import connect, now_iso
from app.storage.paths import StudioPaths

log = logging.getLogger(__name__)

# Статус ключей для шапки (`GET /api/providers/status`): бесплатные запросы, но не на каждый показ.
KEY_STATUS_TTL_S = 60.0


@dataclass(frozen=True)
class CallContext:
    stage: str
    episode_id: str | None = None
    channel: str | None = None  # по умолчанию — канал выпуска; без выпуска — обязателен
    shot_id: str | None = None
    job_id: str | None = None
    # Куда положить файл результата: внутри выпуска (`media/…`) или, без выпуска, внутри канала
    # (`canon/anchors/…`). По умолчанию — `media/<этап>/` или `canon/cache/<этап>/`.
    asset_dir: Path | None = None


@dataclass(frozen=True)
class CallOutcome:
    route: Route
    cost: Cost  # факт для `charged`; для `cached` — сколько стоил бы вызов
    status: Literal["charged", "cached"]
    input_hash: str
    asset_path: Path | None  # файл результата; None — результат без файла
    result: Result | None  # None у `cached`


def input_hash(route: Route, request: AnyRequest) -> str:
    """Хэш входов (принцип 8): модель, параметры маршрута и весь запрос — версии канона, промпт,
    референсы (хэши файлов, не пути), seed. Канонический JSON: одинаковые входы — одинаковый хэш."""
    dumped = request.model_dump(mode="json")
    if isinstance(request, ImageRequest):
        dumped["refs"] = [ref.sha256 for ref in request.refs]
    if isinstance(request, VisionRequest):
        dumped["image"] = request.image.sha256
    payload = {
        "provider": route.provider,
        "model": route.model,
        "params": route.params,
        "request": dumped,
    }
    text = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class Gateway:
    def __init__(self, registry: Registry, pricing: Pricing, paths: StudioPaths) -> None:
        self.registry = registry
        self.pricing = pricing
        self.paths = paths
        self._key_statuses: tuple[float, list[KeyStatus]] | None = None

    # --- без сети -----------------------------------------------------------------------------

    def resolve(
        self, stage: str, profile: Profile | None = None, override: str | None = None
    ) -> Route:
        return self.registry.resolve(stage, profile, override)

    def estimate(
        self,
        stage: str,
        request: AnyRequest,
        *,
        profile: Profile | None = None,
        override: str | None = None,
    ) -> Cost:
        """Цена до клика: по ней фронт собирает строку кнопки, API проверяет бюджет."""
        route = self.resolve(stage, profile, override)
        return self._estimate(route, request)

    def check_budget(
        self,
        conn: sqlite3.Connection,
        cost: Cost,
        *,
        episode_id: str | None = None,
        channel: str | None = None,
        job_id: str | None = None,
    ) -> None:
        """Проверка до постановки джоба (`POST /api/jobs`). Отказ пишет строки `refused`. Без
        выпуска (вызов уровня канала) — только месячный бюджет канала."""
        channel = self._call_channel(conn, episode_id, channel)
        budgets = load_budgets(self.paths, channel)
        try:
            check_budget(
                conn,
                budgets,
                channel=channel,
                episode_id=episode_id,
                stage=cost.stage,
                cost_micro=cost.usd_micro,
            )
        except BudgetExceeded:
            with conn:
                ctx = LedgerContext(channel, episode_id, cost.stage, job_id)
                ledger.record(conn, ctx, cost, "refused", ledger.new_call_id())
            raise

    # --- вызов --------------------------------------------------------------------------------

    async def call(
        self,
        ctx: CallContext,
        request: AnyRequest,
        *,
        profile: Profile | None = None,
        override: str | None = None,
    ) -> CallOutcome:
        route = self.resolve(ctx.stage, profile, override)
        estimate = self._estimate(route, request)
        digest = input_hash(route, request)
        conn = connect(self.paths.db_path)
        try:
            channel = self._call_channel(conn, ctx.episode_id, ctx.channel)
            asset_dir = self._asset_dir(channel, ctx, route)
            # Кадр — только у вызова выпуска: у листов портретов `shot_id` — имя файла кандидата.
            shot = ctx.shot_id if ctx.episode_id is not None else None
            entry = LedgerContext(channel, ctx.episode_id, ctx.stage, ctx.job_id, digest, shot)
            cached = self._cached_asset(conn, route.stage, digest)
            if cached is not None:
                with conn:
                    ledger.record(conn, entry, estimate, "cached", ledger.new_call_id())
                log.info("%s/%s: cache hit %s", route.stage, route.key, digest[:12])
                return CallOutcome(route, estimate, "cached", digest, cached, None)

            refs = self._load_refs(channel, ctx, request)
            call_id = ledger.new_call_id()
            self._reserve(conn, entry, estimate, call_id)
            provider = self.registry.provider(route.provider)
            try:
                result = await provider.call(route, request, refs)
            except BaseException:
                with conn:
                    ledger.settle_failed(conn, call_id)
                raise
            actual = self.pricing.cost(route, result.usage)
            with conn:
                ledger.settle_charged(conn, call_id, actual)
            asset = None
            if result.data is not None:
                asset = self._store(conn, channel, ctx, route, digest, result, asset_dir)
            return CallOutcome(route, actual, "charged", digest, asset, result)
        finally:
            conn.close()

    def image_ref(self, path: Path) -> ImageRef:
        """Референс для `ImageRequest.refs`: путь относительно `data/` и sha256 содержимого."""
        try:
            relative = path.resolve().relative_to(self.paths.root.resolve())
        except ValueError:
            raise RouteError(f"Референс {path} лежит вне каталога данных.") from None
        if not path.is_file():
            raise RouteError(f"Референс {relative.as_posix()} не найден.")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        return ImageRef(path=relative.as_posix(), sha256=digest)

    async def check_keys(self, *, max_age_s: float = 0) -> list[KeyStatus]:
        """Проверка ключей всех провайдеров из конфига, кроме тестового, параллельно. Результат
        не старше `max_age_s` отдаётся из памяти (0 — проверить заново)."""
        cached = self._key_statuses
        if cached is not None and time.monotonic() - cached[0] <= max_age_s:
            return cached[1]
        names = sorted({route.provider for route in self.registry.routes()} - {FakeProvider.name})
        statuses = list(
            await asyncio.gather(
                *(self.registry.provider(n).check(self.registry.models_of(n)) for n in names)
            )
        )
        self._key_statuses = (time.monotonic(), statuses)
        return statuses

    # --- внутреннее ---------------------------------------------------------------------------

    def _estimate(self, route: Route, request: AnyRequest) -> Cost:
        if request.kind != route.kind:
            raise RouteError(
                f"Этап «{route.stage}» принимает запросы «{route.kind}», а пришёл «{request.kind}»."
            )
        if isinstance(request, ImageRequest) and request.refs:
            limit = route.max_refs or 0
            if len(request.refs) > limit:
                allowed = f"не больше {limit}" if limit else "без референсов"
                raise RouteError(
                    f"Референсов {len(request.refs)}, а модель {route.model} этапа «{route.stage}»"
                    f" принимает {allowed} — уберите лишние (лимит — max_refs в"
                    " config/providers.yaml)."
                )
        provider = self.registry.provider(route.provider)
        return self.pricing.cost(route, provider.usage(route, request))

    def _load_refs(self, channel: str, ctx: CallContext, request: AnyRequest) -> list[RefImage]:
        """Байты картинок для провайдера. Референсы кадра — только файлы канона канала (принципы
        9, 13); картинка вопроса `vision` — только файл своего выпуска. Файл должен быть на месте
        и совпадать с хэшем запроса — иначе кэш соврал бы (принцип 8)."""
        if isinstance(request, VisionRequest):
            if ctx.episode_id is None:
                raise RouteError("Вопрос о картинке задаётся только в выпуске: назовите выпуск.")
            episode = self.paths.episode_dir(channel, ctx.episode_id).resolve()
            ref = request.image
            if not (self.paths.root / ref.path).resolve().is_relative_to(episode):
                raise RouteError(
                    f"Картинка {ref.path} — не из выпуска {ctx.episode_id}: спрашивать можно только"
                    " о картинках своего выпуска."
                )
            return [self._read_ref(ref, "Картинка", "не найдена", "изменилась")]
        if not isinstance(request, ImageRequest):
            return []
        canon = self.paths.canon_dir(channel).resolve()
        loaded: list[RefImage] = []
        for ref in request.refs:
            path = (self.paths.root / ref.path).resolve()
            if not path.is_relative_to(canon):
                raise RouteError(
                    f"Референс {ref.path} — не из канона канала {channel}: референсами служат"
                    " только опорные портреты и кадры стиля (принцип 13)."
                )
            loaded.append(self._read_ref(ref, "Референс", "не найден", "изменился"))
        return loaded

    def _read_ref(self, ref: ImageRef, what: str, missing: str, changed: str) -> RefImage:
        path = (self.paths.root / ref.path).resolve()
        if not path.is_file():
            raise RouteError(f"{what} {ref.path} {missing} — пересоберите запрос.")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != ref.sha256:
            raise RouteError(
                f"{what} {ref.path} {changed} после расчёта хэша — пересоберите запрос."
            )
        mime_type = image_mime(data)
        if mime_type is None:
            raise RouteError(f"{what} {ref.path} — не PNG, JPEG или WEBP.")
        return RefImage(data=data, mime_type=mime_type)

    def _asset_dir(self, channel: str, ctx: CallContext, route: Route) -> Path:
        """Каталог файла результата: внутри выпуска или, без выпуска, внутри канона канала."""
        if ctx.episode_id is not None:
            home = self.paths.episode_dir(channel, ctx.episode_id)
            default = self.paths.media_dir(channel, ctx.episode_id) / route.stage
        else:
            home = self.paths.canon_dir(channel)
            default = self.paths.canon_cache_dir(channel, route.stage)
        if ctx.asset_dir is None:
            return default
        if not ctx.asset_dir.resolve().is_relative_to(home.resolve()):
            raise RouteError(
                f"Каталог результата {ctx.asset_dir} — вне {home.relative_to(self.paths.root)}:"
                " файлы вызова лежат в своём выпуске или в каноне своего канала."
            )
        return ctx.asset_dir

    def _reserve(
        self, conn: sqlite3.Connection, entry: LedgerContext, estimate: Cost, call_id: str
    ) -> None:
        """Бюджет и резерв одной транзакцией; отказ — строки `refused` и `BudgetExceeded`."""
        budgets = load_budgets(self.paths, entry.channel)
        conn.execute("BEGIN IMMEDIATE")
        try:
            try:
                check_budget(
                    conn,
                    budgets,
                    channel=entry.channel,
                    episode_id=entry.episode_id,
                    stage=entry.stage,
                    cost_micro=estimate.usd_micro,
                )
            except BudgetExceeded:
                ledger.record(conn, entry, estimate, "refused", call_id)
                conn.commit()
                raise
            ledger.record(conn, entry, estimate, "estimated", call_id)
            conn.commit()
        finally:
            if conn.in_transaction:
                conn.rollback()

    def _cached_asset(self, conn: sqlite3.Connection, kind: str, digest: str) -> Path | None:
        """Готовый ассет с тем же хэшем входов, чей файл на месте."""
        rows = conn.execute(
            "SELECT path FROM assets WHERE kind = ? AND input_hash = ? ORDER BY rowid DESC",
            (kind, digest),
        ).fetchall()
        for row in rows:
            path: Path = self.paths.root / str(row["path"])
            if path.is_file():
                return path
        return None

    def _store(
        self,
        conn: sqlite3.Connection,
        channel: str,
        ctx: CallContext,
        route: Route,
        digest: str,
        result: Result,
        asset_dir: Path,
    ) -> Path:
        """Файл результата — в `asset_dir`, строка `assets` — индекс кэша (принцип 8)."""
        assert result.data is not None
        name = f"{ctx.shot_id or route.stage}-{digest[:16]}.{result.ext or 'bin'}"
        path = asset_dir / name
        write_bytes_atomic(path, result.data)
        with conn:
            version = conn.execute(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM assets"
                " WHERE channel = ? AND episode_id IS ? AND shot_id IS ? AND kind = ?",
                (channel, ctx.episode_id, ctx.shot_id, route.stage),
            ).fetchone()[0]
            conn.execute(
                "INSERT INTO assets (id, channel, episode_id, shot_id, kind, version, path,"
                " input_hash, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)",
                (
                    uuid.uuid4().hex,
                    channel,
                    ctx.episode_id,
                    ctx.shot_id,
                    route.stage,
                    version,
                    path.relative_to(self.paths.root).as_posix(),
                    digest,
                    now_iso(),
                ),
            )
        return path

    @staticmethod
    def _channel_of(conn: sqlite3.Connection, episode_id: str) -> str:
        row = conn.execute("SELECT channel FROM episodes WHERE id = ?", (episode_id,)).fetchone()
        if row is None:
            raise RouteError(f"Выпуск «{episode_id}» не найден.")
        return str(row["channel"])

    def _call_channel(
        self, conn: sqlite3.Connection, episode_id: str | None, channel: str | None
    ) -> str:
        """Канал вызова: канал выпуска или названный. Без выпуска канал обязателен и должен быть;
        с выпуском — совпадать с каналом выпуска (каналы изолированы, принцип 9)."""
        if episode_id is not None:
            own = self._channel_of(conn, episode_id)
            if channel is not None and channel != own:
                raise RouteError(
                    f"Выпуск «{episode_id}» — канала {own}, а вызов назвал канал {channel}."
                )
            return own
        if channel is None:
            raise RouteError(
                "Платный вызов без выпуска должен назвать канал (CallContext.channel)."
            )
        row = conn.execute("SELECT 1 FROM channels WHERE id = ?", (channel,)).fetchone()
        if row is None:
            raise RouteError(f"Канал «{channel}» не найден.")
        return channel


def default_providers(settings: Settings) -> dict[str, Provider]:
    return {
        "anthropic": AnthropicProvider(settings.anthropic_api_key),
        "gemini": GeminiProvider(settings.gemini_api_key),
        "elevenlabs": ElevenLabsProvider(settings.elevenlabs_api_key),
        "fake": FakeProvider(),
    }


def build_gateway(
    settings: Settings, paths: StudioPaths, providers: Mapping[str, Provider] | None = None
) -> Gateway:
    """Конфиги → gateway. Любая ошибка конфига — `ConfigError`: приложение не стартует."""
    config = load_providers_config(settings.config_dir / "providers.yaml")
    pricing = Pricing.load(
        settings.config_dir / "pricing.yaml", stale_days=settings.pricing_stale_days
    )
    registry = Registry(config, default_providers(settings) if providers is None else providers)
    for route in registry.routes():
        pricing.check_route(route)
    for stale in pricing.stale(today_utc()):
        log.warning(
            "pricing: %s/%s checked %s (%d days ago) — verify config/pricing.yaml",
            stale.provider,
            stale.model,
            stale.checked_at,
            stale.age_days,
        )
    return Gateway(registry, pricing, paths)
