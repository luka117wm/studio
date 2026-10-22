"""Окружение выпуска для тестов генерации (M6.2–M6.3): канон фикстуры опубликован, листы обоих
обликов 6/6 (записи M5.4, без вызовов модели), план из 20 кадров импортирован и утверждён через
API; провайдер — фейковый. Общий модуль тестов джоба кадра и пачки, не тест."""

import asyncio
import json
import shutil
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from fastapi.testclient import TestClient

from app.cost import ledger
from app.cost.ledger import LedgerRow
from app.jobs.queue import Job
from app.jobs.worker import JobContext
from app.main import create_app
from app.models.canon import Character, Period, Style
from app.models.canon_config import ANGLES, CanonConfig, load_canon_config
from app.models.director import Director
from app.models.project import Project
from app.pipeline.canon import anchors
from app.pipeline.canon.anchors import CandidateRecord
from app.pipeline.images.shot_job import ShotOrder, draw_shot, shot_order
from app.providers.fake import FakeProvider
from app.providers.gateway import Gateway
from app.settings import REPO_ROOT, Settings
from app.storage import canon_store
from app.storage.atomic import read_json, write_json_atomic
from app.storage.canon_store import CHARACTERS, PERIODS, STYLE
from app.storage.db import connect
from app.storage.paths import StudioPaths
from app.tools.seed import seed

FIXTURES = REPO_ROOT / "tests" / "fixtures"
CANON = FIXTURES / "canon"
PLAN: dict[str, Any] = json.loads((FIXTURES / "director_canon_20shots.json").read_text("utf-8"))
EPISODE = PLAN["meta"]["episode_id"]
BASE = f"/api/projects/{EPISODE}"
YOU, BOSUN = "you@powder-monkey-11", "bosun@caribbean-1716"
TERMINAL = {"done", "failed", "cancelled"}
SAFETY = (
    "Gemini не нарисовал картинку (IMAGE_SAFETY) — сработал фильтр безопасности: насилие и"
    " опасные действия — смягчите действие кадра."
)


def canon_json(name: str) -> Any:
    return json.loads((CANON / name).read_text(encoding="utf-8"))


def make_config(tmp_path: Path) -> Path:
    """Тестовые маршруты: у моделей кадров — лимит референсов Gemini 3 и подпись у одной."""
    config = tmp_path / "config"
    shutil.copytree(FIXTURES / "config", config)
    path = config / "providers.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    for entry in data["stages"]["images"]["catalog"].values():
        entry["max_refs"] = 14
    data["stages"]["images"]["catalog"]["small"]["label"] = "Fake Small"
    path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return config


def publish(paths: StudioPaths, layer: Any, entity_id: str | None, data: Any) -> None:
    canon_store.save_draft(paths, "cursus", layer, entity_id, data)
    canon_store.publish(paths, "cursus", layer, entity_id)


def make_sheet(paths: StudioPaths, config: CanonConfig, appearance_id: str) -> None:
    """Лист 6/6 версии v001 — записями M5.4, без вызовов модели."""
    s = anchors.appearance_set(paths, "cursus", appearance_id)
    for angle in ANGLES:
        path = s.files / f"{angle}-1-{abs(hash((appearance_id, angle))) % 10**16:016d}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"\x89PNG\r\n\x1a\n" + f"{appearance_id}/{angle}".encode())
        record = CandidateRecord(
            id=path.stem,
            slot=angle,
            n=1,
            status="ready",
            file=path.relative_to(s.root).as_posix(),
            seed=1,
            version="v001",
            canon={},
            created_at="2026-10-16T00:00:00+00:00",
        )
        anchors.record_candidate(s, record)
        anchors.choose(paths, "cursus", appearance_id, angle, record.id, config)


