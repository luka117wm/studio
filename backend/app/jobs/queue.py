"""Очередь джобов в SQLite (принцип 7): постановка, взятие, переходы статусов, отмена, пачки.

Очередь живёт только в БД — процесс можно убить в любой момент. Каждый переход — условный
UPDATE по ожидаемому статусу и строка в `job_events` в одной транзакции: опоздавший воркер не
затрёт чужой статус, журнал событий не разойдётся со строкой джоба. Функции синхронные и
миллисекундные; соединение — вызывающего, в его потоке (L-014). Контракт — `docs/jobs.md`.

Пачка (M6.3) — строка `batches` с флагами паузы и отмены. Пул не берёт `queued` джобы пачки на
паузе; переход джоба пачки пишет ещё и `batch.updated` со сводкой — в той же транзакции.
"""

import json
import sqlite3
import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass, field, replace
from typing import Any, Literal

from pydantic import BaseModel

from app.cost.money import Money, money
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
    # Канал джоба без выпуска (M5.4: опорные портреты, кадры стиля): по нему экран канона узнаёт
    # свой джоб в общем потоке (M5.7). У джоба выпуска — `null`, канал берётся у выпуска.
    channel: str | None = None

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
            channel=self.channel,
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
    channel: str | None = None  # канал джоба без выпуска, как у `Job`
    error: str | None


class JobSummary(BaseModel):
    """Счётчики по статусам — сводка пачки (`GET /api/jobs?batch=`)."""

    total: int = 0
    queued: int = 0
    running: int = 0
    done: int = 0
    failed: int = 0
    cancelled: int = 0


class BatchSummary(BaseModel):
    """Сводка пачки (M6.3): `GET /api/batches/{id}` и `data` события `batch.updated`."""

    id: str
    episode_id: str
    kind: str
    model: str  # ключ каталога модели на пачку
    created_at: str
    paused: bool
    cancelled: bool  # пачку отменили: `queued` сняты, начатые доделывались
    retry_of: str | None  # «Повторить упавшие» — из какой пачки
    jobs: JobSummary  # джобы пачки по статусам
    finished: bool  # ни одного `queued` и `running`
    estimate: Money  # смета суммой при постановке, кэш не вычтен
    spent: Money  # `charged` журнала по джобам пачки
    # Осталось, секунды: средняя длительность готовых × (в очереди + рисуется) / `parallel`;
    # null — готовых ещё нет, ждать нечего или пачка на паузе.
    eta_s: float | None


@dataclass(frozen=True)
class NewBatch:
    id: str
    episode_id: str
    kind: str
    model: str
    estimate_usd_micro: int
    parallel: int
    retry_of: str | None = None


@dataclass(frozen=True)
class NewJob:
    kind: str
    payload: dict[str, Any] = field(default_factory=dict)
    idempotency_key: str | None = None
    episode_id: str | None = None
    batch_id: str | None = None
    cost_usd_micro: int | None = None
    cost_stage: str | None = None
    # Канал джоба без выпуска (M5.4: листы портретов, кадры стиля) — для месячного бюджета.
    # У джоба выпуска не задаётся: канал — у выпуска.
    channel: str | None = None


def _emit(
    conn: sqlite3.Connection, job: Job, event_type: EventType, *, batch_event: bool = True
) -> None:
    """Событие джоба; переход джоба пачки — ещё и сводка пачки. Прогресс сводку не меняет.
    `batch_id` без строки `batches` (метка группы из `POST /api/jobs`, M2.5) сводки не имеет."""
    insert_event(conn, job.id, event_type, job.event_data())
    if batch_event and job.batch_id is not None and event_type != "job.progress":
        summary = batch_summary(conn, job.batch_id)
        if summary is not None:
            insert_event(conn, job.id, "batch.updated", summary.model_dump(mode="json"))


def _one(conn: sqlite3.Connection, sql: str, params: Sequence[Any]) -> Job | None:
    rows = conn.execute(sql, params).fetchall()
    return Job.from_row(rows[0]) if rows else None


# --- постановка --------------------------------------------------------------------------------


def enqueue_many(conn: sqlite3.Connection, jobs: Sequence[NewJob]) -> list[tuple[Job, bool]]:
    """Ставит джобы одной транзакцией. Пара (джоб, создан ли): ключ, который уже есть в БД,
    возвращает существующий джоб в любом статусе и дубля не создаёт."""
    with conn:
        return _insert_jobs(conn, jobs)


