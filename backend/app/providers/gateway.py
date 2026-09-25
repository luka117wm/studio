"""Единая точка платного вызова (принципы 5, 6, 8) и сборка слоя провайдеров из конфигов.

Порядок вызова: маршрут → оценка → хэш входов → кэш (`cached`, $0) → бюджет (`refused`) → резерв
(`estimated`) → вызов → `charged` или `failed` → файл результата в `media/` и строка `assets`.
Бюджет и резерв — одна транзакция `BEGIN IMMEDIATE`: два воркера не пройдут в лимит вдвоём.
Отказ по бюджету — `BudgetExceeded`, без перехода на модель дешевле. Соединения с БД — свои,
короткие, в потоке вызывающего (L-014).
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
from app.providers.base import AnyRequest, Cost, KeyStatus, Provider, Result, Route, RouteError
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
    channel: str | None = None  # по умолчанию — канал выпуска
    shot_id: str | None = None
    job_id: str | None = None


@dataclass(frozen=True)
class CallOutcome:
    route: Route
    cost: Cost  # факт для `charged`; для `cached` — сколько стоил бы вызов
    status: Literal["charged", "cached"]
    input_hash: str
    asset_path: Path | None  # файл результата; None — результат без файла или вызов без выпуска
    result: Result | None  # None у `cached`


def input_hash(route: Route, request: AnyRequest) -> str:
    """Хэш входов (принцип 8): модель, параметры маршрута и весь запрос — версии канона, промпт,
    референсы, seed. Канонический JSON: одинаковые входы дают одинаковый хэш."""
    payload = {
        "provider": route.provider,
        "model": route.model,
        "params": route.params,
        "request": request.model_dump(mode="json"),
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
        episode_id: str,
        job_id: str | None = None,
    ) -> None:
        """Проверка до постановки джоба (`POST /api/jobs`). Отказ пишет строки `refused`."""
        channel = self._channel_of(conn, episode_id)
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
            channel = ctx.channel or self._require_channel(conn, ctx.episode_id)
            entry = LedgerContext(channel, ctx.episode_id, ctx.stage, ctx.job_id, digest)
            cached = self._cached_asset(conn, route.stage, digest)
            if cached is not None:
                with conn:
                    ledger.record(conn, entry, estimate, "cached", ledger.new_call_id())
                log.info("%s/%s: cache hit %s", route.stage, route.key, digest[:12])
                return CallOutcome(route, estimate, "cached", digest, cached, None)

            call_id = ledger.new_call_id()
            self._reserve(conn, entry, estimate, call_id)
            provider = self.registry.provider(route.provider)
            try:
                result = await provider.call(route, request)
            except BaseException:
                with conn:
                    ledger.settle_failed(conn, call_id)
                raise
            actual = self.pricing.cost(route, result.usage)
            with conn:
                ledger.settle_charged(conn, call_id, actual)
            asset = None
            if result.data is not None and ctx.episode_id is not None:
                asset = self._store(conn, channel, ctx, route, digest, result)
            return CallOutcome(route, actual, "charged", digest, asset, result)
        finally:
            conn.close()

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
        provider = self.registry.provider(route.provider)
        return self.pricing.cost(route, provider.usage(route, request))

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
    ) -> Path:
        """Файл результата — в `media/<этап>/`, строка `assets` — индекс кэша (принцип 8)."""
        assert ctx.episode_id is not None and result.data is not None
        name = f"{ctx.shot_id or route.stage}-{digest[:16]}.{result.ext or 'bin'}"
        path = self.paths.media_dir(channel, ctx.episode_id) / route.stage / name
        write_bytes_atomic(path, result.data)
        with conn:
            version = conn.execute(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM assets"
                " WHERE episode_id = ? AND shot_id IS ? AND kind = ?",
                (ctx.episode_id, ctx.shot_id, route.stage),
            ).fetchone()[0]
            conn.execute(
                "INSERT INTO assets (id, episode_id, shot_id, kind, version, path, input_hash,"
                " status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?)",
                (
                    uuid.uuid4().hex,
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

    def _require_channel(self, conn: sqlite3.Connection, episode_id: str | None) -> str:
        if episode_id is None:
            raise RouteError(
                "Платный вызов без выпуска должен назвать канал (CallContext.channel)."
            )
        return self._channel_of(conn, episode_id)


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
