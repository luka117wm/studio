import json
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.settings import Settings
from app.storage.db import connect
from app.storage.paths import StudioPaths
from app.tools.seed import seed


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
    assert episode["stage"] == "idea"
    assert episode["status"] == "queued"
    assert episode["created_at"] == episode["updated_at"]

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
        },
        "s002": {
            "status": "done",
            "duration_locked": False,
            "prompt_locked": False,
            "user_override": None,
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