def _insert_jobs(
    conn: sqlite3.Connection, jobs: Sequence[NewJob], *, batch_event: bool = True
) -> list[tuple[Job, bool]]:
    """Строки джобов без commit — транзакцию ведёт вызывающий."""
    out: list[tuple[Job, bool]] = []
    for new in jobs:
        job = _one(
            conn,
            "INSERT INTO jobs (id, kind, status, payload, idempotency_key, episode_id,"
            " batch_id, cost_usd_micro, cost_stage, channel, created_at)"
            " VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)"
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
                new.channel,
                now_iso(),
            ),
        )
        if job is not None:
            _emit(conn, job, "job.queued", batch_event=batch_event)
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
    """Берёт самый старый `queued` (FIFO) и переводит в `running`; `attempts + 1` — каждый старт.
    Джобы пачки на паузе (M6.3) не берутся."""
    excluded = sorted(exclude_kinds)
    kind_filter = f" AND kind NOT IN ({','.join('?' * len(excluded))})" if excluded else ""
    with conn:
        job = _one(
            conn,
            "UPDATE jobs SET status = 'running', started_at = ?, finished_at = NULL,"
            " attempts = attempts + 1, progress = 0, message = NULL, error = NULL"
            " WHERE id = (SELECT id FROM jobs WHERE status = 'queued'"
            f"{kind_filter} AND (batch_id IS NULL OR batch_id NOT IN"
            " (SELECT id FROM batches WHERE paused = 1))"
            " ORDER BY created_at, rowid LIMIT 1) RETURNING *",
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


def active_jobs(conn: sqlite3.Connection, episode_id: str | None = None) -> list[Job]:
    """`queued` и `running` джобы выпусков в порядке постановки — одним запросом на список."""
    where = " AND episode_id = ?" if episode_id is not None else " AND episode_id IS NOT NULL"
    params = (episode_id,) if episode_id is not None else ()
    rows = conn.execute(
        f"SELECT * FROM jobs WHERE status IN ('queued', 'running'){where} ORDER BY rowid", params
    ).fetchall()
    return [Job.from_row(row) for row in rows]


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


# --- пачки (M6.3) --------------------------------------------------------------------------------


def insert_batch(
    conn: sqlite3.Connection, batch: NewBatch, jobs: Sequence[NewJob]
) -> tuple[BatchSummary, list[Job]]:
    """Пачка и её джобы без commit: вызывающий держит `BEGIN IMMEDIATE` вместе с проверкой
    бюджета суммой (L-021). Событие `batch.updated` — одно на пачку, а не на каждый джоб."""
    conn.execute(
        "INSERT INTO batches (id, episode_id, kind, model, created_at, estimate_usd_micro,"
        " parallel, retry_of) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            batch.id,
            batch.episode_id,
            batch.kind,
            batch.model,
            now_iso(),
            batch.estimate_usd_micro,
            batch.parallel,
            batch.retry_of,
        ),
    )
    created = _insert_jobs(
        conn, [replace(new, batch_id=batch.id) for new in jobs], batch_event=False
    )
    summary = _emit_batch(conn, batch.id, created[0][0].id)
    return summary, [job for job, _ in created]


def batch_summary(conn: sqlite3.Connection, batch_id: str) -> BatchSummary | None:
    row = conn.execute("SELECT * FROM batches WHERE id = ?", (batch_id,)).fetchone()
    if row is None:
        return None
    jobs = JobSummary()
    for item in conn.execute(
        "SELECT status, COUNT(*) AS n FROM jobs WHERE batch_id = ? GROUP BY status", (batch_id,)
    ).fetchall():
        setattr(jobs, item["status"], item["n"])
        jobs.total += item["n"]
    spent = conn.execute(
        "SELECT COALESCE(SUM(l.cost_micro_usd), 0) FROM cost_ledger l JOIN jobs j"
        " ON j.id = l.job_id WHERE j.batch_id = ? AND l.status = 'charged'",
        (batch_id,),
    ).fetchone()[0]
    average = conn.execute(
        "SELECT AVG((julianday(finished_at) - julianday(started_at)) * 86400) FROM jobs"
        " WHERE batch_id = ? AND status = 'done' AND started_at IS NOT NULL",
        (batch_id,),
    ).fetchone()[0]
    left = jobs.queued + jobs.running
    eta = None
    if average is not None and left and not row["paused"]:
        eta = round(average * left / row["parallel"], 1)
    return BatchSummary(
        id=row["id"],
        episode_id=row["episode_id"],
        kind=row["kind"],
        model=row["model"],
        created_at=row["created_at"],
        paused=bool(row["paused"]),
        cancelled=bool(row["cancelled"]),
        retry_of=row["retry_of"],
        jobs=jobs,
        finished=left == 0,
        estimate=money(row["estimate_usd_micro"]),
        spent=money(int(spent)),
        eta_s=eta,
    )


