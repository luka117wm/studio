import json
import sqlite3
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api import episodes as episodes_api
from app.api.episodes import EpisodeCreate
from app.settings import Settings
from app.storage.atomic import write_json_atomic
from app.storage.db import connect
from app.storage.paths import StudioPaths
from app.tools.seed import seed

DIRECTOR_FIXTURE = Path(__file__).parent / "fixtures" / "director_pirate_10shots.json"


@pytest.fixture
def paths(settings: Settings) -> StudioPaths:
    return StudioPaths(settings.studio_data_dir)


@pytest.fixture
def seeded(client: TestClient, paths: StudioPaths) -> Iterator[TestClient]:
    """Приложение поднято (миграции накатаны lifespan), каналы созданы seed-ом."""
    conn = connect(paths.db_path)
    try:
        assert seed(paths, conn) == ["cursus", "otto"]
        assert seed(paths, conn) == []  # идемпотентен
    finally:
        conn.close()
    yield client


PIRATE = {"id": "pirate", "channel": "cursus", "title": "Every Rank on a Pirate Ship"}


# --- channels ------------------------------------------------------------------------------------


def test_channels_after_seed(seeded: TestClient, paths: StudioPaths) -> None:
    response = seeded.get("/api/channels")
    assert response.status_code == 200
    channels = response.json()
    assert [c["id"] for c in channels] == ["cursus", "otto"]
    assert channels[0]["name"] == "Cursus"
    assert channels[0]["format"] == "every_rank"
    assert channels[0]["budgets"]["monthly_usd"] == 150
    assert channels[0]["voice_quota"]["limit_chars"] == 600_000
    assert channels[1]["name"] == "Otto's Timeline"
    assert channels[1]["budgets"]["monthly_usd"] == 100
    # На диске — только profile.json, без пустых canon/ и oauth/.
    assert [p.name for p in paths.channel_dir("cursus").iterdir()] == ["profile.json"]

    one = seeded.get("/api/channels/otto")
    assert one.status_code == 200
    assert one.json() == channels[1]


def test_channels_empty_before_seed(client: TestClient) -> None:
    assert client.get("/api/channels").json() == []
    assert client.get("/api/channels/cursus").status_code == 404
    assert client.post("/api/episodes", json=PIRATE).status_code == 404


# --- episodes ------------------------------------------------------------------------------------


def test_create_episode_makes_tree_and_project(seeded: TestClient, paths: StudioPaths) -> None:
    response = seeded.post("/api/episodes", json=PIRATE)
    assert response.status_code == 201, response.text
    episode = response.json()
    assert episode["id"] == "pirate"
    assert episode["channel"] == "cursus"
    assert episode["title"] == PIRATE["title"]
    assert episode["short_title"] is None
    assert episode["origin"] == "blank"
    assert episode["stage"] == "script"
    assert episode["status"] == "queued"
    assert episode["created_at"] == episode["updated_at"]
    assert episode["summary"]["shots_total"] == 0
    assert episode["summary"]["duration_s"] is None

    for directory in paths.episode_tree("cursus", "pirate"):
        assert directory.is_dir(), directory
    project_path = paths.project_path("cursus", "pirate")
    project = json.loads(project_path.read_text(encoding="utf-8"))
    assert project["schema"] == "studio.project/1"
    assert project["episode_id"] == "pirate"
    assert project["channel"] == "cursus"
    assert set(paths.episode_dir("cursus", "pirate").iterdir()) == {
        project_path,
        *paths.episode_tree("cursus", "pirate"),
    }

    assert seeded.get("/api/episodes/pirate").json() == episode
    assert seeded.get("/api/projects/pirate").json() == project


