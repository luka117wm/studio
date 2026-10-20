"""M5.4: листы опорных портретов и кадры стиля — заказ, джобы, выбор и отбраковка, устаревание,
копия облика, деньги. Провайдер этапа `anchors` — фейковый (`provider: fake`), сеть не нужна;
джобы идут настоящим пулом воркеров приложения."""

import hashlib
import json
import shutil
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest
import yaml
from fastapi.testclient import TestClient

from app.cost import ledger
from app.cost.ledger import LedgerRow
from app.jobs import queue
from app.jobs.events import read_events_after
from app.jobs.handlers.anchors import ANGLE_KIND
from app.jobs.queue import NewJob
from app.main import create_app
from app.models.canon_config import ANGLES, BODY_ANGLES, load_canon_config
from app.pipeline.bridge import PROMPTS_DIR, load_templates
from app.pipeline.canon import anchors, episode_canon
from app.providers.base import ProviderError
from app.providers.fake import FakeProvider
from app.settings import REPO_ROOT, Settings
from app.storage.atomic import read_json, write_json_atomic
from app.storage.db import connect
from app.storage.paths import StudioPaths
from app.tools.seed import seed

FIXTURE_CONFIG = REPO_ROOT / "tests" / "fixtures" / "config"
CANON = REPO_ROOT / "tests" / "fixtures" / "canon"
STYLE = json.loads((CANON / "style_cursus.json").read_text(encoding="utf-8"))
PERIOD = json.loads((CANON / "period_caribbean_1716.json").read_text(encoding="utf-8"))
CHARACTER = json.loads((CANON / "character_you.json").read_text(encoding="utf-8"))
BASE = "/api/canon/cursus"
LOOK = "you@powder-monkey-11"
SHEET_URL = f"{BASE}/appearances/{LOOK}/anchors"
PRICE = 134_000  # фикстура прайса: fake-anchor 1K — $0.134
TERMINAL = ("done", "failed", "cancelled")


def edit_yaml(path: Path, change: Callable[[dict[str, Any]], None]) -> None:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    change(data)
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")


def add_anchors_stage(config: Path) -> None:
    """Этап `anchors` тестового конфига: одна фейковая модель, как Pro в настоящем."""

    def providers(data: dict[str, Any]) -> None:
        entry = {"provider": "fake", "model": "fake-anchor", "params": {"size": "1K"}}
        data["stages"]["anchors"] = {
            "kind": "image",
            "catalog": {"pro": {**entry, "max_refs": 14}},
            "profiles": {"economy": "pro", "standard": "pro", "premium": "pro"},
        }

    def pricing(data: dict[str, Any]) -> None:
        data["fake"]["fake-anchor"] = {
            "checked_at": "2026-10-14",
            "source": "tests",
            "prices": {"image": {"variants": {"1K": "0.134"}}},
        }

    edit_yaml(config / "providers.yaml", providers)
    edit_yaml(config / "pricing.yaml", pricing)


