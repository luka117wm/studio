"""Очередь джобов в SQLite (принцип 7): постановка, взятие, переходы статусов, отмена.

Очередь живёт только в БД — процесс можно убить в любой момент. Каждый переход — условный
UPDATE по ожидаемому статусу и строка в `job_events` в одной транзакции: опоздавший воркер не
затрёт чужой статус, журнал событий не разойдётся со строкой джоба. Функции синхронные и
миллисекундные; соединение — вызывающего, в его потоке (L-014). Контракт — `docs/jobs.md`.
"""

import json
import sqlite3
import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel

from app.jobs.events import EventType, insert_event, latest_event_id
from app.storage.db import now_iso

JobStatus = Literal["queued", "running", "done", "failed", "cancelled"]
FinalStatus = Literal["done", "failed", "cancelled"]
TERMINAL_STATUSES: frozenset[str] = frozenset({"done", "failed", "cancelled"})
_FINAL_EVENT: dict[FinalStatus, EventType] = {
    "done": "job.done",
    "failed": "job.failed",
    "cancelled": "job.cancelled",
}


class Job(BaseModel):
    id: str
    kind: str
    status: JobStatus
    progress: float
    message: str | None
    payload: dict[str, Any]
    result: dict[str, Any] | None
    error: str | None
    attempts: int
    cancel_requested: bool
    episode_id: str | None
    batch_id: str | None
    idempotency_key: str | None
    created_at: str
    started_at: str | None
    finished_at: str | None
    # Платный джоб (M2.6): оценка при постановке и её этап; пока `queued` — занимает бюджет.
    cost_usd_micro: int | None = None
    cost_stage: str | None = None

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Job":
        data = dict(row)
        data["payload"] = json.loads(data["payload"])
        data["result"] = None if data["result"] is None else json.loads(data["result"])
        data["cancel_requested"] = bool(data["cancel_requested"])
        return cls.model_validate(data)

    def event_data(self) -> dict[str, Any]:
        """Тело события SSE: состояние без payload и result — их отдаёт `GET /api/jobs/{id}`."""
        return JobEventData(
            job_id=self.id,
            kind=self.kind,
            status=self.status,
            progress=self.progress,
            message=self.message,
            attempts=self.attempts,
            cancel_requested=self.cancel_requested,
            episode_id=self.episode_id,
            batch_id=self.batch_id,
            error=self.error,
        ).model_dump(mode="json")


class JobEventData(BaseModel):
    """`data` событий SSE `job.*` (`docs/jobs.md`): полное состояние, клиент заменяет его."""

    job_id: str
    kind: str
    status: JobStatus
    progress: float
    message: str | None
    attempts: int
    cancel_requested: bool
    episode_id: str | None
    batch_id: str | None
    error: str | None


class JobSummary(BaseModel):
    """Счётчики по статусам — сводка пачки (`GET /api/jobs?batch=`)."""

    total: int = 0
    queued: int = 0
    running: int = 0
    done: int = 0
    failed: int = 0
    cancelled: int = 0


@dataclass(frozen=True)
class NewJob:
    kind: str
    payload: dict[str, Any] = field(default_factory=dict)
    idempotency_key: str | None = None
    episode_id: str | None = None
    batch_id: str | None = None
    cost_usd_micro: int | None = None
    cost_stage: str | None = None


def _emit(conn: sqlite3.Connection, job: Job, event_type: EventType) -> None:
    insert_event(conn, job.id, event_type, job.event_data())


def _one(conn: sqlite3.Connection, sql: str, params: Sequence[Any]) -> Job | None:
    rows = conn.execute(sql, params).fetchall()
    return Job.from_row(rows[0]) if rows else None


# --- постановка --------------------------------------------------------------------------------


