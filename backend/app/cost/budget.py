"""Бюджеты канала (принцип 6): месяц, выпуск, анимация выпуска — из `profile.json → budgets`.

Занятое бюджетом = журнал (`charged` и резерв `estimated` идущих вызовов) + оценки платных
джобов в очереди (`jobs.cost_usd_micro`): пачка из многих `POST /api/jobs` упирается в лимит на
том джобе, который его превышает, а не после оплаты. Превышение — `BudgetExceeded` (в API —
409) без тихого перехода на модель дешевле. Месяц — календарный, UTC.
"""

import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel

from app.cost.ledger import SPENT_STATUSES
from app.cost.pricing import format_usd, usd_to_micro
from app.models.channel import Budgets, ChannelProfile
from app.storage.atomic import read_json
from app.storage.paths import StudioPaths

BudgetLevel = Literal["month", "episode", "animation"]
ANIMATION_STAGE = "animate"  # этап, чьи траты идут в лимит «анимация на выпуск»

_TITLE: dict[BudgetLevel, str] = {
    "month": "Месячный лимит",
    "episode": "Лимит на выпуск",
    "animation": "Лимит на анимацию выпуска",
}
_SPENT_SQL = ", ".join(f"'{status}'" for status in SPENT_STATUSES)


@dataclass(frozen=True)
class Committed:
    """Занятое бюджетом, микродоллары."""

    charged: int = 0
    reserved: int = 0  # резерв идущих вызовов (`estimated`)
    queued: int = 0  # оценки платных джобов в очереди

    @property
    def spent(self) -> int:
        return self.charged + self.reserved

    @property
    def total(self) -> int:
        return self.charged + self.reserved + self.queued


class BudgetRefusal(BaseModel):
    """Тело 409 при превышении бюджета (`detail`): текст для пользователя и числа для интерфейса."""

    code: Literal["budget_exceeded"] = "budget_exceeded"
    level: BudgetLevel
    limit_usd_micro: int
    spent_usd_micro: int  # charged + резерв идущих вызовов
    queued_usd_micro: int  # оценки платных джобов в очереди
    cost_usd_micro: int  # цена операции, которой отказано
    message: str


class BudgetExceeded(Exception):
    def __init__(
        self, level: BudgetLevel, limit_micro: int, committed: Committed, cost_micro: int
    ) -> None:
        self.level = level
        self.limit_micro = limit_micro
        self.committed = committed
        self.cost_micro = cost_micro
        super().__init__(_message(level, limit_micro, committed, cost_micro))

    def detail(self) -> dict[str, Any]:
        """Тело 409 (`BudgetRefusal`): текст для пользователя и числа для интерфейса."""
        return BudgetRefusal(
            level=self.level,
            limit_usd_micro=self.limit_micro,
            spent_usd_micro=self.committed.spent,
            queued_usd_micro=self.committed.queued,
            cost_usd_micro=self.cost_micro,
            message=str(self),
        ).model_dump(mode="json")


def _message(level: BudgetLevel, limit: int, committed: Committed, cost: int) -> str:
    queued = f", в очереди {format_usd(committed.queued)}" if committed.queued else ""
    if committed.total >= limit:
        head = (
            f"{_TITLE[level]} {format_usd(limit)} исчерпан,"
            f" потрачено {format_usd(committed.spent)}{queued}"
        )
    else:
        short = committed.total + cost - limit
        head = (
            f"{_TITLE[level]} {format_usd(limit)}: потрачено {format_usd(committed.spent)}{queued},"
            f" операция — {format_usd(cost)}, не хватает {format_usd(short)}"
        )
    return f"{head}; поднять лимит можно в настройках канала."


def load_budgets(paths: StudioPaths, channel: str) -> Budgets:
    return ChannelProfile.model_validate(read_json(paths.profile_path(channel))).budgets


def month_bounds(now: datetime) -> tuple[str, str]:
    """[начало месяца, начало следующего) в формате `now_iso()` — строки сравнимы в SQL."""
    start = now.astimezone(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    end = (
        start.replace(year=start.year + 1, month=1)
        if start.month == 12
        else start.replace(month=start.month + 1)
    )
    return start.isoformat(timespec="seconds"), end.isoformat(timespec="seconds")


def committed_month(conn: sqlite3.Connection, channel: str, now: datetime) -> Committed:
    start, end = month_bounds(now)
    return _committed(
        conn,
        "channel = ? AND ts >= ? AND ts < ?",
        (channel, start, end),
        "e.channel = ?",
        (channel,),
    )


def committed_episode(
    conn: sqlite3.Connection, episode_id: str, stage: str | None = None
) -> Committed:
    if stage is None:
        return _committed(conn, "episode_id = ?", (episode_id,), "j.episode_id = ?", (episode_id,))
    return _committed(
        conn,
        "episode_id = ? AND stage = ?",
        (episode_id, stage),
        "j.episode_id = ? AND j.cost_stage = ?",
        (episode_id, stage),
    )


def _committed(
    conn: sqlite3.Connection,
    ledger_where: str,
    ledger_params: tuple[str, ...],
    jobs_where: str,
    jobs_params: tuple[str, ...],
) -> Committed:
    sums = {
        row["status"]: row["total"]
        for row in conn.execute(
            "SELECT status, COALESCE(SUM(cost_micro_usd), 0) AS total FROM cost_ledger"
            f" WHERE {ledger_where} AND status IN ({_SPENT_SQL}) GROUP BY status",
            ledger_params,
        )
    }
    queued = conn.execute(
        "SELECT COALESCE(SUM(j.cost_usd_micro), 0) FROM jobs j JOIN episodes e"
        f" ON e.id = j.episode_id WHERE {jobs_where} AND j.status = 'queued'",
        jobs_params,
    ).fetchone()[0]
    return Committed(
        charged=int(sums.get("charged", 0)), reserved=int(sums.get("estimated", 0)), queued=queued
    )


def check_budget(
    conn: sqlite3.Connection,
    budgets: Budgets,
    *,
    channel: str,
    episode_id: str | None,
    stage: str,
    cost_micro: int,
    now: datetime | None = None,
) -> None:
    """Три уровня по очереди: месяц канала, выпуск, анимация выпуска. Бесплатное не проверяется."""
    if cost_micro <= 0:
        return
    checks: list[tuple[BudgetLevel, int, Committed]] = [
        ("month", usd_to_micro(budgets.monthly_usd), committed_month(conn, channel, now or _now())),
    ]
    if episode_id is not None:
        checks.append(
            ("episode", usd_to_micro(budgets.per_episode_usd), committed_episode(conn, episode_id))
        )
        if stage == ANIMATION_STAGE:
            checks.append(
                (
                    "animation",
                    usd_to_micro(budgets.animation_usd),
                    committed_episode(conn, episode_id, ANIMATION_STAGE),
                )
            )
    for level, limit, committed in checks:
        if committed.total + cost_micro > limit:
            raise BudgetExceeded(level, limit, committed, cost_micro)


def _now() -> datetime:
    return datetime.now(UTC)
