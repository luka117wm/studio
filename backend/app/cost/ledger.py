"""Журнал расходов `cost_ledger` (принцип 6): строка на единицу учёта каждого платного вызова.

Статусы строки и что лежит в `cost_micro_usd`:
- `estimated` — резерв на время вызова: оценка. Входит в потраченное, чтобы параллельные
  воркеры не прошли в лимит вдвоём; после ответа та же строка становится `charged` или `failed`;
- `charged` — факт по ответу провайдера;
- `cached` — результат взят из кэша по хэшу входов (принцип 8): 0, количество — сэкономленное;
- `refused` — отказ по бюджету до вызова: сумма, которую не стали тратить (в потраченное не входит);
- `failed` — вызов не прошёл: 0 (за неуспешный запрос провайдеры не берут).
Строки одного вызова связаны `call_id`. Деньги — целые микродоллары (L-001). Функции транзакцию
не открывают и не коммитят: её ведёт вызывающий (резерв идёт в одной транзакции с бюджетом).
"""

import sqlite3
import uuid
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel

from app.cost.pricing import format_usd
from app.providers.base import Cost
from app.storage.db import now_iso

LedgerStatus = Literal["estimated", "charged", "cached", "refused", "failed"]
SPENT_STATUSES: tuple[LedgerStatus, ...] = ("estimated", "charged")
_ZERO_STATUSES: frozenset[LedgerStatus] = frozenset({"cached", "failed"})


@dataclass(frozen=True)
class LedgerContext:
    """Чей вызов: канал, выпуск, этап, джоб, хэш входов — одинаково для всех строк вызова."""

    channel: str
    episode_id: str | None
    stage: str
    job_id: str | None = None
    input_hash: str | None = None


class LedgerRow(BaseModel):
    id: int
    ts: str
    channel: str
    episode_id: str | None
    stage: str
    job_id: str | None
    provider: str
    model: str
    unit: str
    quantity: float
    variant: str | None
    usd_micro: int
    usd: str  # только для показа; считать — по `usd_micro`
    status: LedgerStatus
    call_id: str | None
    input_hash: str | None

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "LedgerRow":
        data = dict(row)
        data["usd_micro"] = data.pop("cost_micro_usd")
        data["usd"] = format_usd(data["usd_micro"])
        return cls.model_validate(data)


def new_call_id() -> str:
    return uuid.uuid4().hex


def record(
    conn: sqlite3.Connection,
    ctx: LedgerContext,
    cost: Cost,
    status: LedgerStatus,
    call_id: str,
) -> None:
    """Строки вызова по строкам цены. У `cached` и `failed` сумма 0, количество — как в цене."""
    ts = now_iso()
    for line in cost.lines:
        conn.execute(
            "INSERT INTO cost_ledger (ts, channel, episode_id, stage, job_id, provider, model,"
            " unit, quantity, variant, cost_micro_usd, status, call_id, input_hash)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                ts,
                ctx.channel,
                ctx.episode_id,
                ctx.stage,
                ctx.job_id,
                cost.provider,
                cost.model,
                line.unit,
                line.quantity,
                line.variant,
                0 if status in _ZERO_STATUSES else line.usd_micro,
                status,
                call_id,
                ctx.input_hash,
            ),
        )


def settle_charged(conn: sqlite3.Connection, call_id: str, actual: Cost) -> None:
    """Резерв → факт: строка единицы получает фактические количество и сумму. Единица, которой
    в факте нет (поиск не понадобился), — `charged` с нулём; новая единица — новая строка."""
    rows = conn.execute(
        "SELECT * FROM cost_ledger WHERE call_id = ? AND status = 'estimated' ORDER BY id",
        (call_id,),
    ).fetchall()
    if not rows:
        raise LookupError(f"no reserved ledger rows for call {call_id}")
    by_unit = {row["unit"]: row for row in rows}
    ts = now_iso()
    for line in actual.lines:
        row = by_unit.pop(line.unit, None)
        if row is None:
            first = rows[0]
            ctx = LedgerContext(
                first["channel"],
                first["episode_id"],
                first["stage"],
                first["job_id"],
                first["input_hash"],
            )
            record(conn, ctx, actual.model_copy(update={"lines": [line]}), "charged", call_id)
            continue
        conn.execute(
            "UPDATE cost_ledger SET status = 'charged', ts = ?, quantity = ?, variant = ?,"
            " cost_micro_usd = ? WHERE id = ?",
            (ts, line.quantity, line.variant, line.usd_micro, row["id"]),
        )
    for row in by_unit.values():
        conn.execute(
            "UPDATE cost_ledger SET status = 'charged', ts = ?, quantity = 0, cost_micro_usd = 0"
            " WHERE id = ?",
            (ts, row["id"]),
        )


def settle_failed(conn: sqlite3.Connection, call_id: str) -> None:
    """Вызов не прошёл: резерв снимается, строки остаются с нулём для истории."""
    conn.execute(
        "UPDATE cost_ledger SET status = 'failed', ts = ?, cost_micro_usd = 0"
        " WHERE call_id = ? AND status = 'estimated'",
        (now_iso(), call_id),
    )


def spent_by_stage(conn: sqlite3.Connection, channel: str, start: str, end: str) -> dict[str, int]:
    """Потраченное (`charged` + резерв) канала за [start, end) по этапам."""
    statuses = ", ".join("?" * len(SPENT_STATUSES))
    rows = conn.execute(
        "SELECT stage, SUM(cost_micro_usd) AS total FROM cost_ledger"
        f" WHERE channel = ? AND ts >= ? AND ts < ? AND status IN ({statuses})"
        " GROUP BY stage ORDER BY stage",
        (channel, start, end, *SPENT_STATUSES),
    ).fetchall()
    return {row["stage"]: int(row["total"]) for row in rows}


def list_rows(
    conn: sqlite3.Connection,
    *,
    episode_id: str | None = None,
    channel: str | None = None,
    limit: int = 500,
) -> list[LedgerRow]:
    """Последние `limit` строк по фильтру, старые сверху."""
    clauses: list[str] = []
    params: list[str | int] = []
    if episode_id is not None:
        clauses.append("episode_id = ?")
        params.append(episode_id)
    if channel is not None:
        clauses.append("channel = ?")
        params.append(channel)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = conn.execute(
        f"SELECT * FROM cost_ledger WHERE id IN (SELECT id FROM cost_ledger{where}"
        " ORDER BY id DESC LIMIT ?) ORDER BY id",
        (*params, limit),
    ).fetchall()
    return [LedgerRow.from_row(row) for row in rows]
