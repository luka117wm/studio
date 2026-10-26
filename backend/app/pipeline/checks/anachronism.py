"""Проверка анахронизмов (M6.6; устав M6, решение 7): нет ли в кадре того, чего в эпохе быть не
может.

Вопрос к дешёвой VLM (этап `check`, модель — `config/providers.yaml`): миниатюра версии кадра 320
и список `forbidden` эпохи кадра по прибитой версии канона, ответ строго `{"found": [...]}`.
Найденное засчитывается, только если похоже на пункт списка (rapidfuzz, порог —
`config/checks.yaml`), и пишется формулировкой канона; чужое отбрасывается и идёт в журнал: модель
не придумывает новые запреты (L-036 — проверять кодом, а не надеждой на промпт). Непустое —
`suspect`, пометка `anachronism_suspect`; ничего не блокируется и в канон не добавляется.

Деньги — через шлюз: оценка входит в цену кадра до очереди, строка журнала — этап `check` с кадром
и джобом, перепроверка той же картинки тем же вопросом — из кэша за $0. Выключатель —
`profile.json → checks.anachronism`: выключенная не платит и пишет `off`. Сбой (ответ не
разобран, отказ модели, сеть, бюджет в момент вызова) — `failed` с причиной: кадр не помечается,
джоб не падает. Контракт — `docs/generation.md`, «Проверка анахронизмов».
"""

import json
import logging
from collections.abc import Sequence
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import Field, StrictStr, ValidationError
from rapidfuzz import fuzz, process, utils

from app.cost.budget import BudgetExceeded
from app.jobs.worker import TransientError
from app.models.channel import ChannelProfile
from app.models.checks_config import AnachronismConfig
from app.models.director import CanonRef, StrictModel
from app.models.project import AnachronismCheck
from app.pipeline.bridge.prompts import PROMPTS_DIR, PromptLibrary, load_templates
from app.providers.base import Cost, ImageRef, ProviderError, RouteError, VisionRequest
from app.providers.gateway import CallContext, Gateway
from app.storage import canon_store
from app.storage.atomic import read_json
from app.storage.canon_store import CanonRefError
from app.storage.db import now_iso
from app.storage.paths import StudioPaths

log = logging.getLogger(__name__)

CHECK_STAGE = "check"  # этап `config/providers.yaml`
TEMPLATE = "anachronism_check"
# Лимит ответа, если маршрут его не назвал (`params.max_output_tokens`).
DEFAULT_MAX_OUTPUT_TOKENS = 256
RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"found": {"type": "array", "items": {"type": "string"}}},
    "required": ["found"],
}
# Картинка для оценки до вызова: цена от её содержимого не зависит, файл не читается.
_ESTIMATE_IMAGE = ImageRef(path="estimate", sha256="0" * 64)


class AnachronismOrder(StrictModel):
    """Что спросить о кадре: эпоха по прибитой версии канона — ссылка, место и годы для промпта,
    список `forbidden`. Собирается при постановке и лежит в заказе джоба."""

    period: str  # `periods/<эпоха>/vNNN`
    setting: str = Field(min_length=1)  # «Caribbean Sea, 1716»
    forbidden: list[str] = Field(min_length=1)


class AnswerError(ValueError):
    """Ответ модели — не ровно `{"found": [строки]}`."""


class _Answer(StrictModel):
    found: list[StrictStr]


# --- заказ ---------------------------------------------------------------------------------------


def enabled(paths: StudioPaths, channel: str) -> bool:
    """Включена ли проверка в профиле канала (`checks.anachronism`, по умолчанию — да)."""
    profile = ChannelProfile.model_validate(read_json(paths.profile_path(channel)))
    return profile.effective_checks.anachronism


def order_for(
    paths: StudioPaths, channel: str, canon_ref: CanonRef, period_id: str
) -> AnachronismOrder | None:
    """Вопрос о кадре эпохи `period_id` по прибитой версии; проверка выключена в профиле, эпохи
    нет в `canon_ref` или список пуст — None (проверки не будет, статус `off`)."""
    if not enabled(paths, channel):
        return None
    return period_order(paths, channel, canon_ref, period_id)


def period_order(
    paths: StudioPaths, channel: str, canon_ref: CanonRef, period_id: str
) -> AnachronismOrder | None:
    """Вопрос об эпохе `period_id` по прибитой версии без оглядки на выключатель — для цены вопроса
    до включения проверки (смета перепроверки, M6.10); эпохи нет или список пуст — None."""
    ref = canon_ref.periods.get(period_id)
    if ref is None:
        return None
    try:
        period = canon_store.resolve_period(paths, channel, ref)
    except CanonRefError:
        return None
    forbidden = list(dict.fromkeys(item.strip() for item in period.forbidden if item.strip()))
    if not forbidden:
        return None
    years = ""
    if period.years is not None:
        start, end = period.years.from_, period.years.to
        years = str(start) if start == end else f"{start} to {end}"
    setting = ", ".join(part for part in (period.region.strip(), years) if part) or period.id
    return AnachronismOrder(period=ref, setting=setting, forbidden=forbidden)