@dataclass
class Env:
    client: TestClient
    paths: StudioPaths
    fake: FakeProvider

    @property
    def sheet_dir(self) -> Path:
        return self.paths.anchor_dir("cursus", LOOK)

    def post(self, url: str, body: dict[str, Any] | None = None, status: int = 201) -> Any:
        response = self.client.post(url, json=body)
        assert response.status_code == status, response.text
        return response.json()

    def get(self, url: str) -> Any:
        response = self.client.get(url)
        assert response.status_code == 200, response.text
        return response.json()

    def run(self, url: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        """Поставить джоб и дождаться конца."""
        return self.wait(self.post(url, body)["id"])

    def wait(self, job_id: str) -> dict[str, Any]:
        deadline = time.monotonic() + 10
        while True:
            state: dict[str, Any] = self.get(f"/api/jobs/{job_id}")
            if state["status"] in TERMINAL:
                return state
            assert time.monotonic() < deadline, f"job {job_id} stuck: {state}"
            time.sleep(0.02)

    def publish(self, url: str, body: dict[str, Any]) -> None:
        assert self.client.put(f"{url}/draft", json=body).status_code == 200
        response = self.client.post(f"{url}/publish")
        assert response.status_code == 201, response.text

    def sheet(self) -> dict[str, Any]:
        state: dict[str, Any] = self.get(SHEET_URL)
        return state

    def slot(self, angle: str) -> dict[str, Any]:
        return next(s for s in self.sheet()["slots"] if s["slot"] == angle)

    def manifest(self, target: Path | None = None) -> list[dict[str, Any]]:
        data = read_json((target or self.sheet_dir) / "sheet.json")
        rows: list[dict[str, Any]] = data["candidates"]
        return rows

    def rows(self) -> list[LedgerRow]:
        conn = connect(self.paths.db_path)
        try:
            return ledger.list_rows(conn, channel="cursus")
        finally:
            conn.close()

    def files(self) -> dict[str, str]:
        """Файлы кандидатов → sha256 содержимого."""
        folder = self.sheet_dir / "candidates"
        return {
            p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(folder.iterdir())
        }

    def choose_all(self) -> None:
        for slot in self.sheet()["slots"]:
            ready = [c for c in slot["candidates"] if c["status"] == "ready"]
            self.post(f"{SHEET_URL}/{slot['slot']}/choose", {"candidate": ready[0]["id"]}, 200)


def set_budgets(paths: StudioPaths, **budgets: float) -> None:
    profile = read_json(paths.profile_path("cursus"))
    profile["budgets"].update(budgets)
    write_json_atomic(paths.profile_path("cursus"), profile)


@contextmanager
def make_env(tmp_path: Path, *, workers: int = 1, canon: bool = True) -> Iterator[Env]:
    config = tmp_path / "config"
    shutil.copytree(FIXTURE_CONFIG, config)
    add_anchors_stage(config)
    settings = Settings(
        _env_file=None,
        studio_data_dir=tmp_path / "data",
        config_dir=config,
        job_workers=workers,
        job_retry_wait_s=0,
    )
    app = create_app(settings)
    paths = StudioPaths(settings.studio_data_dir)
    fake = app.state.gateway.registry.provider("fake")
    assert isinstance(fake, FakeProvider)
    with TestClient(app) as client:
        conn = connect(paths.db_path)
        try:
            seed(paths, conn)
        finally:
            conn.close()
        env = Env(client, paths, fake)
        if canon:
            env.publish(f"{BASE}/style", STYLE)
            env.publish(f"{BASE}/periods/caribbean-1716", PERIOD)
            env.publish(f"{BASE}/characters/you", CHARACTER)
        yield env


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    with make_env(tmp_path) as env:
        yield env


@pytest.fixture
def idle(tmp_path: Path) -> Iterator[Env]:
    """Очередь без исполнения: джобы остаются `queued`."""
    with make_env(tmp_path, workers=0) as env:
        yield env


def publish_character(env: Env, **changes: Any) -> None:
    """Новая версия персонажа: поля облика LOOK (и `nature.face`) поменять, остальное как было."""
    current = env.get(f"{BASE}/characters/you")["data"]
    for appearance in current["appearances"]:
        if appearance["id"] == LOOK:
            for key, value in changes.items():
                if key == "nature_face":
                    current["nature"]["face"] = value
                else:
                    appearance[key] = value
    env.publish(f"{BASE}/characters/you", current)


# --- заказ: промпт собирает код ------------------------------------------------------------------


def test_sheet_order_is_deterministic_and_built_from_canon(env: Env) -> None:
    config = load_canon_config(REPO_ROOT / "config" / "canon.yaml")
    prompts = load_templates(PROMPTS_DIR)
    first = anchors.sheet_order(env.paths, "cursus", LOOK, config, prompts)
    second = anchors.sheet_order(env.paths, "cursus", LOOK, config, prompts)
    assert first == second
    assert first.canon == {
        "style": "style/v001",
        "period": "periods/caribbean-1716/v001",
        "appearance": "characters/you/v001#powder-monkey-11",
    }
    keys = [item.key for item in first.items]
    assert keys[:2] == ["front-1", "front-2"] and len(keys) == 12
    assert [item.with_front for item in first.items] == [False, False] + [True] * 10
    assert len({item.seed for item in first.items}) == 12

    front = first.items[0].prompt
    sections = ["Rendering:", "Era:", "Person:", "Framing:"]
    assert [front.index(s) for s in sections] == sorted(front.index(s) for s in sections)
    assert STYLE["render"] in front and CHARACTER["nature"]["face"] in front
    assert "boyish, sunburnt cheeks" in front and "- Age: 11" in front
    assert config.anchors.angles[0].prompt in front
    assert "mid-grey studio background" in front
    # Лист — эталон внешности: свет, оптика и композиция стиля в него не идут.
    for absent in (STYLE["light"]["direction"], STYLE["optics"]["focal"], STYLE["composition"]):
        assert absent not in front
    assert not any("Ѐ" <= ch <= "ӿ" for ch in front)  # подписи `label` — не в промпт
    negative = first.items[0].negative.split(", ")
    assert negative[:2] == ["text", "watermark"] and "zippers" in negative
    assert negative[-2:] == ["adult beard", "hat"]


def test_unpublished_canon_is_409(tmp_path: Path) -> None:
    with make_env(tmp_path, canon=False) as env:
        assert env.post(SHEET_URL, status=409)["detail"].startswith("Стиль канала не опубликован")
        env.publish(f"{BASE}/style", STYLE)
        assert env.post(SHEET_URL, status=409)["detail"].startswith(f"Облик {LOOK} не опубликован")
        env.publish(f"{BASE}/characters/you", CHARACTER)
        assert env.post(SHEET_URL, status=409)["detail"] == (
            f"Эпоха caribbean-1716 облика {LOOK} не опубликована — опубликуйте её"
            " на экране «Канон»."
        )
    assert env.fake.calls == []


# --- лист: 12 кандидатов, фас — референсом ------------------------------------------------------


def test_sheet_job_draws_12_candidates_with_first_front_as_reference(env: Env) -> None:
    job = env.run(SHEET_URL)
    assert job["status"] == "done", job
    assert job["result"] == {
        "target": LOOK,
        "done": 12,
        "charged": 12,
        "cached": 0,
        "failed": 0,
        "spent_usd_micro": 12 * PRICE,
    }
    assert job["message"] == "Готово 12 из 12: сбоев 0"

    manifest = env.manifest()
    assert [(r["slot"], r["n"], r["status"]) for r in manifest] == [
        (angle, n, "ready") for angle in ANGLES for n in (1, 2)
    ]
    front = manifest[0]
    assert front["id"].startswith("front-1-") and front["file"] == f"candidates/{front['id']}.png"
    front_bytes = (env.sheet_dir / front["file"]).read_bytes()
    assert len(env.files()) == 12

    # Фасы — без референсов; остальные 10 — с первым фасом, и больше ни с чем.
    assert [len(refs) for refs in env.fake.refs] == [0, 0] + [1] * 10
    assert all(refs[0].data == front_bytes for refs in env.fake.refs[2:])
    assert {r["ref"] for r in manifest[2:]} == {front["id"]}
    assert all(r["version"] == "v001" and r["usd_micro"] == PRICE for r in manifest)

    rows = env.rows()
    assert [(r.status, r.stage, r.episode_id, r.usd_micro) for r in rows] == [
        ("charged", "anchors", None, PRICE)
    ] * 12
    assert {r.job_id for r in rows} == {job["id"]}

    # Прогресс по кандидатам — события SSE `job.progress`.
    conn = connect(env.paths.db_path)
    try:
        events = conn.execute(
            "SELECT type, data FROM job_events WHERE job_id = ? ORDER BY id", (job["id"],)
        ).fetchall()
    finally:
        conn.close()
    messages = [json.loads(e["data"])["message"] for e in events if e["type"] == "job.progress"]
    assert "Кандидат 1 из 12 · Фас, 1" in messages
    assert [e["type"] for e in events][-1] == "job.done"

    state = env.sheet()
    assert (state["status"], state["chosen"], state["total"], state["version"]) == (
        "missing",
        0,
        6,
        "v001",
    )
    assert state["spent"] == {"usd_micro": 12 * PRICE, "usd": "$1.61"}


def test_repeat_sheet_is_cached_for_free(env: Env) -> None:
    env.run(SHEET_URL)
    files = env.files()
    again = env.run(SHEET_URL)
    assert again["result"]["cached"] == 12 and again["result"]["charged"] == 0
    assert len(env.fake.calls) == 12
    assert env.files() == files
    assert [r.status for r in env.rows()] == ["charged"] * 12 + ["cached"] * 12
    assert all(r.usd_micro == 0 for r in env.rows()[12:])
    assert len(env.manifest()) == 12  # повтор из кэша не плодит записей


def test_failed_candidate_does_not_stop_the_sheet(env: Env) -> None:
    refusal = "Gemini не нарисовал картинку (IMAGE_SAFETY) — сработал фильтр безопасности."
    env.fake.errors = [ProviderError(refusal)]
    job = env.run(SHEET_URL)
    assert job["status"] == "done" and job["result"]["failed"] == 1
    manifest = env.manifest()
    failed = [r for r in manifest if r["status"] == "failed"]
    assert [(r["slot"], r["n"], r["error"], r["file"]) for r in failed] == [
        ("front", 1, refusal, None)
    ]
    # Первый удавшийся фас — второй кандидат: он и референс.
    second = next(r for r in manifest if r["slot"] == "front" and r["n"] == 2)
    assert {r["ref"] for r in manifest if r["slot"] != "front"} == {second["id"]}
    assert [r.status for r in env.rows()].count("failed") == 1

    # Повтор: сбойный кандидат дорисовывается, запись о сбое уходит, остальное — из кэша.
    again = env.run(SHEET_URL)
    assert again["result"]["charged"] == 1 and again["result"]["cached"] == 11
    assert [r["status"] for r in env.manifest()].count("failed") == 0


def test_both_fronts_failed_fail_the_rest_without_calls(env: Env) -> None:
    env.fake.errors = [ProviderError("ключ отклонён"), ProviderError("ключ отклонён")]
    job = env.run(SHEET_URL)
    assert job["status"] == "failed"
    assert job["error"] == "ProviderError: ключ отклонён"
    assert len(env.fake.calls) == 2
    manifest = env.manifest()
    assert [r["status"] for r in manifest] == ["failed"] * 12
    assert manifest[2]["error"].startswith("нет фаса для референса")


# --- выбор, отбраковка, перегенерация ------------------------------------------------------------


def test_choose_writes_chosen_json_and_reject_moves_file(env: Env) -> None:
    env.run(SHEET_URL)
    first, second = env.slot("front")["candidates"]
    state = env.post(f"{SHEET_URL}/front/choose", {"candidate": second["id"]}, 200)
    assert state["status"] == "partial" and state["chosen"] == 1
    chosen = read_json(env.sheet_dir / "chosen.json")["slots"]["front"]
    fields = {"candidate", "file", "seed", "version", "canon", "chosen_at", "usd_micro"}
    assert set(chosen) == fields
    assert (chosen["candidate"], chosen["version"], chosen["usd_micro"]) == (
        second["id"],
        "v001",
        PRICE,
    )
    assert chosen["seed"] == second["seed"]

    # Выбранного не отбраковать, отбракованного не выбрать.
    detail = env.post(f"{SHEET_URL}/front/reject", {"candidate": second["id"]}, 409)["detail"]
    assert detail.startswith(f"Кандидат {second['id']} выбран для ракурса «Фас»")
    data = (env.paths.root / first["file"]).read_bytes()
    state = env.post(f"{SHEET_URL}/front/reject", {"candidate": first["id"]}, 200)
    rejected = env.sheet_dir / "rejected" / f"{first['id']}.png"
    assert rejected.read_bytes() == data  # ничего не удаляется
    assert not (env.paths.root / first["file"]).exists()
    front = next(s for s in state["slots"] if s["slot"] == "front")
    assert front["candidates"][0]["status"] == "rejected"
    assert front["candidates"][0]["file"] == rejected.relative_to(env.paths.root).as_posix()
    assert env.post(f"{SHEET_URL}/front/choose", {"candidate": first["id"]}, 409)["detail"] == (
        f"Кандидат {first['id']} отбракован — выберите другого."
    )
    assert env.post(f"{SHEET_URL}/front/choose", {"candidate": "front-9-x"}, 404)

    # Повторная сборка: отбракованный остаётся в `rejected/`, оплаченное — из кэша.
    again = env.run(SHEET_URL)
    assert again["result"]["charged"] == 10  # остальные ракурсы — с выбранным фасом
    assert rejected.is_file() and not (env.sheet_dir / "candidates" / rejected.name).exists()
    assert env.slot("front")["candidates"][0]["status"] == "rejected"
    assert len(env.fake.calls) == 22


def test_regenerate_angle_keeps_other_angles(env: Env) -> None:
    env.run(SHEET_URL)
    env.choose_all()
    assert env.sheet()["status"] == "ready"
    before = env.files()
    chosen_before = read_json(env.sheet_dir / "chosen.json")
    front_id = env.slot("front")["chosen"]["candidate"]

    job = env.run(f"{SHEET_URL}/profile/regenerate")
    assert job["result"]["charged"] == 2
    after = env.files()
    assert {k: after[k] for k in before} == before  # ни один прежний файл не изменился
    new = sorted(set(after) - set(before))
    assert [name.split("-")[:2] for name in new] in ([["profile", "3"], ["profile", "4"]],)
    profile = env.slot("profile")["candidates"]
    assert [c["n"] for c in profile] == [1, 2, 3, 4]
    assert {c["ref"] for c in profile} == {front_id}
    assert read_json(env.sheet_dir / "chosen.json") == chosen_before

    # Номера фиксирует заказ: тот же payload после «аварии» — из кэша, новых кандидатов нет.
    conn = connect(env.paths.db_path)
    try:
        replay, _ = queue.enqueue(
            conn, NewJob(kind=ANGLE_KIND, payload=job["payload"], channel="cursus")
        )
    finally:
        conn.close()
    env.client.app.state.jobs.kick()  # type: ignore[attr-defined]
    assert env.wait(replay.id)["result"]["cached"] == 2
    assert [r.status for r in env.rows()][-2:] == ["cached", "cached"]
    assert [c["n"] for c in env.slot("profile")["candidates"]] == [1, 2, 3, 4]


def test_regenerate_needs_a_front(env: Env) -> None:
    detail = env.post(f"{SHEET_URL}/profile/regenerate", status=409)["detail"]
    assert detail == (
        f"Для ракурса «Профиль» нужен фас облика {LOOK} (v001) — соберите лист или "
        "перегенерируйте фас."
    )
    assert env.post(f"{SHEET_URL}/sideways/regenerate", status=404)["detail"].startswith(
        "Ракурса «sideways» в листе нет"
    )
    job = env.run(f"{SHEET_URL}/front/regenerate")
    assert job["result"]["charged"] == 2 and env.fake.refs == [[], []]


def test_regenerate_after_new_version_takes_the_chosen_front(env: Env) -> None:
    """M5.9: новая версия персонажа без смены лица — выбранный фас прежней версии годен
    референсом; сменилось лицо — нет, нужен фас новой версии."""
    env.run(SHEET_URL)
    env.choose_all()
    front = env.slot("front")["chosen"]
    front_bytes = (env.paths.root / front["file"]).read_bytes()

    publish_character(env, label="Юнга, 11")  # v002: подпись
    job = env.run(f"{SHEET_URL}/profile/regenerate")
    assert job["status"] == "done" and job["result"]["charged"] == 2
    profile = [c for c in env.slot("profile")["candidates"] if c["version"] == "v002"]
    assert {c["ref"] for c in profile} == {front["candidate"]}
    assert all(refs[0].data == front_bytes for refs in env.fake.refs[-2:])

    publish_character(env, face="boyish, pale cheeks")  # v003: лицо — фас v001 не годится
    detail = env.post(f"{SHEET_URL}/profile/regenerate", status=409)["detail"]
    assert detail.startswith(f"Для ракурса «Профиль» нужен фас облика {LOOK} (v003)")


# --- устаревание ---------------------------------------------------------------------------------


def test_sheet_follows_appearance_version(env: Env) -> None:
    env.run(SHEET_URL)
    env.choose_all()

    publish_character(env, label="Юнга, 11")  # v002: остальное — лист переходит как есть
    state = env.sheet()
    assert (state["version"], state["status"], state["stale"]) == ("v002", "ready", None)

    publish_character(env, clothing="oversized wool shirt, canvas breeches, barefoot")  # v003
    state = env.sheet()
    assert state["status"] == "outdated"
    stale = {s["slot"]: s["stale"] for s in state["slots"] if s["stale"]}
    assert set(stale) == BODY_ANGLES
    assert set(stale.values()) == {"в v003 изменились clothing"}
    assert state["stale"] == (
        "Устарели ракурсы «В полный рост», «В действии», «Деталь»: в v003 изменились clothing — "
        "перегенерируйте их."
    )

    publish_character(env, nature_face="round face, brown eyes")  # v004
    state = env.sheet()
    assert {s["slot"] for s in state["slots"] if s["stale"]} == set(ANGLES)
    assert state["stale"] == "Лист устарел: в v004 изменились nature.face — пересоберите лист."

    # Канон выпуска сравнивает лист с прибитой версией облика.
    assert episode_canon.sheet_state(env.paths, "cursus", LOOK, "v001").status == "ready"
    assert episode_canon.sheet_state(env.paths, "cursus", LOOK, "v002").status == "ready"
    late = episode_canon.sheet_state(env.paths, "cursus", LOOK, "v004")
    assert (late.status, late.chosen) == ("outdated", 6)


def test_summary_counts_ready_sheets(env: Env) -> None:
    """Экран 12: у персонажа — сколько листов обликов готово 6/6 против последней версии."""

    def ready() -> list[tuple[str, int, int]]:
        characters = env.get(BASE)["characters"]
        return [(c["id"], c["appearances_count"], c["sheets_ready"]) for c in characters]

    count = len(CHARACTER["appearances"])
    assert ready() == [("you", count, 0)]
    env.run(SHEET_URL)
    env.choose_all()
    assert ready() == [("you", count, 1)]
    publish_character(env, face="boyish, pale cheeks")  # лист устарел — не готов
    assert ready() == [("you", count, 0)]


def test_face_change_outdates_whole_sheet(env: Env) -> None:
    env.run(SHEET_URL)
    env.choose_all()
    publish_character(env, face="boyish, pale cheeks")
    state = env.sheet()
    assert state["stale"] == "Лист устарел: в v002 изменились face — пересоберите лист."
    assert all(s["stale"] == "в v002 изменились face" for s in state["slots"])


def test_stale_angles_are_redrawn_in_one_job(env: Env) -> None:
    """M5.9: сменилась одежда — устаревшие «В полный рост», «В действии», «Деталь» одним джобом
    (на набор — один джоб), цена до клика — строка сметы `stale`, фас — выбранный."""
    env.run(SHEET_URL)
    env.choose_all()
    assert env.get(f"{SHEET_URL}/estimate")["stale"] is None
    assert env.post(f"{SHEET_URL}/stale", status=409)["detail"] == (
        f"Устаревших ракурсов в листе {LOOK} нет — пересобирать нечего."
    )
    front = env.slot("front")["chosen"]["candidate"]

    publish_character(env, clothing="oversized wool shirt, canvas breeches, barefoot")  # v002
    line = env.get(f"{SHEET_URL}/estimate")["stale"]
    assert (line["label"], line["usd"]["usd_micro"], line["usd"]["usd"]) == (
        "3 ракурса × 2 кандидата",
        6 * PRICE,
        "$0.80",
    )
    job = env.run(f"{SHEET_URL}/stale")
    assert (job["kind"], job["status"], job["result"]["charged"]) == (ANGLE_KIND, "done", 6)
    items = [(i["slot"], i["n"]) for i in job["payload"]["items"]]
    assert items == [(a, n) for a in ANGLES if a in BODY_ANGLES for n in (3, 4)]
    fresh = [r for r in env.manifest() if r["version"] == "v002"]
    assert {r["ref"] for r in fresh} == {front}

    # Устаревание уходит выбором новых кандидатов, а не самой перерисовкой.
    assert env.sheet()["status"] == "outdated"
    for slot in BODY_ANGLES:
        pick = next(c for c in env.slot(slot)["candidates"] if c["version"] == "v002")
        env.post(f"{SHEET_URL}/{slot}/choose", {"candidate": pick["id"]}, 200)
    assert env.sheet()["status"] == "ready"
    assert env.get(f"{SHEET_URL}/estimate")["stale"] is None


def test_stale_whole_sheet_draws_new_fronts_first(env: Env) -> None:
    env.run(SHEET_URL)
    env.choose_all()
    publish_character(env, nature_face="round face, brown eyes")  # v002: весь лист
    assert env.get(f"{SHEET_URL}/estimate")["stale"]["label"] == "6 ракурсов × 2 кандидата"
    job = env.run(f"{SHEET_URL}/stale")
    assert [i["slot"] for i in job["payload"]["items"]][:2] == ["front", "front"]
    fresh = [r for r in env.manifest() if r["version"] == "v002"]
    assert len(fresh) == 12
    first_front = fresh[0]["id"]
    assert first_front.startswith("front-3-")
    assert {r["ref"] for r in fresh[2:]} == {first_front}  # фас v001 — другого человека


# --- копия облика --------------------------------------------------------------------------------


def test_copy_appearance_keeps_face_byte_for_byte(env: Env) -> None:
    url = f"{BASE}/appearances/{LOOK}/copy"
    doc = env.post(url, {"period": "england-1347", "appearance_id": "you@squire-14"})
    assert doc["draft"] is True and doc["based_on"] == "v001"
    source, copy = (
        next(a for a in doc["data"]["appearances"] if a["id"] == key)
        for key in (LOOK, "you@squire-14")
    )
    for key in ("face", "build", "hair", "age", "negative_local"):
        assert copy[key] == source[key]
    assert (copy["period"], copy["label"], copy["clothing"], copy["wear"], copy["props"]) == (
        "england-1347",
        "",
        "",
        "",
        [],
    )
    assert env.get(f"{BASE}/appearances/you@squire-14/anchors")["status"] == "missing"

    assert (
        env.post(url, {"period": "england-1347", "appearance_id": "you@squire-14"}, 409)["detail"]
        == "Облик you@squire-14 уже есть в персонаже you — выберите другой id копии."
    )
    response = env.client.post(url, json={"period": "x", "appearance_id": "otto@squire-14"})
    assert response.status_code == 422
    assert response.json()["detail"][0]["msg"].startswith("Облик otto@squire-14 не принадлежит")


# --- кадры стиля ---------------------------------------------------------------------------------


def test_style_frames_are_drawn_chosen_and_go_stale_on_light(env: Env) -> None:
    job = env.run(f"{BASE}/style/anchors", {"period": "caribbean-1716"})
    assert job["result"]["charged"] == 6
    assert env.fake.refs == [[]] * 6  # кадры стиля сами — референсы, им референсы не нужны
    style_dir = env.paths.style_anchors_dir("cursus")
    assert len(list(style_dir.glob("*.png"))) == 6
    state = env.get(f"{BASE}/style/anchors")
    assert (state["status"], state["chosen"], state["total"]) == ("ready", 6, 6)
    prompt = env.fake.calls[0][1].model_dump()["prompt"]
    assert STYLE["light"]["direction"] in prompt and "horn-paned lanterns" in prompt

    # Пересборка в другой эпохе и обратно: возврат — из кэша, выбор снова на кадрах Карибов.
    other = {**PERIOD, "id": "england-1347", "label": "Англия, 1347", "region": "England"}
    env.publish(f"{BASE}/periods/england-1347", other)
    caribbean = read_json(style_dir / "chosen.json")
    assert env.run(f"{BASE}/style/anchors", {"period": "england-1347"})["result"]["charged"] == 6
    assert read_json(style_dir / "chosen.json") != caribbean
    back = env.run(f"{BASE}/style/anchors", {"period": "caribbean-1716"})["result"]
    assert (back["charged"], back["cached"]) == (0, 6)
    picks = read_json(style_dir / "chosen.json")["slots"]
    assert {k: v["candidate"] for k, v in picks.items()} == {
        k: v["candidate"] for k, v in caribbean["slots"].items()
    }

    env.publish(f"{BASE}/style", {**STYLE, "grain": "coarse grain"})  # v002: зерно — не устаревает
    assert env.get(f"{BASE}/style/anchors")["status"] == "ready"
    env.publish(f"{BASE}/style", {**STYLE, "light": {**STYLE["light"], "direction": "top light"}})
    state = env.get(f"{BASE}/style/anchors")
    assert state["status"] == "outdated"
    assert state["stale"] == (
        "Кадры стиля устарели: в v003 изменились light.direction — пересоберите их."
    )


# --- миниатюры -----------------------------------------------------------------------------------


def jpeg(width: int, height: int) -> bytes:
    """Настоящая картинка вместо байтов фейкового провайдера (PNG-сигнатура + мусор)."""
    image = np.full((height, width, 3), (40, 90, 160), dtype=np.uint8)
    ok, data = cv2.imencode(".jpg", image)
    assert ok
    return bytes(data.tobytes())


def size_of(data: bytes) -> tuple[int, int]:
    """(высота, ширина) картинки из ответа."""
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    assert image is not None, "not an image"
    height, width = image.shape[:2]
    return height, width


def test_thumbnail_is_webp_of_the_asked_width_and_made_once(env: Env) -> None:
    env.run(SHEET_URL)
    first, second = env.manifest()[:2]
    (env.sheet_dir / first["file"]).write_bytes(jpeg(768, 1024))
    url = f"{BASE}/anchors/{LOOK}/{first['id']}/thumb"

    response = env.client.get(url)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "image/webp"
    assert "immutable" in response.headers["cache-control"]
    assert size_of(response.content) == (427, 320)
    thumb = env.sheet_dir / "thumbs" / f"{first['id']}-320.webp"
    made = thumb.stat().st_mtime_ns
    assert env.client.get(url).content == response.content
    assert thumb.stat().st_mtime_ns == made  # готовая миниатюра не пересчитывается

    small = env.client.get(url, params={"w": 160})
    assert size_of(small.content)[1] == 160
    wide = env.client.get(url, params={"w": 500})
    assert wide.status_code == 422
    assert wide.json()["detail"][0]["msg"] == "Ширины миниатюры 500 нет — есть 160 и 320."

    # Отбракованный тоже виден: файл ищется по манифесту, в `rejected/`.
    env.post(f"{SHEET_URL}/front/choose", {"candidate": second["id"]}, 200)
    env.post(f"{SHEET_URL}/front/reject", {"candidate": first["id"]}, 200)
    assert env.client.get(url, params={"w": 160}).status_code == 200

    # Байты фейкового провайдера — не картинка: отказ одной фразой.
    broken = env.client.get(f"{BASE}/anchors/{LOOK}/{second['id']}/thumb")
    assert broken.status_code == 409
    assert broken.json()["detail"] == (
        f"Файл кандидата {second['id']} не читается как картинка — перегенерируйте ракурс."
    )
    missing = env.client.get(f"{BASE}/anchors/{LOOK}/front-9-x/thumb")
    assert missing.status_code == 404
    assert missing.json()["detail"] == (
        f"У листа {LOOK} нет кандидата front-9-x — обновите страницу."
    )
    bad = env.client.get(f"{BASE}/anchors/powder-monkey/front-1-x/thumb")
    assert bad.status_code == 422


def test_style_frame_thumbnail(env: Env) -> None:
    env.run(f"{BASE}/style/anchors", {"period": "caribbean-1716"})
    frame = env.manifest(env.paths.style_anchors_dir("cursus"))[0]
    (env.paths.style_anchors_dir("cursus") / frame["file"]).write_bytes(jpeg(1280, 720))
    response = env.client.get(f"{BASE}/anchors/style/{frame['id']}/thumb")
    assert response.status_code == 200, response.text
    assert size_of(response.content) == (180, 320)


# --- деньги и очередь ----------------------------------------------------------------------------


def test_estimate_before_click(env: Env) -> None:
    estimate = env.get(f"{SHEET_URL}/estimate")
    assert estimate["stale"] is None  # устаревших ракурсов нет
    assert {k: (v["label"], v["usd"]["usd_micro"]) for k, v in estimate.items() if v} == {
        "sheet": ("6 ракурсов × 2 кандидата", 12 * PRICE),
        "angle": ("2 кандидата", 2 * PRICE),
        "style": ("6 кадров", 6 * PRICE),
    }
    assert estimate["sheet"]["usd"]["usd"] == "$1.61"
    assert estimate["sheet"]["cost"]["stage"] == "anchors"
    # Кадрам стиля облик не нужен: та же смета по адресу стиля (M5.7)
    assert env.get(f"{BASE}/style/anchors/estimate") == estimate


def test_channel_job_names_its_channel_in_api_and_events(idle: Env) -> None:
    """Экран канона ищет свой джоб в общем потоке по каналу: у джоба выпуска канала нет."""
    job = idle.post(f"{BASE}/style/anchors", {"period": "caribbean-1716"})
    assert (job["kind"], job["channel"], job["episode_id"]) == ("style_anchors", "cursus", None)
    assert [j["channel"] for j in idle.get("/api/jobs")["items"]] == ["cursus"]
    conn = connect(idle.paths.db_path)
    try:
        events = [json.loads(e.data) for e in read_events_after(conn, 0)]
    finally:
        conn.close()
    assert [(e["job_id"], e["channel"]) for e in events] == [(job["id"], "cursus")]


def test_channel_budget_refuses_before_queue(env: Env) -> None:
    set_budgets(env.paths, monthly_usd=1.0, per_episode_usd=100, animation_usd=100)
    detail = env.post(SHEET_URL, status=409)["detail"]
    assert (detail["code"], detail["level"], detail["cost_usd_micro"]) == (
        "budget_exceeded",
        "month",
        12 * PRICE,
    )
    assert env.fake.calls == []
    assert [(r.status, r.stage, r.episode_id) for r in env.rows()] == [("refused", "anchors", None)]
    assert env.get("/api/jobs")["items"] == []


def test_queued_channel_job_holds_monthly_budget(idle: Env) -> None:
    set_budgets(idle.paths, monthly_usd=2.0)
    job = idle.post(SHEET_URL)
    assert job["status"] == "queued" and job["cost_usd_micro"] == 12 * PRICE
    detail = idle.post(f"{BASE}/style/anchors", {"period": "caribbean-1716"}, 409)["detail"]
    assert detail["queued_usd_micro"] == 12 * PRICE

    # Тот же набор второй раз не ставится; отмена освобождает бюджет.
    busy = idle.post(SHEET_URL, status=409)["detail"]
    assert busy == (
        f"Лист {LOOK} уже собирается (джоб {job['id']}) — дождитесь окончания или отмените его."
    )
    assert idle.post(f"/api/jobs/{job['id']}/cancel", status=200)["status"] == "cancelled"
    assert idle.post(f"{BASE}/style/anchors", {"period": "caribbean-1716"})["status"] == "queued"


def test_paid_anchor_kind_is_not_posted_to_jobs_api(env: Env) -> None:
    response = env.client.post("/api/jobs", json={"kind": "anchor_sheet", "payload": {}})
    assert response.status_code == 422
