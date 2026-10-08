"""Смета плана (M4.6) и общие строки сметы выпуска: кадры, голос, анимация, сценарий.

Объёмы — из действующего плана (версия плюс правки, без убранных кадров), цены — только через
`Gateway.estimate` маршрутами профиля по умолчанию (принципы 5, 6): ни цен, ни ID моделей здесь
нет. Сценарий при мосте через чат — строка $0 без вызова (устав M4, решения 1 и 2). Превышение
бюджета — предупреждение в ответе, не отказ: отказывает очередь генерации в M6 (решение 8).
Контракт — `docs/providers.md`, «Смета плана».
"""

import math
from collections import Counter
from collections.abc import Mapping
from typing import Literal

from pydantic import BaseModel, Field

from app.cost.budget import ANIMATION_STAGE, LEVEL_TITLE, BudgetLevel, Committed
from app.cost.pricing import Money, format_unit_usd, format_usd, money, usd_to_micro
from app.models.channel import Budgets
from app.models.episode_summary import count_words
from app.models.formats import EstimateVolumes
from app.pipeline.director_import import EffectivePlan
from app.pipeline.script.plan_bridge import plural
from app.providers.base import (
    CHARS_PER_TOKEN,
    Cost,
    CostLine,
    ImageRequest,
    SpeechRequest,
    TextRequest,
    VideoRequest,
)
from app.providers.gateway import Gateway
from app.providers.registry import PlanSource

# Этап через мост через чат: вызова нет, провайдер и модель — условные, отличает его `via`.
BRIDGE_PROVIDER = "bridge"
BRIDGE_MODEL = "chat"
BRIDGE_LABEL = "Мост через чат"

# Текст остатка уровня бюджета после выпуска: «Останется $75.20 из месячных $150».
_LEFT: dict[BudgetLevel, str] = {
    "month": "Останется {left} из месячных {limit}",
    "episode": "Останется {left} из {limit} на выпуск",
    "animation": "Останется {left} из {limit} на анимацию",
}


def _is_none(value: object) -> bool:
    return value is None


class StageCost(Cost):
    """Цена этапа в смете. Этап через мост через чат — $0 без строк единиц и с `via: bridge`;
    у платного этапа поля нет."""

    via: Literal["bridge"] | None = Field(default=None, exclude_if=_is_none)


class EstimateLine(BaseModel):
    """Строка сметы плана для экрана: что, сколько и почём."""

    title: str  # «Кадры», «Голос», «Анимация», «План»
    label: str  # «104 × $0.067», «23 400 знаков», «6 клипов × $0.32», «Мост через чат»
    usd: Money
    cost: StageCost  # этап, модель маршрута, единицы


class BudgetOutlook(BaseModel):
    """Уровень бюджета после выпуска: лимит, занятое до него, доля сметы, остаток."""

    level: BudgetLevel
    limit: Money
    committed: Money  # занято до выпуска: списано, резерв идущих вызовов, очередь
    estimate: Money  # часть сметы, которая ложится на этот уровень
    remaining: Money  # останется после выпуска, не меньше нуля
    exceeded: bool
    message: str  # «Останется $75.20 из месячных $150» или чего не хватает


class PlanEstimate(BaseModel):
    """Смета действующего плана: `GET /api/projects/{id}/estimate`."""

    version: str  # версия плана, по которой считана смета
    plan_source: PlanSource
    lines: list[EstimateLine]
    total: Money
    budgets: list[BudgetOutlook]  # месяц канала, выпуск, анимация выпуска
    # Тексты превышенных уровней — показать до клика; это не отказ (устав M4, решение 8).
    warnings: list[str]
    stale_pricing: bool


# --- строки этапов ----------------------------------------------------------------------------


def stage_cost(cost: Cost, calls: int = 1) -> StageCost:
    """Цена `calls` одинаковых вызовов: у каждого своё округление, как в журнале."""
    data = cost.model_dump()
    for line in data["lines"]:
        line["quantity"] *= calls
        line["usd_micro"] *= calls
    return StageCost.model_validate({**data, "usd_micro": cost.usd_micro * calls})


def bridge_cost(stage: str) -> StageCost:
    return StageCost(
        stage=stage,
        provider=BRIDGE_PROVIDER,
        model=BRIDGE_MODEL,
        lines=[],
        usd_micro=0,
        via="bridge",
    )


def script_cost(
    gateway: Gateway, volumes: EstimateVolumes, words: int, plan_source: PlanSource
) -> StageCost:
    """Сценарий: при мосте — $0 без вызова; при API — запрос того же объёма, что у выпуска."""
    if plan_source == "bridge":
        return bridge_cost("script")
    request = TextRequest(
        prompt="x" * (volumes.script_input_tokens * CHARS_PER_TOKEN),
        max_output_tokens=max(math.ceil(words * volumes.script_output_tokens_per_word), 1),
    )
    return stage_cost(gateway.estimate("script", request))


def _voice(gateway: Gateway, chars: int) -> StageCost:
    """Голос — один запрос на все символы VO; без текста — $0 на маршруте голоса."""
    request = SpeechRequest(text="x" * max(chars, 1), voice_id="estimate")
    return stage_cost(gateway.estimate("voice", request), 1 if chars else 0)


def _clip(gateway: Gateway, seconds: int) -> Cost:
    return gateway.estimate(
        "animate", VideoRequest(prompt="clip", start_frame="estimate", seconds=seconds)
    )