@lru_cache(maxsize=1)
def _library() -> PromptLibrary:
    """Шаблоны приложения; битый шаблон бэкенд ловит ещё при старте (`app.state.prompts`)."""
    return load_templates(PROMPTS_DIR)


def vision_request(gateway: Gateway, order: AnachronismOrder, image: ImageRef) -> VisionRequest:
    """Вопрос по шаблону `anachronism_check`; лимит ответа — из маршрута этапа `check`."""
    params = gateway.resolve(CHECK_STAGE).params
    prompt = _library().render(
        TEMPLATE,
        {"period": order.setting, "forbidden": "\n".join(f"- {item}" for item in order.forbidden)},
    )
    return VisionRequest(
        prompt=prompt.text,
        image=image,
        response_schema=RESPONSE_SCHEMA,
        max_output_tokens=int(params.get("max_output_tokens", DEFAULT_MAX_OUTPUT_TOKENS)),
    )


def estimate(gateway: Gateway, order: AnachronismOrder) -> Cost:
    """Цена вопроса до вызова — сверху: входные токены текста и картинки, выход — по лимиту."""
    return gateway.estimate(CHECK_STAGE, vision_request(gateway, order, _ESTIMATE_IMAGE))


# --- разбор ответа -------------------------------------------------------------------------------


def parse_answer(text: str) -> list[str]:
    """Ровно один JSON-объект `{"found": [строки]}`; мусор вокруг, другая форма, лишние ключи —
    `AnswerError` с причиной. Ничего не чинится."""
    try:
        value = json.loads(text.strip())
    except json.JSONDecodeError as exc:
        raise AnswerError(f"ответ не JSON ({exc.msg}, позиция {exc.pos})") from exc
    if not isinstance(value, dict):
        raise AnswerError('ожидался объект {"found": [...]}')
    try:
        return _Answer.model_validate(value).found
    except ValidationError as exc:
        problems = "; ".join(
            f"{'.'.join(str(p) for p in error['loc']) or 'ответ'}: {error['msg']}"
            for error in exc.errors(include_url=False)
        )
        raise AnswerError(f'ответ не по форме {{"found": [строки]}} ({problems})') from exc


def match_forbidden(
    found: Sequence[str], forbidden: Sequence[str], score: float
) -> tuple[list[str], list[str]]:
    """Найденное → пункты `forbidden` (формулировкой канона, без повторов) и отброшенное: что не
    похоже ни на один пункт не меньше `score` (rapidfuzz WRatio, 0…100)."""
    matched: list[str] = []
    dropped: list[str] = []
    for item in found:
        if not item.strip():
            continue
        best = process.extractOne(
            item, forbidden, scorer=fuzz.WRatio, processor=utils.default_process, score_cutoff=score
        )
        if best is None:
            dropped.append(item)
        else:
            matched.append(best[0])
    return list(dict.fromkeys(matched)), dropped


# --- проверка версии -----------------------------------------------------------------------------


class AnachronismChecker:
    """Вопрос о версии кадра и разбор ответа. Не бросает: сбой — `failed` с причиной."""

    def __init__(self, config: AnachronismConfig) -> None:
        self.config = config

    async def check(
        self,
        gateway: Gateway,
        ctx: CallContext,
        channel: str,
        order: AnachronismOrder | None,
        image: Path,
    ) -> AnachronismCheck:
        """Вопрос о картинке `image` (миниатюра версии). `order` None (выключено при постановке)
        или проверка выключена в профиле сейчас — `off` без вызова и денег."""
        if order is None or not enabled(gateway.paths, channel):
            return AnachronismCheck(
                status="off", period=None if order is None else order.period, checked_at=now_iso()
            )
        try:
            request = vision_request(gateway, order, gateway.image_ref(image))
            outcome = await gateway.call(ctx, request)
            if outcome.asset_path is None:
                raise ProviderError("Модель не вернула ответ — перепроверьте кадр.")
            found = parse_answer(outcome.asset_path.read_text(encoding="utf-8"))
        except AnswerError as exc:
            return self._failed(order, f"Ответ проверки не разобран: {exc} — перепроверьте кадр.")
        except (ProviderError, RouteError, BudgetExceeded, TransientError) as exc:
            return self._failed(order, str(exc))
        except Exception as exc:
            log.exception("anachronism check failed for %s", image)
            text = str(exc).strip()
            detail = f": {text}" if text else ""
            return self._failed(
                order,
                f"Сбой проверки анахронизмов ({type(exc).__name__}){detail} — перепроверьте кадр.",
            )
        matched, dropped = match_forbidden(found, order.forbidden, self.config.match_score)
        if dropped:
            log.warning(
                "anachronism check %s/%s: dropped items outside forbidden of %s: %s",
                ctx.episode_id,
                ctx.shot_id,
                order.period,
                dropped,
            )
        return AnachronismCheck(
            status="suspect" if matched else "ok",
            found=matched,
            period=order.period,
            usd_micro=outcome.cost.usd_micro if outcome.status == "charged" else 0,
            checked_at=now_iso(),
        )

    @staticmethod
    def _failed(order: AnachronismOrder, reason: str) -> AnachronismCheck:
        return AnachronismCheck(
            status="failed", period=order.period, reason=reason, checked_at=now_iso()
        )
