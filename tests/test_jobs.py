"""Очередь джобов (M2.5): идемпотентность, взятие, ретраи, пачки, отмена, пауза GPU, kill -9."""

import os
import socket
import sqlite3
import subprocess
import sys
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any, Literal

import httpx
import pytest
from fastapi.testclient import TestClient

from app.jobs import queue
from app.jobs.handlers import builtin_handlers
from app.jobs.queue import NewJob
from app.jobs.worker import HandlerSpec, JobContext, TransientError, is_retryable
from app.main import create_app
from app.models.director import StrictModel
from app.settings import REPO_ROOT, Settings
from app.storage.db import connect, migrate

TERMINAL = ("done", "failed", "cancelled")

# --- тестовые обработчики ------------------------------------------------------------------------


class FlakyPayload(StrictModel):
    fail_times: int = 0
    error: Literal["transient", "http503", "http404", "http429", "value"] = "transient"


def _error(kind: str) -> Exception:
    request = httpx.Request("POST", "https://provider.test/v1/generate")
    if kind == "transient":
        return TransientError("provider overloaded")
    if kind.startswith("http"):
        status = int(kind.removeprefix("http"))
        headers = {"Retry-After": "0.3"} if status == 429 else None
        response = httpx.Response(status, request=request, headers=headers)
        return httpx.HTTPStatusError(f"HTTP {status}", request=request, response=response)
    return ValueError("bad input")


def flaky_job(ctx: JobContext, payload: FlakyPayload) -> dict[str, int]:
    """Падает на первых `fail_times` попытках, потом успешен."""
    if ctx.attempt <= payload.fail_times:
        raise _error(payload.error)
    return {"attempt": ctx.attempt}


class HoldPayload(StrictModel):
    seconds: float = 0.5


def hold_job(ctx: JobContext, payload: HoldPayload) -> dict[str, bool]:
    deadline = time.monotonic() + payload.seconds
    while time.monotonic() < deadline:
        if ctx.cancelled():
            return {"stopped": True}
        time.sleep(0.01)
    return {"stopped": False}


def make_handlers() -> dict[str, HandlerSpec]:
    handlers = builtin_handlers()
    handlers["flaky_job"] = HandlerSpec("flaky_job", flaky_job, FlakyPayload)
    handlers["render_job"] = HandlerSpec("render_job", hold_job, HoldPayload, resource="render")
    handlers["gpu_job"] = HandlerSpec("gpu_job", hold_job, HoldPayload, resource="gpu")
    return handlers


# --- помощники -----------------------------------------------------------------------------------


def job_settings(tmp_path: Path, **overrides: Any) -> Settings:
    return Settings(
        _env_file=None, studio_data_dir=tmp_path / "data", job_retry_wait_s=0, **overrides
    )


def wait_for[T](
    predicate: Callable[[], T | None], timeout: float = 5.0, interval: float = 0.01
) -> T:
    deadline = time.monotonic() + timeout
    while True:
        value = predicate()
        if value:
            return value
        if time.monotonic() > deadline:
            raise AssertionError(f"condition not met in {timeout} s")
        time.sleep(interval)


def post_job(
    client: TestClient, kind: str, payload: dict[str, Any] | None = None, **fields: Any
) -> dict[str, Any]:
    response = client.post("/api/jobs", json={"kind": kind, "payload": payload or {}, **fields})
    assert response.status_code == 201, response.text
    job: dict[str, Any] = response.json()
    return job


def wait_job(
    client: TestClient, job_id: str, statuses: tuple[str, ...] = TERMINAL, timeout: float = 5.0
) -> dict[str, Any]:
    def check() -> dict[str, Any] | None:
        job: dict[str, Any] = client.get(f"/api/jobs/{job_id}").json()
        return job if job["status"] in statuses else None

    return wait_for(check, timeout)


def events_of(db_path: Path, job_id: str) -> list[tuple[int, str]]:
    conn = connect(db_path)
    try:
        rows = conn.execute(
            "SELECT id, type FROM job_events WHERE job_id = ? ORDER BY id", (job_id,)
        ).fetchall()
    finally:
        conn.close()
    return [(row["id"], row["type"]) for row in rows]