def _animate(gateway: Gateway, clips: Counter[int]) -> tuple[StageCost, str]:
    """Клип — отдельный вызов: группы по длительности, строки единиц сливаются."""
    count = sum(clips.values())
    word = plural(count, "клип", "клипа", "клипов")
    if not clips:
        return stage_cost(_clip(gateway, 4), 0), f"0 {word}"
    singles = {seconds: _clip(gateway, seconds) for seconds in sorted(clips)}
    groups = [stage_cost(one, clips[seconds]) for seconds, one in singles.items()]
    merged: dict[tuple[str, str | None], CostLine] = {}
    for line in (line for group in groups for line in group.lines):
        key = (line.unit, line.variant)
        prev = merged.get(key)
        merged[key] = (
            line
            if prev is None
            else prev.model_copy(
                update={
                    "quantity": prev.quantity + line.quantity,
                    "usd_micro": prev.usd_micro + line.usd_micro,
                }
            )
        )
    cost = groups[0].model_copy(
        update={
            "lines": list(merged.values()),
            "usd_micro": sum(group.usd_micro for group in groups),
            "stale_pricing": any(group.stale_pricing for group in groups),
        }
    )
    if len(singles) == 1:
        (one,) = singles.values()
        return cost, f"{count} {word} × {format_unit_usd(one.usd_micro)}"
    seconds = sum(s * n for s, n in clips.items())
    return cost, f"{count} {word}, {_count(seconds)} с"


def _count(value: int) -> str:
    """«23 400»: разряды через неразрывный пробел, как на фронте."""
    return f"{value:,}".replace(",", " ")


def _line(title: str, label: str, cost: StageCost) -> EstimateLine:
    return EstimateLine(title=title, label=label, usd=money(cost.usd_micro), cost=cost)


# --- смета плана --------------------------------------------------------------------------------


def plan_estimate(
    plan: EffectivePlan,
    gateway: Gateway,
    plan_source: PlanSource,
    budgets: Budgets,
    committed: Mapping[BudgetLevel, Committed],
    volumes: EstimateVolumes,
) -> PlanEstimate:
    """Смета действующего плана и остаток каждого уровня бюджета после выпуска.

    `committed` — занятое уровнем до выпуска (журнал и очередь, `cost/budget.py`); `volumes` —
    объём запроса сценария при `plan_source: api`.
    """
    shots = [shot for shot in plan.shots if shot.status != "removed"]
    chars = sum(len(shot.vo) for shot in shots)
    words = sum(count_words(shot.vo) for shot in shots)

    image = gateway.estimate("images", ImageRequest(prompt="shot"))
    images = stage_cost(image, len(shots))
    voice = _voice(gateway, chars)
    animate, clips_label = _animate(
        gateway, Counter(shot.animate.seconds for shot in shots if shot.animate.recommended)
    )
    script = script_cost(gateway, volumes, words, plan_source)
    if script.via == "bridge":
        script_label = BRIDGE_LABEL
    else:
        tokens = int(sum(line.quantity for line in script.lines))
        script_label = f"{_count(tokens)} {plural(tokens, 'токен', 'токена', 'токенов')}"

    lines = [
        _line("Кадры", f"{len(shots)} × {format_unit_usd(image.usd_micro)}", images),
        _line("Голос", f"{_count(chars)} {plural(chars, 'знак', 'знака', 'знаков')}", voice),
        _line("Анимация", clips_label, animate),
        _line("План", script_label, script),
    ]
    total = sum(line.cost.usd_micro for line in lines)
    share: dict[BudgetLevel, int] = {
        "month": total,
        "episode": total,
        "animation": sum(ln.cost.usd_micro for ln in lines if ln.cost.stage == ANIMATION_STAGE),
    }
    limits: dict[BudgetLevel, float] = {
        "month": budgets.monthly_usd,
        "episode": budgets.per_episode_usd,
        "animation": budgets.animation_usd,
    }
    outlooks = [
        _outlook(level, limits[level], committed.get(level, Committed()), share[level])
        for level in limits
    ]
    return PlanEstimate(
        version=plan.version,
        plan_source=plan_source,
        lines=lines,
        total=money(total),
        budgets=outlooks,
        warnings=[outlook.message for outlook in outlooks if outlook.exceeded],
        stale_pricing=any(line.cost.stale_pricing for line in lines),
    )


def _outlook(
    level: BudgetLevel, limit_usd: float, committed: Committed, estimate: int
) -> BudgetOutlook:
    """Правило превышения — как у `check_budget`: занятое + смета > лимита; бесплатное не
    превышает."""
    limit = usd_to_micro(limit_usd)
    left = limit - committed.total - estimate
    exceeded = estimate > 0 and left < 0
    if exceeded:
        message = (
            f"{LEVEL_TITLE[level]} {format_usd(limit)}: занято {format_usd(committed.total)},"
            f" смета {format_usd(estimate)} — не хватает {format_usd(-left)}; поднять лимит"
            " можно в настройках канала."
        )
    else:
        message = _LEFT[level].format(left=format_usd(max(left, 0)), limit=format_usd(limit))
    return BudgetOutlook(
        level=level,
        limit=money(limit),
        committed=money(committed.total),
        estimate=money(estimate),
        remaining=money(max(left, 0)),
        exceeded=exceeded,
        message=message,
    )