@dataclass
class Env:
    client: TestClient
    paths: StudioPaths
    gateway: Gateway
    fake: FakeProvider
    config: CanonConfig

    def post(self, url: str, body: dict[str, Any] | None = None, status: int = 201) -> Any:
        response = self.client.post(url, json=body)
        assert response.status_code == status, response.text
        return response.json()

    def get(self, url: str) -> Any:
        response = self.client.get(url)
        assert response.status_code == 200, response.text
        return response.json()

    def generate(self, shot_id: str, model: str | None = None, status: int = 201) -> Any:
        body = {} if model is None else {"model": model}
        return self.post(f"{BASE}/shots/{shot_id}/generate", body, status)

    def wait(self, job_id: str) -> dict[str, Any]:
        deadline = time.monotonic() + 10
        while True:
            state: dict[str, Any] = self.get(f"/api/jobs/{job_id}")
            if state["status"] in TERMINAL:
                return state
            assert time.monotonic() < deadline, f"job {job_id} stuck: {state}"
            time.sleep(0.02)

    def draw(self, shot_id: str, model: str | None = None) -> dict[str, Any]:
        return self.wait(self.generate(shot_id, model)["id"])

    def project(self) -> dict[str, Any]:
        data: dict[str, Any] = read_json(self.paths.project_path("cursus", EPISODE))
        return data

    def write_project(self, data: dict[str, Any]) -> None:
        write_json_atomic(self.paths.project_path("cursus", EPISODE), data)

    def shot(self, shot_id: str) -> dict[str, Any]:
        state: dict[str, Any] = self.project()["shots"][shot_id]
        return state

    def images_ledger(self) -> list[LedgerRow]:
        conn = connect(self.paths.db_path)
        try:
            rows = ledger.list_rows(conn, channel="cursus")
        finally:
            conn.close()
        return [row for row in rows if row.stage == "images"]

    def order(self, shot_id: str, variant: int = 1, model: str | None = None) -> ShotOrder:
        project = Project.model_validate(self.project())
        assert project.director_version is not None
        director = Director.model_validate(
            read_json(
                self.paths.director_version_path(
                    "cursus", EPISODE, int(project.director_version[1:])
                )
            )
        )
        return shot_order(
            self.paths,
            self.gateway,
            self.config,
            channel="cursus",
            project=project,
            director=director,
            shot_id=shot_id,
            variant=variant,
            model=model,
        )


def set_budgets(paths: StudioPaths, **budgets: float) -> None:
    profile = read_json(paths.profile_path("cursus"))
    profile["budgets"].update(budgets)
    write_json_atomic(paths.profile_path("cursus"), profile)


def env_settings(tmp_path: Path, *, workers: int = 1, **overrides: Any) -> Settings:
    """Настройки окружения: тот же каталог данных и конфиг при повторном вызове (перезапуск)."""
    config_dir = tmp_path / "config"
    if not config_dir.exists():
        make_config(tmp_path)
    return Settings(
        _env_file=None,
        studio_data_dir=tmp_path / "data",
        config_dir=config_dir,
        job_workers=workers,
        job_retry_wait_s=0,
        **overrides,
    )


@contextmanager
def make_env(
    tmp_path: Path, *, workers: int = 1, approve: bool = True, **overrides: Any
) -> Iterator[Env]:
    """Окружение выпуска; `overrides` — поля `Settings` (например, `images_parallel`)."""
    settings = env_settings(tmp_path, workers=workers, **overrides)
    app = create_app(settings)
    paths = StudioPaths(settings.studio_data_dir)
    gateway: Gateway = app.state.gateway
    fake = gateway.registry.provider("fake")
    assert isinstance(fake, FakeProvider)
    config = load_canon_config(settings.config_dir / "canon.yaml")
    with TestClient(app) as client:
        conn = connect(paths.db_path)
        try:
            seed(paths, conn)
        finally:
            conn.close()
        publish(paths, STYLE, None, Style.model_validate(canon_json("style_cursus.json")))
        publish(
            paths,
            PERIODS,
            "caribbean-1716",
            Period.model_validate(canon_json("period_caribbean_1716.json")),
        )
        publish(
            paths, CHARACTERS, "you", Character.model_validate(canon_json("character_you.json"))
        )
        publish(
            paths,
            CHARACTERS,
            "bosun",
            Character.model_validate(canon_json("character_bosun.json")),
        )
        for appearance_id in (YOU, BOSUN):
            make_sheet(paths, config, appearance_id)
        env = Env(client, paths, gateway, fake, config)
        env.post("/api/episodes", {"id": EPISODE, "channel": "cursus", "title": "Pirates"})
        env.post(f"{BASE}/director", PLAN, 200)
        if approve:
            env.post(f"/api/episodes/{EPISODE}/approve", None, 200)
        yield env


def run_handler(env: Env, job: dict[str, Any]) -> dict[str, Any]:
    """Обработчик кадра вне пула — как его вызвал бы воркер."""
    ctx = JobContext(
        Job.model_validate(job),
        env.paths.db_path,
        lambda: None,
        threading.Event(),
        env.gateway,
    )
    return asyncio.run(draw_shot(ctx, ShotOrder.model_validate(job["payload"])))