def test_duplicate_episode_is_409(seeded: TestClient, paths: StudioPaths) -> None:
    assert seeded.post("/api/episodes", json=PIRATE).status_code == 201
    again = seeded.post("/api/episodes", json=PIRATE)
    assert again.status_code == 409
    assert "pirate" in again.json()["detail"]
    # Тот же id в другом канале — тоже конфликт: id выпуска глобален.
    assert seeded.post("/api/episodes", json={**PIRATE, "channel": "otto"}).status_code == 409
    # Каталог на диске без строки в БД (след аварии) — тоже 409, ничего не затираем.
    paths.episode_dir("otto", "ghost").mkdir(parents=True)
    ghost = seeded.post("/api/episodes", json={"id": "ghost", "channel": "otto", "title": "G"})
    assert ghost.status_code == 409
    assert seeded.get("/api/episodes/ghost").status_code == 404


@pytest.mark.parametrize("bad_id", ["../x", "Pirate", "a b", ""])
def test_bad_episode_id_is_422(seeded: TestClient, bad_id: str) -> None:
    assert seeded.post("/api/episodes", json={**PIRATE, "id": bad_id}).status_code == 422


def test_list_and_filter_episodes(seeded: TestClient) -> None:
    seeded.post("/api/episodes", json=PIRATE)
    seeded.post("/api/episodes", json={"id": "peasant", "channel": "otto", "title": "Peasant"})
    seeded.post("/api/episodes", json={"id": "monastery", "channel": "cursus", "title": "Abbey"})

    everything = seeded.get("/api/episodes").json()
    assert [e["id"] for e in everything] == ["pirate", "peasant", "monastery"]
    cursus = seeded.get("/api/episodes", params={"channel": "cursus"}).json()
    assert [e["id"] for e in cursus] == ["pirate", "monastery"]
    assert seeded.get("/api/episodes", params={"channel": "nope"}).status_code == 422
    assert seeded.get("/api/episodes/nope").status_code == 404


def test_server_assigns_id_title_and_stage(seeded: TestClient, paths: StudioPaths) -> None:
    first = seeded.post("/api/episodes", json={"channel": "cursus"})
    assert first.status_code == 201, first.text
    assert first.json()["id"] == "c01"
    assert first.json()["title"] == "Новый выпуск"
    assert first.json()["origin"] == "blank"
    assert first.json()["stage"] == "script"
    assert paths.project_path("cursus", "c01").is_file()

    assert seeded.post("/api/episodes", json={"channel": "cursus"}).json()["id"] == "c02"
    assert seeded.post("/api/episodes", json={"channel": "otto"}).json()["id"] == "o01"

    # Явный номер двигает счётчик; каталог без строки в БД номер занимает.
    assert seeded.post("/api/episodes", json={"channel": "cursus", "id": "c07"}).status_code == 201
    assert seeded.post("/api/episodes", json={"channel": "cursus"}).json()["id"] == "c08"
    paths.episode_dir("cursus", "c09").mkdir(parents=True)
    assert seeded.post("/api/episodes", json={"channel": "cursus"}).json()["id"] == "c10"
    # Id вида `c07-pirate-ship` в нумерацию не входит.
    seeded.post("/api/episodes", json={"channel": "cursus", "id": "c99-pirate"})
    assert seeded.post("/api/episodes", json={"channel": "cursus"}).json()["id"] == "c11"


@pytest.mark.parametrize(
    ("origin", "stage"), [("backlog", "idea"), ("reference", "script"), ("blank", "script")]
)
def test_origin_sets_start_stage(seeded: TestClient, origin: str, stage: str) -> None:
    episode = seeded.post("/api/episodes", json={"channel": "otto", "origin": origin}).json()
    assert (episode["origin"], episode["stage"]) == (origin, stage)


@pytest.mark.parametrize(
    "body",
    [
        {"channel": "cursus", "origin": "fork"},
        {"channel": "cursus", "title": "   "},
        {"channel": "cursus", "title": "x" * 201},
        {"channel": "cursus", "stage": "edit"},
    ],
)
def test_bad_create_body_is_422(seeded: TestClient, body: dict[str, Any]) -> None:
    assert seeded.post("/api/episodes", json=body).status_code == 422