def enqueue_many(conn: sqlite3.Connection, jobs: Sequence[NewJob]) -> list[tuple[Job, bool]]:
    """Ставит джобы одной транзакцией. Пара (джоб, создан ли): ключ, который уже есть в БД,
    возвращает существующий джоб в любом статусе и дубля не создаёт."""
    out: list[tuple[Job, bool]] = []
    with conn:
        for new in jobs:
            job = _one(
                conn,
                "INSERT INTO jobs (id, kind, status, payload, idempotency_key, episode_id,"
                " batch_id, cost_usd_micro, cost_stage, created_at)"
                " VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)"
                " ON CONFLICT(idempotency_key) DO NOTHING RETURNING *",
                (
                    uuid.uuid4().hex,
                    new.kind,
                    json.dumps(new.payload, ensure_ascii=False),
                    new.idempotency_key,
                    new.episode_id,
                    new.batch_id,
                    new.cost_usd_micro,
                    new.cost_stage,
                    now_iso(),
                ),
            )
            if job is not None:
                _emit(conn, job, "job.queued")
                out.append((job, True))
                continue
            existing = _one(
                conn, "SELECT * FROM jobs WHERE idempotency_key = ?", (new.idempotency_key,)
            )
            assert existing is not None, "conflict without an existing idempotency_key"
            out.append((existing, False))
    return out


def enqueue(conn: sqlite3.Connection, new: NewJob) -> tuple[Job, bool]:
    return enqueue_many(conn, [new])[0]


# --- исполнение: только пул воркеров ----------------------------------------------------------


def claim(conn: sqlite3.Connection, exclude_kinds: Collection[str] = ()) -> Job | None:
    """Берёт самый старый `queued` (FIFO) и переводит в `running`; `attempts + 1` — каждый старт."""
    excluded = sorted(exclude_kinds)
    kind_filter = f" AND kind NOT IN ({','.join('?' * len(excluded))})" if excluded else ""
    with conn:
        job = _one(
            conn,
            "UPDATE jobs SET status = 'running', started_at = ?, finished_at = NULL,"
            " attempts = attempts + 1, progress = 0, message = NULL, error = NULL"
            " WHERE id = (SELECT id FROM jobs WHERE status = 'queued'"
            f"{kind_filter} ORDER BY created_at, rowid LIMIT 1) RETURNING *",
            (now_iso(), *excluded),
        )
        if job is not None:
            _emit(conn, job, "job.started")
    return job


def set_progress(
    conn: sqlite3.Connection, job_id: str, progress: float, message: str | None
) -> Job | None:
    with conn:
        job = _one(
            conn,
            "UPDATE jobs SET progress = ?, message = ? WHERE id = ? AND status = 'running'"
            " RETURNING *",
            (progress, message, job_id),
        )
        if job is not None:
            _emit(conn, job, "job.progress")
    return job


def record_retry(conn: sqlite3.Connection, job_id: str, message: str) -> Job | None:
    """Повтор внутри одного старта: ещё одна попытка и сообщение о ней."""
    with conn:
        job = _one(
            conn,
            "UPDATE jobs SET attempts = attempts + 1, message = ?"
            " WHERE id = ? AND status = 'running' RETURNING *",
            (message, job_id),
        )
        if job is not None:
            _emit(conn, job, "job.progress")
    return job


def finish(
    conn: sqlite3.Connection,
    job_id: str,
    status: FinalStatus,
    *,
    progress: float,
    message: str | None = None,
    result: dict[str, Any] | None = None,
    error: str | None = None,
) -> Job | None:
    """`running` → конечный статус. Прогресс и result сохраняются как есть — и при отмене."""
    with conn:
        job = _one(
            conn,
            "UPDATE jobs SET status = ?, progress = ?, message = ?, result = ?, error = ?,"
            " finished_at = ? WHERE id = ? AND status = 'running' RETURNING *",
            (
                status,
                progress,
                message,
                None if result is None else json.dumps(result, ensure_ascii=False),
                error,
                now_iso(),
                job_id,
            ),
        )
        if job is not None:
            _emit(conn, job, _FINAL_EVENT[status])
    return job


