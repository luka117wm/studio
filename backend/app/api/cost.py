"""Расходы: сводка канала за месяц и журнал выпуска (принцип 6).

Деньги в ответах — пара `usd_micro` (считать) и `usd` (показывать); округление до центов —
только здесь, на выходе (L-001). Контракт — `docs/providers.md`.
"""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.api.deps import DbDep, GatewayDep, PathsDep
from app.api.episodes import require_episode
from app.cost import ledger
from app.cost.budget import (
    ANIMATION_STAGE,
    Committed,
    committed_episode,
    committed_month,
    load_budgets,
    month_bounds,
)
from app.cost.ledger import LedgerRow
from app.cost.pricing import StalePrice, format_usd, usd_to_micro
from app.models.director import Channel

router = APIRouter(tags=["cost"])


class Money(BaseModel):
    usd_micro: int
    usd: str


def money(micro: int) -> Money:
    return Money(usd_micro=micro, usd=format_usd(micro))


class BudgetUsage(BaseModel):
    limit: Money
    charged: Money  # списано по ответам провайдеров
    reserved: Money  # резерв идущих вызовов
    queued: Money  # оценки платных джобов в очереди
    remaining: Money  # лимит минус всё занятое, не меньше нуля


def budget_usage(limit_usd: float, committed: Committed) -> BudgetUsage:
    limit = usd_to_micro(limit_usd)
    return BudgetUsage(
        limit=money(limit),
        charged=money(committed.charged),
        reserved=money(committed.reserved),
        queued=money(committed.queued),
        remaining=money(max(limit - committed.total, 0)),
    )


class StageSpend(BaseModel):
    stage: str
    spent: Money


class CostSummary(BaseModel):
    channel: Channel
    month: str  # YYYY-MM, UTC
    budget: BudgetUsage
    by_stage: list[StageSpend]
    # Цены, проверенные дольше `pricing_stale_days` назад: сверить `config/pricing.yaml`.
    stale_pricing: list[StalePrice]


class LedgerPage(BaseModel):
    items: list[LedgerRow]
    episode_budget: BudgetUsage | None = None
    animation_budget: BudgetUsage | None = None


@router.get("/cost/summary")
async def cost_summary(
    channel: Channel, db: DbDep, paths: PathsDep, gateway: GatewayDep
) -> CostSummary:
    if db.execute("SELECT 1 FROM channels WHERE id = ?", (channel,)).fetchone() is None:
        raise HTTPException(
            status_code=404,
            detail=f"Канал «{channel}» не найден. Создайте каналы: python -m app.tools.seed",
        )
    now = datetime.now(UTC)
    start, end = month_bounds(now)
    budgets = load_budgets(paths, channel)
    by_stage = ledger.spent_by_stage(db, channel, start, end)
    return CostSummary(
        channel=channel,
        month=start[:7],
        budget=budget_usage(budgets.monthly_usd, committed_month(db, channel, now)),
        by_stage=[StageSpend(stage=stage, spent=money(total)) for stage, total in by_stage.items()],
        stale_pricing=gateway.pricing.stale(now.date()),
    )


@router.get("/cost/ledger")
async def cost_ledger(
    db: DbDep,
    paths: PathsDep,
    episode: str | None = None,
    channel: Channel | None = None,
    limit: Annotated[int, Query(ge=1, le=5000)] = 500,
) -> LedgerPage:
    """Строки журнала по выпуску или каналу; у выпуска — ещё его лимиты."""
    if episode is None and channel is None:
        raise HTTPException(status_code=422, detail="Укажите выпуск (episode) или канал (channel).")
    owner = None if episode is None else require_episode(db, episode).channel
    items = ledger.list_rows(db, episode_id=episode, channel=channel, limit=limit)
    if episode is None or owner is None:
        return LedgerPage(items=items)
    budgets = load_budgets(paths, owner)
    return LedgerPage(
        items=items,
        episode_budget=budget_usage(budgets.per_episode_usd, committed_episode(db, episode)),
        animation_budget=budget_usage(
            budgets.animation_usd, committed_episode(db, episode, ANIMATION_STAGE)
        ),
    )