def batch_jobs(conn: sqlite3.Connection, batch_id: str) -> list[Job]:
    rows = conn.execute("SELECT * FROM jobs WHERE batch_id = ? ORDER BY rowid", (batch_id,))
    return [Job.from_row(row) for row in rows.fetchall()]


def set_batch_paused(conn: sqlite3.Connection, batch_id: str, paused: bool) -> BatchSummary | None:
    """Пауза — флаг в БД: пул не берёт `queued` пачки, идущие доделывают; переживает перезапуск."""
    with conn:
        updated = conn.execute(
            "UPDATE batches SET paused = ? WHERE id = ?", (int(paused), batch_id)
        ).rowcount
        if not updated:
            return None
        return _emit_batch(conn, batch_id, _first_job_id(conn, batch_id))


def cancel_batch(conn: sqlite3.Connection, batch_id: str) -> list[Job]:
    """Отмена пачки: флаг и `cancelled` всех её `queued` одной транзакцией; `running`
    доделывают («Очередь отменена, начатые кадры дорисуются»). Отменённые не удаляются."""
    with conn:
        conn.execute("UPDATE batches SET cancelled = 1 WHERE id = ?", (batch_id,))
        cancelled = _cancel_queued(conn, "batch_id = ?", (batch_id,))
        _emit_batch(conn, batch_id, _first_job_id(conn, batch_id))
    return cancelled


def cancel_episode_jobs(conn: sqlite3.Connection, episode_id: str, kind: str) -> list[Job]:
    """`queued` джобы вида у выпуска — отменить, их пачки — отменёнными (новая версия плана
    снимает утверждение, принцип 10). Начатые доделывают."""
    with conn:
        cancelled = _cancel_queued(conn, "episode_id = ? AND kind = ?", (episode_id, kind))
        for batch_id in sorted({job.batch_id for job in cancelled if job.batch_id}):
            conn.execute("UPDATE batches SET cancelled = 1 WHERE id = ?", (batch_id,))
            _emit_batch(conn, batch_id, _first_job_id(conn, batch_id))
    return cancelled


def cancel_queued_jobs(conn: sqlite3.Connection, job_ids: Sequence[str]) -> list[Job]:
    """Отменить названные джобы, которые ещё ждут; начатые и законченные не трогаются. Пачки не
    отменяются — их сводка обновляется событием (правка кадра снимает его заказ, M6.11)."""
    if not job_ids:
        return []
    marks = ", ".join("?" for _ in job_ids)
    with conn:
        cancelled = _cancel_queued(conn, f"id IN ({marks})", tuple(job_ids))
        for batch_id in sorted({job.batch_id for job in cancelled if job.batch_id}):
            first = next(job.id for job in cancelled if job.batch_id == batch_id)
            _emit_batch(conn, batch_id, first)
    return cancelled


def _cancel_queued(conn: sqlite3.Connection, where: str, params: Sequence[Any]) -> list[Job]:
    rows = conn.execute(
        "UPDATE jobs SET status = 'cancelled', cancel_requested = 1, finished_at = ?"
        f" WHERE status = 'queued' AND {where} RETURNING *",
        (now_iso(), *params),
    ).fetchall()
    jobs = [Job.from_row(row) for row in rows]
    for job in jobs:
        _emit(conn, job, "job.cancelled", batch_event=False)
    return jobs


def _first_job_id(conn: sqlite3.Connection, batch_id: str) -> str:
    row = conn.execute(
        "SELECT id FROM jobs WHERE batch_id = ? ORDER BY rowid LIMIT 1", (batch_id,)
    ).fetchone()
    assert row is not None, f"batch {batch_id} without jobs"
    return str(row["id"])


def _emit_batch(conn: sqlite3.Connection, batch_id: str, job_id: str) -> BatchSummary:
    summary = batch_summary(conn, batch_id)
    assert summary is not None, f"batch {batch_id} is missing"
    insert_event(conn, job_id, "batch.updated", summary.model_dump(mode="json"))
    return summary
