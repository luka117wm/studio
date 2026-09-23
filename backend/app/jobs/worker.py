"""Пул воркеров: взятие джобов, вызов обработчиков, ретраи, отмена, пауза GPU на время рендера.

Воркеры — asyncio-задачи в потоке event loop. Синхронный обработчик уходит в пул потоков,
async-обработчик выполняется в loop. Переходы статусов делает только пул — своим соединением в
потоке loop (L-014); обработчик видит `JobContext`. Контракт обработчика — `docs/jobs.md`.
"""

import asyncio
import inspect
import logging
import math
import sqlite3
import threading
import time
from collections.abc import Awaitable, Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, cast

import httpx
from pydantic import BaseModel, ValidationError
from tenacity import (
    AsyncRetrying,
    RetryCallState,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)

from app.jobs import queue
from app.jobs.events import EventBus, prune_events
from app.jobs.queue import FinalStatus, Job
from app.storage.db import connect

log = logging.getLogger(__name__)

JobResult = dict[str, Any] | None
Resource = Literal["cpu", "gpu", "render"]
SyncHandler = Callable[["JobContext", Any], JobResult]
AsyncHandler = Callable[["JobContext", Any], Awaitable[JobResult]]

RETRY_WAIT_MAX_S = 30.0
PROGRESS_INTERVAL_S = 0.2
CANCEL_CHECK_INTERVAL_S = 0.1
POLL_S = 1.0
STOP_TIMEOUT_S = 5.0
ERROR_MAX_CHARS = 2000


class TransientError(Exception):
    """Временный сбой (сеть, перегрузка, 5xx) — джоб повторяется. Провайдеры (M2.6) переводят
    в него ошибки своих SDK, у которых нет HTTP-статуса в `status_code` / `response.status_code`."""


def http_status(exc: BaseException) -> int | None:
    """HTTP-статус ошибки, если он есть: httpx.HTTPStatusError, исключения SDK с `status_code`."""
    response = getattr(exc, "response", None)
    for candidate in (getattr(exc, "status_code", None), getattr(response, "status_code", None)):
        if isinstance(candidate, int):
            return candidate
    return None


def is_retryable(exc: BaseException) -> bool:
    """Повторяем только сеть и 5xx; 4xx и ошибки в коде повторять бессмысленно."""
    if isinstance(exc, TransientError | httpx.TransportError | ConnectionError | TimeoutError):
        return True
    status = http_status(exc)
    return status is not None and 500 <= status < 600


def describe(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc}"[:ERROR_MAX_CHARS]


@dataclass(frozen=True)
class HandlerSpec:
    kind: str
    fn: SyncHandler | AsyncHandler
    payload_model: type[BaseModel]
    # render — пока идёт, gpu-джобы не стартуют (принцип 12); cpu — без ограничений.
    resource: Resource = "cpu"


class JobContext:
    """Что видит обработчик: `progress()` и `cancelled()`. Годится из любого потока: в БД ходит
    короткими соединениями, записи прогресса — не чаще раза в `PROGRESS_INTERVAL_S`."""

    def __init__(
        self, job: Job, db_path: Path, notify: Callable[[], None], shutdown: threading.Event
    ) -> None:
        self.job_id = job.id
        self.kind = job.kind
        self.episode_id = job.episode_id
        self.attempt = job.attempts  # номер попытки с учётом прошлых стартов
        self.fraction = 0.0
        self.message: str | None = None
        self.stop_observed = False  # обработчик узнал об отмене или остановке
        self._db_path = db_path
        self._notify = notify
        self._shutdown = shutdown
        self._written_at = -math.inf
        self._checked_at = -math.inf
        self._cancel_flag = False

    def progress(self, fraction: float, message: str | None = None) -> None:
        self.fraction = min(max(float(fraction), 0.0), 1.0)
        self.message = message
        now = time.monotonic()
        if self.fraction < 1.0 and now - self._written_at < PROGRESS_INTERVAL_S:
            return  # последнее значение не теряется: его запишет конечный переход
        self._written_at = now
        conn = connect(self._db_path)
        try:
            queue.set_progress(conn, self.job_id, self.fraction, message)
        finally:
            conn.close()
        self._notify()

    def cancelled(self) -> bool:
        """Отмена пользователем (флаг в БД) или остановка бэкенда. Проверять между шагами."""
        stop = self._shutdown.is_set() or self._cancel_requested()
        if stop:
            self.stop_observed = True
        return stop

    def _cancel_requested(self) -> bool:
        now = time.monotonic()
        if not self._cancel_flag and now - self._checked_at >= CANCEL_CHECK_INTERVAL_S:
            self._checked_at = now
            conn = connect(self._db_path)
            try:
                self._cancel_flag = queue.is_cancel_requested(conn, self.job_id)
            finally:
                conn.close()
        return self._cancel_flag