def requeue(conn: sqlite3.Connection, job_id: str, message: str) -> Job | None:
    """Штатная остановка прервала джоб: обратно в очередь. Попытка не засчитывается —
    иначе несколько `--reload` подряд выглядели бы как джоб, роняющий бэкенд."""
    with conn:
        job = _one(
            conn,
            "UPDATE jobs SET status = 'queued', attempts = MAX(attempts - 1, 0), message = ?"
            " WHERE id = ? AND status = 'running' RETURNING *",
            (message, job_id),
        )
        if job is not None:
            _emit(conn, job, "job.queued")
    return job


def recover_running(conn: sqlite3.Connection) -> list[Job]:
    """Старт после аварии: `running` → `queued`. Попытки не сбрасываются — по ним видно джоб,
    который роняет бэкенд (пул не даст ему больше `job_max_attempts` стартов)."""
    with conn:
        rows = conn.execute(
            "UPDATE jobs SET status = 'queued', message = ? WHERE status = 'running' RETURNING *",
            ("Возвращён в очередь после перезапуска бэкенда.",),
        ).fetchall()
        jobs = [Job.from_row(row) for row in rows]
        for job in jobs:
            _emit(conn, job, "job.queued")
    return jobs


# --- отмена ------------------------------------------------------------------------------------


def request_cancel(conn: sqlite3.Connection, job_id: str) -> Job | None:
    """`queued` отменяется сразу; у `running` ставится флаг, обработчик увидит его между шагами.
    Конечные статусы не меняются. None — джоба нет."""
    with conn:
        job = _one(
            conn,
            "UPDATE jobs SET status = 'cancelled', cancel_requested = 1, finished_at = ?"
            " WHERE id = ? AND status = 'queued' RETURNING *",
            (now_iso(), job_id),
        )
        if job is not None:
            _emit(conn, job, "job.cancelled")
            return job
        job = _one(
            conn,
            "UPDATE jobs SET cancel_requested = 1"
            " WHERE id = ? AND status = 'running' AND cancel_requested = 0 RETURNING *",
            (job_id,),
        )
        if job is not None:
            _emit(conn, job, "job.progress")
            return job
    return get_job(conn, job_id)


def is_cancel_requested(conn: sqlite3.Connection, job_id: str) -> bool:
    row = conn.execute("SELECT cancel_requested FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return row is not None and bool(row[0])


# --- чтение ------------------------------------------------------------------------------------


def get_job(conn: sqlite3.Connection, job_id: str) -> Job | None:
    return _one(conn, "SELECT * FROM jobs WHERE id = ?", (job_id,))


def get_job_by_key(conn: sqlite3.Connection, idempotency_key: str) -> Job | None:
    return _one(conn, "SELECT * FROM jobs WHERE idempotency_key = ?", (idempotency_key,))


def list_jobs(
    conn: sqlite3.Connection,
    *,
    status: JobStatus | None = None,
    episode_id: str | None = None,
    batch_id: str | None = None,
    kind: str | None = None,
    limit: int = 200,
) -> tuple[list[Job], JobSummary, int]:
    """Последние `limit` джобов по фильтру в порядке постановки, сводка по всему фильтру и курсор
    журнала. Курсор читается первым: событие между чтениями придёт дважды, но не пропадёт."""
    cursor = latest_event_id(conn)
    clauses: list[str] = []
    params: list[Any] = []
    for column, value in (
        ("status", status),
        ("episode_id", episode_id),
        ("batch_id", batch_id),
        ("kind", kind),
    ):
        if value is not None:
            clauses.append(f"{column} = ?")
            params.append(value)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = conn.execute(
        f"SELECT * FROM jobs WHERE rowid IN (SELECT rowid FROM jobs{where}"
        " ORDER BY rowid DESC LIMIT ?) ORDER BY rowid",
        (*params, limit),
    ).fetchall()
    summary = JobSummary()
    for row in conn.execute(
        f"SELECT status, COUNT(*) AS n FROM jobs{where} GROUP BY status", params
    ).fetchall():
        setattr(summary, row["status"], row["n"])
        summary.total += row["n"]
    return [Job.from_row(row) for row in rows], summary, cursor
