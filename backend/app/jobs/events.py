"""События джобов: журнал в SQLite, будильник подписчиков и поток SSE для `GET /api/events`.

Источник событий один — таблица `job_events`: строка пишется в одной транзакции с переходом
джоба (`queue.py`), её id — это id события SSE. Поэтому клиент догоняет пропущенное по
`Last-Event-ID` и после обрыва, и после перезапуска бэкенда. В памяти — только сигнал «есть
новое» (`EventBus`); потерянный сигнал перекрывает опрос журнала раз в секунду.
Формат — `docs/jobs.md`.
"""

import asyncio
import json
import sqlite3
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from app.storage.db import connect, now_iso

EventType = Literal[
    "job.queued", "job.started", "job.progress", "job.done", "job.failed", "job.cancelled"
]

EVENT_RETENTION = timedelta(hours=24)
READ_BATCH = 500
POLL_S = 1.0
RECONNECT_MS = 3000
# no-cache — не кэшировать поток; X-Accel-Buffering — не буферизовать в прокси, которые его знают.
SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


@dataclass(frozen=True)
class JobEvent:
    id: int
    ts: str
    type: str
    data: str  # JSON одной строкой, как лежит в журнале


def insert_event(
    conn: sqlite3.Connection, job_id: str, event_type: EventType, data: dict[str, Any]
) -> None:
    """Строка журнала. Без commit: пишется в транзакции перехода, которую ведёт `queue.py`."""
    conn.execute(
        "INSERT INTO job_events (ts, job_id, type, data) VALUES (?, ?, ?, ?)",
        (now_iso(), job_id, event_type, json.dumps(data, ensure_ascii=False)),
    )


def latest_event_id(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT COALESCE(MAX(id), 0) FROM job_events").fetchone()
    return int(row[0])


def read_events_after(
    conn: sqlite3.Connection, after_id: int, limit: int = READ_BATCH
) -> list[JobEvent]:
    rows = conn.execute(
        "SELECT id, ts, type, data FROM job_events WHERE id > ? ORDER BY id LIMIT ?",
        (after_id, limit),
    ).fetchall()
    return [JobEvent(id=r["id"], ts=r["ts"], type=r["type"], data=r["data"]) for r in rows]


def prune_events(conn: sqlite3.Connection) -> int:
    """Удаляет события старше суток. AUTOINCREMENT не переиспользует id — курсоры клиентов целы."""
    cutoff = (datetime.now(UTC) - EVENT_RETENTION).isoformat(timespec="seconds")
    with conn:
        cursor = conn.execute("DELETE FROM job_events WHERE ts < ?", (cutoff,))
    return cursor.rowcount


def format_event(event: JobEvent) -> str:
    return f"id: {event.id}\nevent: {event.type}\ndata: {event.data}\n\n"


def format_heartbeat() -> str:
    # Без `id:` — heartbeat не сдвигает Last-Event-ID клиента.
    return f'event: heartbeat\ndata: {{"ts": "{now_iso()}"}}\n\n'


class EventBus:
    """Будильник подписчиков SSE: «в журнале есть новое». Сами события здесь не хранятся."""

    def __init__(self) -> None:
        self._waiters: set[asyncio.Event] = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self.closed = False

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        """Привязка к loop приложения — для сигналов из потоков обработчиков."""
        self._loop = loop
        self.closed = False

    @contextmanager
    def subscribe(self) -> Iterator[asyncio.Event]:
        wake = asyncio.Event()
        self._waiters.add(wake)
        try:
            yield wake
        finally:
            self._waiters.discard(wake)

    def notify(self) -> None:
        """Только из потока loop."""
        for wake in self._waiters:
            wake.set()

    def notify_threadsafe(self) -> None:
        """Из любого потока: сигнал уходит в loop. Закрытый loop — сигнал некому слушать."""
        loop = self._loop
        if loop is None:
            return
        try:
            loop.call_soon_threadsafe(self.notify)
        except RuntimeError:
            pass

    def close(self) -> None:
        self.closed = True
        self.notify()


async def stream_events(
    db_path: Path,
    bus: EventBus,
    after_id: int | None,
    heartbeat_s: float,
    is_disconnected: Callable[[], Awaitable[bool]],
) -> AsyncIterator[str]:
    """Кадры SSE: события журнала после `after_id` (без курсора — только новые) и heartbeat.

    Генератор живёт в потоке loop, соединение — своё на поток (L-014).
    """
    conn = connect(db_path)
    try:
        cursor = latest_event_id(conn) if after_id is None else after_id
        yield f"retry: {RECONNECT_MS}\n\n"
        beat_at = time.monotonic() + heartbeat_s
        with bus.subscribe() as wake:
            while not bus.closed and not await is_disconnected():
                # Сначала сбросить сигнал, потом читать: запись после чтения разбудит снова.
                wake.clear()
                events = read_events_after(conn, cursor)
                for event in events:
                    yield format_event(event)
                    cursor = event.id
                if len(events) == READ_BATCH:
                    continue
                now = time.monotonic()
                if now >= beat_at:
                    yield format_heartbeat()
                    beat_at = now + heartbeat_s
                try:
                    await asyncio.wait_for(wake.wait(), timeout=min(POLL_S, beat_at - now))
                except TimeoutError:
                    pass
    finally:
        conn.close()
