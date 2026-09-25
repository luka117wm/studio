"""SSE `GET /api/events` (M2.5): формат кадров, heartbeat, порядок событий, догон по Last-Event-ID.

Поток бесконечный — гоняем через настоящий uvicorn в потоке, а не через TestClient.
"""

import json
import socket
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import uvicorn
from fastapi import FastAPI

from app.jobs.events import JobEvent, format_event, format_heartbeat
from app.main import create_app
from app.settings import Settings
from app.storage.db import connect

HEARTBEAT_S = 0.2


class LiveServer:
    def __init__(self, app: FastAPI) -> None:
        self._sock = socket.socket()
        self._sock.bind(("127.0.0.1", 0))
        self.base_url = f"http://127.0.0.1:{self._sock.getsockname()[1]}"
        # Открытый поток SSE не даёт uvicorn завершиться штатно — ограничиваем ожидание.
        config = uvicorn.Config(app, log_config=None, timeout_graceful_shutdown=1)
        self._server = uvicorn.Server(config)
        self._thread = threading.Thread(
            target=self._server.run, kwargs={"sockets": [self._sock]}, daemon=True
        )

    def __enter__(self) -> "LiveServer":
        self._thread.start()
        deadline = time.monotonic() + 10
        while not self._server.started:
            assert time.monotonic() < deadline, "uvicorn did not start"
            time.sleep(0.01)
        return self

    def __exit__(self, *_: object) -> None:
        self._server.should_exit = True
        self._thread.join(timeout=10)
        self._sock.close()


@pytest.fixture
def server(tmp_path: Path) -> Iterator[LiveServer]:
    settings = Settings(
        _env_file=None, studio_data_dir=tmp_path / "data", sse_heartbeat_s=HEARTBEAT_S
    )
    with LiveServer(create_app(settings)) as live:
        yield live


@pytest.fixture
def http(server: LiveServer) -> Iterator[httpx.Client]:
    with httpx.Client(base_url=server.base_url, timeout=5) as client:
        yield client


def frames(response: httpx.Response) -> Iterator[dict[str, str]]:
    """Кадры SSE как словари полей; комментарии не ждём."""
    frame: dict[str, str] = {}
    for line in response.iter_lines():
        if not line:
            if frame:
                yield frame
                frame = {}
            continue
        field, _, value = line.partition(":")
        frame[field] = value.removeprefix(" ")


def job_frames(stream: Iterator[dict[str, str]], job_id: str) -> list[dict[str, str]]:
    """Кадры событий джоба до `job.done` включительно; heartbeat пропускаются."""
    out: list[dict[str, str]] = []
    for frame in stream:
        if "id" not in frame or json.loads(frame["data"])["job_id"] != job_id:
            continue
        out.append(frame)
        if frame["event"] == "job.done":
            return out
    raise AssertionError("stream ended before job.done")


def start_sleep_job(http: httpx.Client, steps: int, step_s: float) -> str:
    response = http.post(
        "/api/jobs", json={"kind": "sleep_job", "payload": {"steps": steps, "step_s": step_s}}
    )
    assert response.status_code == 201, response.text
    job_id: str = response.json()["id"]
    return job_id


def wait_done(http: httpx.Client, job_id: str) -> dict[str, Any]:
    deadline = time.monotonic() + 10
    while True:
        job: dict[str, Any] = http.get(f"/api/jobs/{job_id}").json()
        if job["status"] == "done":
            return job
        assert time.monotonic() < deadline, f"job stuck in {job['status']}"
        time.sleep(0.02)


def test_frame_format() -> None:
    event = JobEvent(id=7, ts="2026-09-23T10:00:00+00:00", type="job.done", data='{"a": 1}')
    assert format_event(event) == 'id: 7\nevent: job.done\ndata: {"a": 1}\n\n'
    beat = format_heartbeat()
    assert beat.startswith("event: heartbeat\ndata: ") and "id:" not in beat


def test_headers_retry_and_heartbeat(http: httpx.Client) -> None:
    with http.stream("GET", "/api/events") as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["cache-control"] == "no-cache"
        assert response.headers["x-accel-buffering"] == "no"
        stream = frames(response)
        assert next(stream) == {"retry": "3000"}
        started = time.monotonic()
        beat = next(stream)
        assert beat["event"] == "heartbeat" and "id" not in beat
        assert time.monotonic() - started < HEARTBEAT_S + 1.0


def test_job_events_arrive_in_order(http: httpx.Client) -> None:
    with http.stream("GET", "/api/events") as response:
        stream = frames(response)
        next(stream)  # retry: курсор зафиксирован, дальше — только новые события
        job_id = start_sleep_job(http, steps=3, step_s=0.25)
        got = job_frames(stream, job_id)

    types = [frame["event"] for frame in got]
    assert types == ["job.queued", "job.started"] + ["job.progress"] * 3 + ["job.done"]
    ids = [int(frame["id"]) for frame in got]
    assert ids == sorted(ids) and len(set(ids)) == len(ids)
    progress = [json.loads(f["data"])["progress"] for f in got if f["event"] == "job.progress"]
    assert progress == pytest.approx([1 / 3, 2 / 3, 1.0])
    assert json.loads(got[-1]["data"])["status"] == "done"


def test_last_event_id_catch_up(http: httpx.Client, tmp_path: Path) -> None:
    with http.stream("GET", "/api/events") as response:
        stream = frames(response)
        next(stream)
        job_id = start_sleep_job(http, steps=4, step_s=0.25)
        for frame in stream:
            if frame.get("event") == "job.progress":
                last_seen = int(frame["id"])
                break
    # Обрыв: пока клиента нет, джоб доходит до конца.
    wait_done(http, job_id)
    conn = connect(tmp_path / "data" / "app.db")
    missed = [
        row["id"]
        for row in conn.execute("SELECT id FROM job_events WHERE id > ? ORDER BY id", (last_seen,))
    ]
    conn.close()
    assert missed

    # Переподключение, как у EventSource: заголовок Last-Event-ID.
    with http.stream("GET", "/api/events", headers={"Last-Event-ID": str(last_seen)}) as response:
        got = job_frames(frames(response), job_id)
    assert [int(frame["id"]) for frame in got] == missed  # ни пропусков, ни дублей

    # Первое подключение после снимка: курсор в query; заголовок, если есть, новее.
    with http.stream("GET", "/api/events", params={"last_event_id": last_seen}) as response:
        assert [int(frame["id"]) for frame in job_frames(frames(response), job_id)] == missed
    headers = {"Last-Event-ID": str(missed[-1])}
    params = {"last_event_id": last_seen}
    with http.stream("GET", "/api/events", headers=headers, params=params) as response:
        stream = frames(response)
        assert next(stream) == {"retry": "3000"}
        assert next(stream)["event"] == "heartbeat"  # догонять нечего