def test_parallel_creates_get_distinct_ids(
    seeded: TestClient, paths: StudioPaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Два соединения создают выпуск одновременно. Запись project.json замедлена, чтобы окно
    между выбором номера и вставкой перекрылось: без `BEGIN IMMEDIATE` оба взяли бы `c01`."""

    def write_slowly(path: Path, data: Any) -> None:
        time.sleep(0.2)
        write_json_atomic(path, data)

    monkeypatch.setattr(episodes_api, "write_json_atomic", write_slowly)
    barrier = threading.Barrier(2)
    ids: list[str] = []
    errors: list[BaseException] = []

    def create() -> None:
        conn = connect(paths.db_path)
        try:
            barrier.wait()
            ids.append(episodes_api.insert_episode(conn, paths, EpisodeCreate(channel="cursus")))
        except BaseException as exc:
            errors.append(exc)
        finally:
            conn.close()

    threads = [threading.Thread(target=create) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    assert sorted(ids) == ["c01", "c02"]
    listed = seeded.get("/api/episodes", params={"channel": "cursus"}).json()
    assert [e["id"] for e in listed] == sorted(ids)


# --- PATCH ---------------------------------------------------------------------------------------


def test_patch_renames_and_bumps_updated_at(
    seeded: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    created = seeded.post("/api/episodes", json={"channel": "cursus"}).json()
    monkeypatch.setattr(episodes_api, "now_iso", lambda: "2099-01-01T00:00:00+00:00")

    renamed = seeded.patch(
        "/api/episodes/c01", json={"title": "  Pirate ship  ", "short_title": "Pirates"}
    )
    assert renamed.status_code == 200, renamed.text
    body = renamed.json()
    assert (body["title"], body["short_title"]) == ("Pirate ship", "Pirates")
    assert body["updated_at"] == "2099-01-01T00:00:00+00:00" > created["updated_at"]
    assert body["created_at"] == created["created_at"]
    assert body["summary"]["shots_total"] == 0

    # Нет поля — не меняется; null у short_title — сброс, пустая строка — тоже.
    reset = seeded.patch("/api/episodes/c01", json={"short_title": None}).json()
    assert (reset["title"], reset["short_title"]) == ("Pirate ship", None)
    seeded.patch("/api/episodes/c01", json={"short_title": "Pirates"})
    blank = seeded.patch("/api/episodes/c01", json={"short_title": "  "}).json()
    assert blank["short_title"] is None
    assert seeded.get("/api/episodes/c01").json()["title"] == "Pirate ship"


@pytest.mark.parametrize(
    "body",
    [
        {"title": ""},
        {"title": "   "},
        {"title": None},
        {"title": "x" * 201},
        {"short_title": "x" * 41},
        {"slot_date": "2026-10-01"},
    ],
)
def test_patch_rejects_bad_values(seeded: TestClient, body: dict[str, Any]) -> None:
    seeded.post("/api/episodes", json={"channel": "cursus", "title": "Keep me"})
    assert seeded.patch("/api/episodes/c01", json=body).status_code == 422
    assert seeded.get("/api/episodes/c01").json()["title"] == "Keep me"


@pytest.mark.parametrize(
    ("body", "text"),
    [
        ({"title": "   "}, "Название не может быть пустым"),
        ({"title": None}, "Название не может быть пустым"),
        ({"title": "x" * 201}, "Название длиннее 200 знаков"),
        ({"short_title": "x" * 41}, "Короткое имя длиннее 40 знаков"),
        ({"title": "New", "stage": "edit"}, "Поля stage через PATCH не меняются"),
    ],
)
def test_errors_are_one_readable_message(
    seeded: TestClient, body: dict[str, Any], text: str
) -> None:
    """Текст 422 увидит пользователь: одна ошибка на поле, по-русски, без «Value error» и без
    «Input should be None» от второй ветки `str | None` (нашла живая проверка M3.1)."""
    seeded.post("/api/episodes", json={"channel": "cursus"})
    detail = seeded.patch("/api/episodes/c01", json=body).json()["detail"]
    assert len(detail) == 1, detail
    assert detail[0]["msg"].startswith(text)

    create = seeded.post("/api/episodes", json={"channel": "cursus", "title": "   "}).json()
    assert [e["msg"] for e in create["detail"]] == [
        "Название не может быть пустым — введите текст."
    ]


@pytest.mark.parametrize("field", ["stage", "status", "channel", "id", "origin"])
def test_patch_frozen_fields_are_422_with_reason(seeded: TestClient, field: str) -> None:
    seeded.post("/api/episodes", json={"channel": "cursus"})
    response = seeded.patch("/api/episodes/c01", json={"title": "New", field: "x"})
    assert response.status_code == 422
    message = json.dumps(response.json(), ensure_ascii=False)
    assert field in message
    assert "не меняются" in message
    assert seeded.get("/api/episodes/c01").json()["title"] == "Новый выпуск"


def test_patch_unknown_episode_is_404(seeded: TestClient) -> None:
    assert seeded.patch("/api/episodes/nope", json={"title": "X"}).status_code == 404


# --- список и сводка -----------------------------------------------------------------------------


def test_list_orders_by_slot_then_created(seeded: TestClient, paths: StudioPaths) -> None:
    for channel in ("cursus", "otto", "cursus"):
        seeded.post("/api/episodes", json={"channel": channel, "slot": None})
    conn = connect(paths.db_path)
    try:
        conn.execute("UPDATE episodes SET slot_date = '2026-10-01' WHERE id = 'c02'")
        conn.execute("UPDATE episodes SET slot_date = '2026-09-29' WHERE id = 'o01'")
        conn.commit()
    finally:
        conn.close()

    everything = seeded.get("/api/episodes").json()
    assert [e["id"] for e in everything] == ["o01", "c02", "c01"]
    cursus = seeded.get("/api/episodes", params={"channel": "cursus"}).json()
    assert [e["id"] for e in cursus] == ["c02", "c01"]


def _ledger_row(conn: sqlite3.Connection, episode_id: str, usd_micro: int, status: str) -> None:
    conn.execute(
        "INSERT INTO cost_ledger (ts, channel, episode_id, stage, provider, model, quantity, unit,"
        " cost_micro_usd, status) VALUES ('2026-09-26T10:00:00+00:00', 'cursus', ?, 'images',"
        " 'fake', 'fake-image', 1, 'image', ?, ?)",
        (episode_id, usd_micro, status),
    )


def test_summary_from_plan_ledger_and_jobs(seeded: TestClient, paths: StudioPaths) -> None:
    director = json.loads(DIRECTOR_FIXTURE.read_text(encoding="utf-8"))
    episode_id = director["meta"]["episode_id"]
    seeded.post("/api/episodes", json={"channel": "cursus", "id": episode_id})
    seeded.post("/api/episodes", json={"channel": "cursus"})
    write_json_atomic(paths.director_version_path("cursus", episode_id, 1), director)
    shots = {f"s{n:03d}": {"status": "done"} for n in range(1, 7)} | {"s007": {"status": "failed"}}
    patched = seeded.patch(
        f"/api/projects/{episode_id}", json={"director_version": "v001", "shots": shots}
    )
    assert patched.status_code == 200, patched.text

    conn = connect(paths.db_path)
    try:
        _ledger_row(conn, episode_id, 1_500_000, "charged")
        _ledger_row(conn, episode_id, 250_000, "estimated")
        _ledger_row(conn, episode_id, 0, "cached")
        _ledger_row(conn, episode_id, 0, "failed")
        _ledger_row(conn, episode_id, 900_000, "refused")
        _ledger_row(conn, "c01", 70_000, "charged")
        # `running` пул не трогает; `queued` взял бы воркер, поэтому в тесте только running.
        conn.execute(
            "INSERT INTO jobs (id, episode_id, kind, status, progress, message, payload,"
            " created_at) VALUES ('j1', ?, 'images', 'running', 0.6, '6 из 10', '{}',"
            " '2026-09-26T10:00:00+00:00')",
            (episode_id,),
        )
        conn.commit()
        expected_spent = conn.execute(
            "SELECT SUM(cost_micro_usd) FROM cost_ledger"
            " WHERE episode_id = ? AND status IN ('charged', 'estimated')",
            (episode_id,),
        ).fetchone()[0]
    finally:
        conn.close()

    listed = {e["id"]: e["summary"] for e in seeded.get("/api/episodes").json()}
    summary = listed[episode_id]
    assert summary == {
        "shots_total": 10,
        "shots_done": 6,
        "shots_failed": 1,
        "shots_stale": 0,
        "shots_generating": 0,
        "vo_words": 204,
        "duration_s": 81.6,
        "duration_source": "estimate",
        "spent_usd_micro": 1_750_000,
        "job": {"kind": "images", "status": "running", "progress": 0.6, "message": "6 из 10"},
    }
    assert summary["spent_usd_micro"] == expected_spent
    assert listed["c01"]["spent_usd_micro"] == 70_000
    assert listed["c01"]["job"] is None
    assert seeded.get(f"/api/episodes/{episode_id}").json()["summary"] == summary


def test_broken_project_json_does_not_break_list(seeded: TestClient, paths: StudioPaths) -> None:
    seeded.post("/api/episodes", json={"channel": "cursus"})
    seeded.post("/api/episodes", json={"channel": "otto"})
    paths.project_path("cursus", "c01").write_text("{not json", encoding="utf-8")

    response = seeded.get("/api/episodes")
    assert response.status_code == 200
    summaries = {e["id"]: e["summary"] for e in response.json()}
    assert summaries["c01"]["shots_total"] == 0
    assert summaries["c01"]["duration_s"] is None
    assert summaries["o01"]["duration_s"] is None


# --- projects ------------------------------------------------------------------------------------


def test_patch_project_merges_and_keeps_rest(seeded: TestClient, paths: StudioPaths) -> None:
    seeded.post("/api/episodes", json=PIRATE)
    first = seeded.patch(
        "/api/projects/pirate",
        json={"shots": {"s001": {"duration_locked": True}, "s002": {"status": "done"}}},
    )
    assert first.status_code == 200, first.text
    assert first.json()["shots"] == {
        "s001": {
            "status": "todo",
            "duration_locked": True,
            "prompt_locked": False,
            "user_override": None,
            "stale_reasons": [],
        },
        "s002": {
            "status": "done",
            "duration_locked": False,
            "prompt_locked": False,
            "user_override": None,
            "stale_reasons": [],
        },
    }

    second = seeded.patch(
        "/api/projects/pirate",
        json={
            "director_version": "v001",
            "shots": {"s001": {"user_override": {"motion": {"strength": 0.12}}}},
            "cost": {"script": 380_000},
        },
    )
    assert second.status_code == 200, second.text
    project = second.json()
    assert project["director_version"] == "v001"
    assert project["shots"]["s001"]["duration_locked"] is True
    assert project["shots"]["s001"]["user_override"] == {"motion": {"strength": 0.12}}
    assert project["shots"]["s002"]["status"] == "done"
    assert project["cost"] == {"script": 380_000}
    assert project["updated_at"] >= first.json()["updated_at"]

    on_disk = json.loads(paths.project_path("cursus", "pirate").read_text(encoding="utf-8"))
    assert on_disk == project
    assert seeded.get("/api/projects/pirate").json() == project


def test_patch_project_rejects_invalid(seeded: TestClient, paths: StudioPaths) -> None:
    seeded.post("/api/episodes", json=PIRATE)
    before = paths.project_path("cursus", "pirate").read_text(encoding="utf-8")

    assert seeded.patch("/api/projects/pirate", json={"shots": {"bad": {}}}).status_code == 422
    assert seeded.patch("/api/projects/pirate", json={"nope": 1}).status_code == 422
    assert seeded.patch("/api/projects/pirate", json={"cost": {"script": -1}}).status_code == 422
    identity = seeded.patch("/api/projects/pirate", json={"channel": "otto"})
    assert identity.status_code == 422
    assert "channel" in identity.json()["detail"]
    assert seeded.patch("/api/projects/nope", json={}).status_code == 404

    # Ни одна отклонённая правка не тронула файл.
    assert paths.project_path("cursus", "pirate").read_text(encoding="utf-8") == before
    # Те же значения identity-полей — не ошибка.
    assert seeded.patch("/api/projects/pirate", json={"channel": "cursus"}).status_code == 200