class JobPool:
    """Воркеры очереди. `workers=0` — очередь без исполнения (тесты API)."""

    def __init__(
        self,
        db_path: Path,
        handlers: Mapping[str, HandlerSpec],
        bus: EventBus,
        *,
        workers: int,
        max_attempts: int,
        retry_wait_s: float,
    ) -> None:
        self.db_path = db_path
        self.handlers = dict(handlers)
        self.bus = bus
        # Ручная пауза GPU-джобов. Идущий render-джоб ставит паузу сам (`_paused_kinds`).
        self.gpu_paused = False
        self._workers = workers
        self._max_attempts = max_attempts
        self._retry_wait_s = retry_wait_s
        self._render_running = 0
        self._stopping = False
        self._shutdown = threading.Event()
        self._wake: asyncio.Event | None = None
        self._tasks: list[asyncio.Task[None]] = []
        self._executor: ThreadPoolExecutor | None = None
        self._conn: sqlite3.Connection | None = None

    # --- жизненный цикл ------------------------------------------------------------------------

    async def start(self) -> None:
        """Возврат прерванных джобов в очередь, чистка журнала, запуск воркеров."""
        self._conn = connect(self.db_path)
        recovered = queue.recover_running(self._conn)
        if recovered:
            log.warning(
                "jobs: %d interrupted job(s) back in queue: %s",
                len(recovered),
                ", ".join(job.id for job in recovered),
            )
        pruned = prune_events(self._conn)
        if pruned:
            log.info("jobs: pruned %d old event(s)", pruned)
        self._wake = asyncio.Event()
        if self._workers:
            self._executor = ThreadPoolExecutor(self._workers, thread_name_prefix="job")
            self._tasks = [
                asyncio.create_task(self._worker(), name=f"job-worker-{n}")
                for n in range(self._workers)
            ]
        log.info("jobs: %d worker(s), handlers: %s", self._workers, ", ".join(self.handlers))

    async def stop(self) -> None:
        """Штатная остановка: обработчики видят `cancelled()`, их джобы возвращаются в очередь.
        Кто не уложился в `STOP_TIMEOUT_S`, остаётся `running` и вернётся при следующем старте."""
        self._stopping = True
        self._shutdown.set()
        if self._wake is not None:
            self._wake.set()
        if self._tasks:
            _, pending = await asyncio.wait(self._tasks, timeout=STOP_TIMEOUT_S)
            if pending:
                log.warning("jobs: %d worker(s) did not stop in time", len(pending))
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
        if self._executor is not None:
            self._executor.shutdown(wait=False, cancel_futures=True)
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def kick(self) -> None:
        """Из потока loop, после постановки или отмены: разбудить воркеры и подписчиков SSE."""
        if self._wake is not None:
            self._wake.set()
        self.bus.notify()

    # --- воркер --------------------------------------------------------------------------------

    def _db(self) -> sqlite3.Connection:
        assert self._conn is not None, "JobPool is not started"
        return self._conn

    def _paused_kinds(self) -> list[str]:
        if not (self.gpu_paused or self._render_running):
            return []
        return [kind for kind, spec in self.handlers.items() if spec.resource == "gpu"]

    def _claim(self) -> Job | None:
        """Без await внутри: взятие и учёт рендера атомарны относительно других воркеров."""
        job = queue.claim(self._db(), self._paused_kinds())
        if job is None:
            return None
        self.bus.notify()
        spec = self.handlers.get(job.kind)
        if spec is not None and spec.resource == "render":
            self._render_running += 1
        return job

    async def _worker(self) -> None:
        assert self._wake is not None
        while not self._stopping:
            job = self._claim()
            if job is None:
                # Сброс и ожидание без await между ними: сигнал `kick()` не потеряется.
                self._wake.clear()
                try:
                    await asyncio.wait_for(self._wake.wait(), timeout=POLL_S)
                except TimeoutError:
                    pass
                continue
            try:
                await self._run(job)
            except Exception as exc:  # воркер не должен умирать из-за одного джоба
                log.exception("job %s (%s): worker error", job.id, job.kind)
                self._finish(job.id, "failed", progress=0.0, error=describe(exc))

    async def _run(self, job: Job) -> None:
        spec = self.handlers.get(job.kind)
        try:
            if spec is None:
                self._finish(
                    job.id,
                    "failed",
                    progress=0.0,
                    error=(
                        f"Нет обработчика для типа «{job.kind}». Обновите бэкенд или отмените джоб."
                    ),
                )
                return
            if job.attempts > self._max_attempts:
                self._finish(
                    job.id,
                    "failed",
                    progress=0.0,
                    error=(
                        f"Джоб стартовал {job.attempts - 1} раз и ни разу не завершился — похоже,"
                        " он роняет бэкенд. Посмотрите лог и поставьте джоб заново."
                    ),
                )
                return
            try:
                payload = spec.payload_model.model_validate(job.payload)
            except ValidationError as exc:
                self._finish(job.id, "failed", progress=0.0, error=f"Некорректный payload: {exc}")
                return
            ctx = JobContext(job, self.db_path, self.bus.notify_threadsafe, self._shutdown)
            result: JobResult = None
            error: Exception | None = None
            try:
                result = await self._with_retries(job, spec, ctx, payload)
            except Exception as exc:
                error = exc
            self._settle(job, ctx, result, error)
        finally:
            if spec is not None and spec.resource == "render":
                self._render_running -= 1
                self.kick()  # gpu-джобы ждали конца рендера

    async def _with_retries(
        self, job: Job, spec: HandlerSpec, ctx: JobContext, payload: BaseModel
    ) -> JobResult:
        def before_sleep(state: RetryCallState) -> None:
            exc = state.outcome.exception() if state.outcome else None
            ctx.attempt += 1
            wait = state.next_action.sleep if state.next_action else 0.0
            message = f"Повтор {ctx.attempt}/{self._max_attempts} через {wait:.0f} с: {exc}"
            log.warning("job %s (%s): %s", job.id, job.kind, message)
            queue.record_retry(self._db(), job.id, message)
            self.bus.notify()

        retrying = AsyncRetrying(
            # Попытки прошлых стартов (аварийный перезапуск) уже потрачены.
            stop=stop_after_attempt(self._max_attempts - job.attempts + 1),
            wait=wait_exponential(multiplier=self._retry_wait_s, max=RETRY_WAIT_MAX_S),
            retry=retry_if_exception(lambda exc: is_retryable(exc) and not ctx.cancelled()),
            before_sleep=before_sleep,
            reraise=True,
        )
        async for attempt in retrying:
            with attempt:
                return await self._call(spec, ctx, payload)
        raise AssertionError("unreachable: tenacity either returns or reraises")

    async def _call(self, spec: HandlerSpec, ctx: JobContext, payload: BaseModel) -> JobResult:
        if inspect.iscoroutinefunction(spec.fn):
            result = await cast(AsyncHandler, spec.fn)(ctx, payload)
        else:
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(
                self._executor, cast(SyncHandler, spec.fn), ctx, payload
            )
        if result is not None and not isinstance(result, dict):
            raise TypeError(f"handler {spec.kind} returned {type(result).__name__}, not dict")
        return result

    def _settle(
        self, job: Job, ctx: JobContext, result: JobResult, error: Exception | None
    ) -> None:
        """Итог джоба. Обработчик, который закончил работу, не заметив отмены, — это `done`."""
        stopped = ctx.stop_observed or error is not None
        if stopped and queue.is_cancel_requested(self._db(), job.id):
            self._finish(
                job.id, "cancelled", progress=ctx.fraction, message=ctx.message, result=result
            )
        elif stopped and self._shutdown.is_set():
            queue.requeue(self._db(), job.id, "Прерван остановкой бэкенда, продолжится позже.")
            self.bus.notify()
        elif error is not None:
            log.error("job %s (%s) failed", job.id, job.kind, exc_info=error)
            self._finish(
                job.id, "failed", progress=ctx.fraction, message=ctx.message, error=describe(error)
            )
        else:
            self._finish(job.id, "done", progress=1.0, message=ctx.message, result=result)

    def _finish(
        self,
        job_id: str,
        status: FinalStatus,
        *,
        progress: float,
        message: str | None = None,
        result: JobResult = None,
        error: str | None = None,
    ) -> None:
        queue.finish(
            self._db(),
            job_id,
            status,
            progress=progress,
            message=message,
            result=result,
            error=error,
        )
        self.bus.notify()