@pytest.fixture
def db(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    path = tmp_path / "data" / "app.db"
    migrate(path)
    conn = connect(path)
    yield conn
    conn.close()


@pytest.fixture
def jobs_client(tmp_path: Path) -> Iterator[TestClient]:
    with TestClient(create_app(job_settings(tmp_path), make_handlers())) as client:
        yield client


@pytest.fixture
def idle_client(tmp_path: Path) -> Iterator[TestClient]:
    """Очередь без воркеров: джобы остаются `queued`."""
    app = create_app(job_settings(tmp_path, job_workers=0), make_handlers())
    with TestClient(app) as client:
        yield client


# --- очередь -------------------------------------------------------------------------------------


def test_enqueue_same_key_returns_existing(db: sqlite3.Connection, tmp_path: Path) -> None:
    first, created = queue.enqueue(db, NewJob("sleep_job", {"steps": 1}, idempotency_key="k1"))
    again, created_again = queue.enqueue(
        db, NewJob("sleep_job", {"steps": 9}, idempotency_key="k1")
    )
    assert created and not created_again
    assert again.id == first.id and again.payload == {"steps": 1}
    # Без ключа дедупликации нет.
    queue.enqueue(db, NewJob("sleep_job"))
    queue.enqueue(db, NewJob("sleep_job"))
    assert db.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 3
    assert [t for _, t in events_of(tmp_path / "data" / "app.db", first.id)] == ["job.queued"]


def test_claim_is_fifo_counts_attempts_and_skips_excluded(db: sqlite3.Connection) -> None:
    a, _ = queue.enqueue(db, NewJob("sleep_job"))
    gpu, _ = queue.enqueue(db, NewJob("gpu_job"))
    b, _ = queue.enqueue(db, NewJob("sleep_job"))

    first = queue.claim(db, exclude_kinds={"gpu_job"})
    second = queue.claim(db, exclude_kinds={"gpu_job"})
    assert first is not None and second is not None
    assert (first.id, second.id) == (a.id, b.id)
    assert first.status == "running" and first.attempts == 1 and first.started_at
    assert queue.claim(db, exclude_kinds={"gpu_job"}) is None
    third = queue.claim(db)
    assert third is not None and third.id == gpu.id


def test_recover_running_keeps_attempts(db: sqlite3.Connection) -> None:
    job, _ = queue.enqueue(db, NewJob("sleep_job"))
    queue.claim(db)
    recovered = queue.recover_running(db)
    assert [j.id for j in recovered] == [job.id]
    back = queue.get_job(db, job.id)
    assert back is not None and back.status == "queued" and back.attempts == 1


def test_request_cancel(db: sqlite3.Connection) -> None:
    queued, _ = queue.enqueue(db, NewJob("sleep_job"))
    running, _ = queue.enqueue(db, NewJob("sleep_job"))
    cancelled = queue.request_cancel(db, queued.id)
    assert cancelled is not None and cancelled.status == "cancelled" and cancelled.finished_at

    assert queue.claim(db) is not None  # берёт второй: отменённый не выдаётся
    flagged = queue.request_cancel(db, running.id)
    assert flagged is not None and flagged.status == "running" and flagged.cancel_requested
    assert queue.is_cancel_requested(db, running.id)
    assert queue.request_cancel(db, "missing") is None


@pytest.mark.parametrize(
    ("exc", "expected"),
    [
        (TransientError("overloaded"), True),
        (httpx.ConnectError("refused"), True),
        (httpx.ReadTimeout("slow"), True),
        (ConnectionResetError(), True),
        (_error("http503"), True),
        (_error("http404"), False),
        (_error("http429"), True),  # 429 повторяем с учётом Retry-After (M2.6)
        (ValueError("bug"), False),
    ],
)
def test_is_retryable(exc: Exception, expected: bool) -> None:
    assert is_retryable(exc) is expected


# --- API и пул -----------------------------------------------------------------------------------


def test_api_same_idempotency_key_no_duplicate(idle_client: TestClient) -> None:
    body = {"kind": "sleep_job", "payload": {"steps": 2}, "idempotency_key": "shot-s001"}
    first = idle_client.post("/api/jobs", json=body)
    second = idle_client.post("/api/jobs", json=body)
    assert (first.status_code, second.status_code) == (201, 200)
    assert first.json()["id"] == second.json()["id"]
    listing = idle_client.get("/api/jobs").json()
    assert len(listing["items"]) == 1 and listing["summary"]["total"] == 1
    # payload нормализован моделью обработчика: значения по умолчанию на месте.
    assert first.json()["payload"] == {"steps": 2, "step_s": 1.0, "fail_at_step": None}


def test_api_rejects_bad_requests(idle_client: TestClient) -> None:
    assert idle_client.post("/api/jobs", json={"kind": "nope"}).status_code == 422
    bad_payload = {"kind": "sleep_job", "payload": {"steps": 0}}
    assert idle_client.post("/api/jobs", json=bad_payload).status_code == 422
    no_episode = {"kind": "sleep_job", "episode_id": "c99-missing"}
    assert idle_client.post("/api/jobs", json=no_episode).status_code == 404
    assert idle_client.get("/api/jobs/missing").status_code == 404
    assert idle_client.post("/api/jobs/missing/cancel").status_code == 404


def test_transient_errors_are_retried(jobs_client: TestClient) -> None:
    job = post_job(jobs_client, "flaky_job", {"fail_times": 2, "error": "transient"})
    done = wait_job(jobs_client, job["id"])
    assert done["status"] == "done"
    assert done["attempts"] == 3 and done["result"] == {"attempt": 3}


def test_5xx_exhausts_attempts(jobs_client: TestClient) -> None:
    job = post_job(jobs_client, "flaky_job", {"fail_times": 5, "error": "http503"})
    failed = wait_job(jobs_client, job["id"])
    assert failed["status"] == "failed" and failed["attempts"] == 3
    assert "503" in failed["error"]


def test_429_waits_for_retry_after(jobs_client: TestClient) -> None:
    """Экспонента в тестах — 0 с, пауза перед повтором — из `Retry-After: 0.3`."""
    started = time.monotonic()
    job = post_job(jobs_client, "flaky_job", {"fail_times": 1, "error": "http429"})
    done = wait_job(jobs_client, job["id"])
    assert done["status"] == "done" and done["attempts"] == 2
    assert time.monotonic() - started >= 0.3


@pytest.mark.parametrize("error", ["http404", "value"])
def test_4xx_and_code_errors_are_not_retried(jobs_client: TestClient, error: str) -> None:
    job = post_job(jobs_client, "flaky_job", {"fail_times": 5, "error": error})
    failed = wait_job(jobs_client, job["id"])
    assert failed["status"] == "failed" and failed["attempts"] == 1


def test_batch_item_failure_does_not_stop_batch(jobs_client: TestClient) -> None:
    ids = []
    for i in range(5):
        payload = {"steps": 2, "step_s": 0.01, "fail_at_step": 1 if i == 2 else None}
        ids.append(post_job(jobs_client, "sleep_job", payload, batch_id="b1")["id"])
    post_job(jobs_client, "sleep_job", {"steps": 1, "step_s": 0}, batch_id="other")

    def batch_finished() -> dict[str, Any] | None:
        listing: dict[str, Any] = jobs_client.get("/api/jobs", params={"batch": "b1"}).json()
        summary = listing["summary"]
        return listing if summary["done"] + summary["failed"] == 5 else None

    listing = wait_for(batch_finished)
    assert listing["summary"] == {
        "total": 5,
        "queued": 0,
        "running": 0,
        "done": 4,
        "failed": 1,
        "cancelled": 0,
    }
    assert [item["id"] for item in listing["items"]] == ids  # порядок постановки
    failed = listing["items"][2]
    assert failed["status"] == "failed" and failed["attempts"] == 1
    assert "шаге 1" in failed["error"]
    assert listing["last_event_id"] > 0


def test_cancel_running_stops_within_one_step(jobs_client: TestClient) -> None:
    step_s = 0.2
    job = post_job(jobs_client, "sleep_job", {"steps": 20, "step_s": step_s})
    wait_for(lambda: jobs_client.get(f"/api/jobs/{job['id']}").json()["progress"] > 0)

    started = time.monotonic()
    flagged = jobs_client.post(f"/api/jobs/{job['id']}/cancel").json()
    assert flagged["status"] == "running" and flagged["cancel_requested"]
    cancelled = wait_job(jobs_client, job["id"])
    elapsed = time.monotonic() - started

    assert cancelled["status"] == "cancelled"
    assert elapsed < step_s + 0.3, f"cancel took {elapsed:.2f} s"
    steps_done = cancelled["result"]["steps_done"]
    assert 0 < steps_done < 20
    assert cancelled["progress"] == pytest.approx(steps_done / 20)  # сделанное сохранено


def test_cancel_queued_and_finished(idle_client: TestClient, tmp_path: Path) -> None:
    job = post_job(idle_client, "sleep_job")
    cancelled = idle_client.post(f"/api/jobs/{job['id']}/cancel")
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    # повторная отмена отменённого — не ошибка
    assert idle_client.post(f"/api/jobs/{job['id']}/cancel").status_code == 200

    done = post_job(idle_client, "sleep_job")
    conn = connect(tmp_path / "data" / "app.db")
    conn.execute("UPDATE jobs SET status = 'done' WHERE id = ?", (done["id"],))
    conn.commit()
    conn.close()
    assert idle_client.post(f"/api/jobs/{done['id']}/cancel").status_code == 409


def test_gpu_jobs_wait_for_render(jobs_client: TestClient, tmp_path: Path) -> None:
    render = post_job(jobs_client, "render_job", {"seconds": 0.6})
    wait_job(jobs_client, render["id"], ("running",))
    gpu = post_job(jobs_client, "gpu_job", {"seconds": 0.05})
    cpu = post_job(jobs_client, "sleep_job", {"steps": 1, "step_s": 0})

    assert wait_job(jobs_client, cpu["id"])["status"] == "done"  # cpu рендер не ждёт
    assert jobs_client.get(f"/api/jobs/{gpu['id']}").json()["status"] == "queued"
    assert wait_job(jobs_client, gpu["id"])["status"] == "done"

    db_path = tmp_path / "data" / "app.db"
    render_done = dict((t, i) for i, t in events_of(db_path, render["id"]))["job.done"]
    gpu_started = dict((t, i) for i, t in events_of(db_path, gpu["id"]))["job.started"]
    assert gpu_started > render_done


def test_manual_gpu_pause(jobs_client: TestClient) -> None:
    pool = jobs_client.app.state.jobs  # type: ignore[attr-defined]
    pool.gpu_paused = True
    gpu = post_job(jobs_client, "gpu_job", {"seconds": 0})
    time.sleep(0.3)
    assert jobs_client.get(f"/api/jobs/{gpu['id']}").json()["status"] == "queued"
    pool.gpu_paused = False
    assert wait_job(jobs_client, gpu["id"], timeout=3)["status"] == "done"  # опрос раз в секунду


# --- перезапуски ---------------------------------------------------------------------------------


def test_crash_recovery_and_poison_job(tmp_path: Path) -> None:
    db_path = tmp_path / "data" / "app.db"
    migrate(db_path)
    conn = connect(db_path)
    survivor, _ = queue.enqueue(conn, NewJob("sleep_job", {"steps": 1, "step_s": 0}))
    poison, _ = queue.enqueue(conn, NewJob("sleep_job", {"steps": 1, "step_s": 0}))
    # Как после kill -9: survivor упал один раз, poison — три (попыток больше нет).
    conn.execute("UPDATE jobs SET status = 'running', attempts = 1 WHERE id = ?", (survivor.id,))
    conn.execute("UPDATE jobs SET status = 'running', attempts = 3 WHERE id = ?", (poison.id,))
    conn.commit()
    conn.close()

    with TestClient(create_app(job_settings(tmp_path), make_handlers())) as client:
        ok = wait_job(client, survivor.id)
        bad = wait_job(client, poison.id)
    assert ok["status"] == "done" and ok["attempts"] == 2
    assert bad["status"] == "failed" and "роняет бэкенд" in bad["error"]


def test_graceful_shutdown_requeues_running_job(tmp_path: Path) -> None:
    app = create_app(job_settings(tmp_path), make_handlers())
    with TestClient(app) as client:
        job = post_job(client, "sleep_job", {"steps": 100, "step_s": 0.05})
        wait_job(client, job["id"], ("running",))
    conn = connect(tmp_path / "data" / "app.db")
    back = queue.get_job(conn, job["id"])
    conn.close()
    assert back is not None and back.status == "queued"
    assert back.attempts == 0  # штатная остановка попыткой не считается
    assert events_of(tmp_path / "data" / "app.db", job["id"])[-1][1] == "job.queued"


# --- kill -9 -------------------------------------------------------------------------------------


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port: int = sock.getsockname()[1]
        return port


def _start_backend(data_dir: Path, port: int, log_path: Path) -> subprocess.Popen[bytes]:
    env = {**os.environ, "STUDIO_DATA_DIR": str(data_dir), "JOB_WORKERS": "3"}
    with log_path.open("ab") as log:
        proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--app-dir", "backend"]
            + ["--host", "127.0.0.1", "--port", str(port)],
            cwd=REPO_ROOT,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )

    def healthy() -> bool:
        if proc.poll() is not None:
            raise AssertionError(f"backend exited: {log_path.read_text()[-2000:]}")
        try:
            return httpx.get(f"http://127.0.0.1:{port}/api/health", timeout=0.5).is_success
        except httpx.TransportError:
            return False

    wait_for(healthy, timeout=20, interval=0.1)
    return proc


def _batch_rows(db_path: Path) -> dict[str, dict[str, Any]]:
    conn = connect(db_path)
    try:
        rows = conn.execute("SELECT * FROM jobs WHERE batch_id = 'kill9'").fetchall()
    finally:
        conn.close()
    return {row["id"]: dict(row) for row in rows}


def test_kill_9_mid_batch_resumes_without_repeats(tmp_path: Path) -> None:
    """Приёмка M2.5: пачка из 10, SIGKILL посреди, рестарт — пачка доходит до конца без повторов."""
    data_dir, log_path = tmp_path / "data", tmp_path / "backend.log"
    db_path = data_dir / "app.db"
    port = _free_port()
    base = f"http://127.0.0.1:{port}"
    bodies = [
        {
            "kind": "sleep_job",
            "payload": {"steps": 5, "step_s": 0.1},
            "batch_id": "kill9",
            "idempotency_key": f"kill9-{i}",
        }
        for i in range(10)
    ]

    proc = _start_backend(data_dir, port, log_path)
    try:
        with httpx.Client(base_url=base, timeout=5) as http:
            for body in bodies:
                assert http.post("/api/jobs", json=body).status_code == 201

            def summary() -> dict[str, int]:
                result: dict[str, int] = http.get("/api/jobs", params={"batch": "kill9"}).json()[
                    "summary"
                ]
                return result

            wait_for(lambda: summary()["done"] >= 4, timeout=15, interval=0.02)
        proc.kill()  # SIGKILL: ни lifespan, ни finally — как падение процесса
        proc.wait(timeout=5)
    finally:
        if proc.poll() is None:
            proc.kill()

    before = _batch_rows(db_path)
    done_before = {i for i, row in before.items() if row["status"] == "done"}
    running_before = {i for i, row in before.items() if row["status"] == "running"}
    assert len(done_before) >= 4 and running_before, "kill must hit the middle of the batch"

    proc = _start_backend(data_dir, port, log_path)
    try:
        with httpx.Client(base_url=base, timeout=5) as http:
            # Повторная постановка той же пачки после рестарта — дублей нет.
            assert {http.post("/api/jobs", json=b).status_code for b in bodies} == {200}

            def all_done() -> bool:
                listing = http.get("/api/jobs", params={"batch": "kill9"}).json()
                return bool(listing["summary"]["done"] == 10)

            wait_for(all_done, timeout=15, interval=0.05)
    finally:
        proc.kill()
        proc.wait(timeout=5)

    after = _batch_rows(db_path)
    assert len(after) == 10
    for job_id in done_before:  # сделанное до падения не выполнялось заново
        assert after[job_id]["attempts"] == 1
        assert after[job_id]["finished_at"] == before[job_id]["finished_at"]
    for job_id in running_before:  # прерванные — ровно один перезапуск
        assert after[job_id]["attempts"] == 2
    conn = connect(db_path)
    done_events = conn.execute(
        "SELECT job_id, COUNT(*) AS n FROM job_events WHERE type = 'job.done' GROUP BY job_id"
    ).fetchall()
    conn.close()
    assert len(done_events) == 10 and all(row["n"] == 1 for row in done_events)
