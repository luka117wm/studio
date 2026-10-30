"""M4.3: правки кадров в PATCH, действующий план, проверка плана без записи, версия из JSON."""

import copy
import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.models.director import Director
from app.models.project import Asset, Project, ShotOverride, ShotState
from app.models.validators import DirectorValidationError, ValidationItem, validate_director
from app.pipeline.director_import import effective_plan, prune_override
from app.pipeline.director_import.effective import (
    MANUAL_STALE_REASONS,
    OVERRIDE_FIELDS,
    edit_stale,
    overridden_fields,
)
from app.pipeline.director_import.stale import STALE_FIELDS
from app.settings import Settings
from app.storage.atomic import read_json
from app.storage.db import connect
from app.storage.paths import StudioPaths
from app.tools.seed import seed

FIXTURES = Path(__file__).parent / "fixtures"
EPISODE = "c07-pirate-ship"
# Фикстура `draw` из conftest.py: версия картинки кадра, первая — выбранная.
DrawShot = Callable[..., Asset]
PROJECT_URL = f"/api/projects/{EPISODE}"
DIRECTOR_URL = f"/api/projects/{EPISODE}/director"
PLAN_URL = f"/api/projects/{EPISODE}/plan"
VALIDATE_URL = f"/api/projects/{EPISODE}/director/validate"
NEW_VO = "You are eleven, and the gunpowder is your first lesson."
STYLE_TAIL = "ожидалось только действие, композиция и ракурс — стиль задаёт канон"


def load(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return data


@pytest.fixture
def v1() -> dict[str, Any]:
    return load("director_pirate_10shots.json")


@pytest.fixture
def v2() -> dict[str, Any]:
    return load("director_pirate_v2.json")


@pytest.fixture
def paths(settings: Settings) -> StudioPaths:
    return StudioPaths(settings.studio_data_dir)


@pytest.fixture
def episode(client: TestClient, paths: StudioPaths) -> Iterator[TestClient]:
    """Каналы засеяны, выпуск создан, плана ещё нет."""
    conn = connect(paths.db_path)
    try:
        seed(paths, conn)
    finally:
        conn.close()
    created = client.post(
        "/api/episodes", json={"id": EPISODE, "channel": "cursus", "title": "Pirate"}
    )
    assert created.status_code == 201, created.text
    yield client


@pytest.fixture
def planned(episode: TestClient, v1: dict[str, Any]) -> TestClient:
    """Выпуск с импортированной версией v001."""
    assert episode.post(DIRECTOR_URL, json=v1).status_code == 200
    return episode


def on_disk(paths: StudioPaths) -> dict[str, Any]:
    data: dict[str, Any] = read_json(paths.project_path("cursus", EPISODE))
    return data


def edit(client: TestClient, shot_id: str, override: dict[str, Any] | None) -> Any:
    return client.patch(PROJECT_URL, json={"shots": {shot_id: {"user_override": override}}})


def messages(response: Any) -> list[str]:
    assert response.status_code == 422, response.text
    return [error["msg"] for error in response.json()["detail"]]


# --- PATCH правок ---------------------------------------------------------------------------------


def test_vo_override_writes_only_that_field_and_null_resets(
    planned: TestClient, paths: StudioPaths
) -> None:
    before = on_disk(paths)
    response = edit(planned, "s001", {"vo": NEW_VO})
    assert response.status_code == 200, response.text

    after = on_disk(paths)
    assert after["shots"]["s001"] == {**before["shots"]["s001"], "user_override": {"vo": NEW_VO}}
    assert {k: v for k, v in after["shots"].items() if k != "s001"} == {
        k: v for k, v in before["shots"].items() if k != "s001"
    }
    assert response.json() == after

    reset = edit(planned, "s001", {"vo": None})
    assert reset.status_code == 200, reset.text
    assert on_disk(paths)["shots"]["s001"] == before["shots"]["s001"]


def test_partial_override_merges_and_resets_by_field(
    planned: TestClient, paths: StudioPaths
) -> None:
    assert edit(planned, "s003", {"motion": {"strength": 0.2}}).status_code == 200
    merged = edit(
        planned,
        "s003",
        {"motion": {"type": "push_in"}, "transition_in": {"type": "crossfade", "duration": 0.5}},
    )
    assert merged.status_code == 200, merged.text
    assert on_disk(paths)["shots"]["s003"]["user_override"] == {
        "motion": {"type": "push_in", "strength": 0.2},
        "transition_in": {"type": "crossfade", "duration": 0.5},
    }

    # Сброс одного поля; опустевший блок исчезает; пустой список SFX — тоже правка.
    edit(planned, "s003", {"motion": {"strength": None, "type": None}, "sfx": []})
    assert on_disk(paths)["shots"]["s003"]["user_override"] == {
        "transition_in": {"type": "crossfade", "duration": 0.5},
        "sfx": [],
    }

    assert edit(planned, "s003", None).status_code == 200
    assert on_disk(paths)["shots"]["s003"]["user_override"] is None


@pytest.mark.parametrize(
    ("shot_id", "body", "expected"),
    [
        (
            "s003",
            {"user_override": {"image": {"prompt": "sprints along the deck, cinematic lighting"}}},
            [
                "кадр s003: в image.prompt стилевой токен «cinematic lighting» (lighting), "
                + STYLE_TAIL
            ],
        ),
        (
            "s003",
            {"user_override": {"vo": "   "}},
            ["кадр s003: пустой vo, ожидалось текст закадрового голоса"],
        ),
        (
            "s003",
            {"user_override": {"motion": {"strength": 0.3}}},
            ["кадр s003: motion.strength = 0.3 вне диапазона, ожидалось ≤ 0.25"],
        ),
        (
            "s001",
            {"user_override": {"animate": {"recommended": True}}},
            [
                "кадр s001: animate.recommended = true без animate.prompt, "
                "ожидалось описание движения для анимации"
            ],
        ),
        (
            "s003",
            {"user_override": {"image": {"period": "england-1347"}}},
            ["кадр s003: image.period правкой не меняется — его задаёт новая версия плана"],
        ),
        (
            "s003",
            {"user_override": {"section": "r2"}},
            [
                "кадр s003: лишнее поле section в правке, ожидалось одно из: vo, image.prompt, "
                "image.shot_size, motion, transition_in, animate, sfx"
            ],
        ),
        (
            "s003",
            {"status": "done"},
            [
                "кадр s003: поле status меняется пайплайном, не через PATCH — "
                "уберите его из запроса."
            ],
        ),
        (
            "s003",
            {"duration_locked": None},
            ["кадр s003: duration_locked = None не того типа, ожидалось логическое значение"],
        ),
    ],
)
def test_bad_edit_is_422_with_shot_message(
    planned: TestClient,
    paths: StudioPaths,
    shot_id: str,
    body: dict[str, Any],
    expected: list[str],
) -> None:
    before = on_disk(paths)
    response = planned.patch(PROJECT_URL, json={"shots": {shot_id: body}})
    assert messages(response) == expected
    assert on_disk(paths) == before


def test_edit_of_shot_outside_current_version_is_422(
    episode: TestClient, paths: StudioPaths, v1: dict[str, Any], v2: dict[str, Any]
) -> None:
    no_plan = episode.patch(PROJECT_URL, json={"shots": {"s001": {"duration_locked": True}}})
    assert messages(no_plan) == [
        "кадр s001: плана ещё нет — сначала импортируйте план, потом правьте кадры"
    ]

    assert episode.post(DIRECTOR_URL, json=v1).status_code == 200
    assert messages(edit(episode, "s099", {"vo": NEW_VO})) == [
        "кадр s099: нет в плане v001, ожидалось id кадра текущей версии"
    ]

    assert episode.post(DIRECTOR_URL, json=v2).status_code == 200
    assert messages(edit(episode, "s006", {"vo": NEW_VO})) == [
        "кадр s006: убран из плана v002, править нечего"
    ]


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        (
            {"director_version": "v009"},
            "Поле director_version меняется пайплайном, не через PATCH — уберите его из запроса.",
        ),
        (
            {"assets": {}},
            "Поле assets меняется пайплайном, не через PATCH — уберите его из запроса.",
        ),
        (
            {"updated_at": "2026-10-07T00:00:00+00:00"},
            "Поле updated_at меняется пайплайном, не через PATCH — уберите его из запроса.",
        ),
        (
            {"episode_id": EPISODE},
            "Поле episode_id задаётся при создании выпуска и не меняется — уберите его из запроса.",
        ),
        ({"title": "Pirates"}, "Лишнее поле title — уберите его из запроса."),
    ],
)
def test_pipeline_fields_are_422(
    planned: TestClient, paths: StudioPaths, body: dict[str, Any], expected: str
) -> None:
    before = on_disk(paths)
    assert messages(planned.patch(PROJECT_URL, json=body)) == [expected]
    assert on_disk(paths) == before


# --- ручной stale ---------------------------------------------------------------------------------


def test_prompt_edit_makes_drawn_shot_stale(
    planned: TestClient, paths: StudioPaths, draw: DrawShot
) -> None:
    draw(EPISODE, "s002")
    draw(EPISODE, "s004")

    edit(planned, "s002", {"image": {"prompt": "steps into the dark magazine with a lantern"}})
    state = on_disk(paths)["shots"]["s002"]
    assert (state["status"], state["stale_reasons"]) == ("stale", ["Промпт изменён вручную"])

    edit(planned, "s002", {"image": {"shot_size": "detail"}})
    assert on_disk(paths)["shots"]["s002"]["stale_reasons"] == [
        "Промпт изменён вручную",
        "Крупность изменена вручную",
    ]

    # VO на картинку не влияет; без картинки (todo) рисовать заново нечего.
    edit(planned, "s004", {"vo": NEW_VO})
    edit(planned, "s005", {"image": {"prompt": "the boy flinches and covers his ears"}})
    project = on_disk(paths)
    assert (project["shots"]["s004"]["status"], project["shots"]["s004"]["stale_reasons"]) == (
        "done",
        [],
    )
    assert project["shots"]["s005"]["status"] == "todo"


def test_manual_stale_reasons_cover_editable_stale_fields() -> None:
    assert set(MANUAL_STALE_REASONS) == STALE_FIELDS & set(OVERRIDE_FIELDS)


# --- новая версия поверх правок -------------------------------------------------------------------


def test_vo_edit_survives_new_version_with_other_vo(
    planned: TestClient, paths: StudioPaths, v2: dict[str, Any], draw: DrawShot
) -> None:
    draw(EPISODE, "s009")
    assert edit(planned, "s009", {"vo": NEW_VO}).status_code == 200
    result = planned.post(DIRECTOR_URL, json=v2).json()
    assert result["version"] == "v002"

    state = on_disk(paths)["shots"]["s009"]
    assert state["user_override"] == {"vo": NEW_VO}
    assert state["status"] == "stale"
    assert state["stale_reasons"] == ["План изменил vo, но действует ручная правка vo"]

    shot = next(s for s in planned.get(PLAN_URL).json()["shots"] if s["id"] == "s009")
    assert (shot["vo"], shot["overridden"], shot["status"]) == (NEW_VO, ["vo"], "stale")


# --- действующий план -----------------------------------------------------------------------------


def test_plan_is_null_before_import(episode: TestClient) -> None:
    response = episode.get(PLAN_URL)
    assert response.status_code == 200
    assert response.json() is None


def test_effective_plan_overlays_edits_and_keeps_removed(
    planned: TestClient, v1: dict[str, Any], v2: dict[str, Any]
) -> None:
    edit(planned, "s001", {"vo": NEW_VO})
    edit(planned, "s003", {"motion": {"strength": 0.2}, "image": {"shot_size": "detail"}})
    assert planned.post(DIRECTOR_URL, json=v2).status_code == 200

    plan = planned.get(PLAN_URL).json()
    assert (plan["version"], plan["source"], plan["approved_version"]) == ("v002", "manual", None)
    assert plan["meta"] == v2["meta"] and plan["sections"] == v2["sections"]
    assert plan["facts"] == v2["facts"]
    assert [s["id"] for s in plan["shots"]] == [s["id"] for s in v2["shots"]] + ["s006"]

    by_id = {s["id"]: s for s in plan["shots"]}
    assert by_id["s001"]["vo"] == NEW_VO and by_id["s001"]["overridden"] == ["vo"]
    v1_s003 = next(s for s in v1["shots"] if s["id"] == "s003")
    assert by_id["s003"]["motion"] == {**v1_s003["motion"], "strength": 0.2}
    assert by_id["s003"]["image"] == {**v1_s003["image"], "shot_size": "detail"}
    assert by_id["s003"]["overridden"] == ["image.shot_size", "motion"]
    assert all(s["overridden"] == [] for s in plan["shots"] if s["id"] not in ("s001", "s003"))

    removed = by_id["s006"]
    v1_s006 = next(s for s in v1["shots"] if s["id"] == "s006")
    assert removed["status"] == "removed"
    assert removed["stale_reasons"] == ["Кадр убран из плана v002"]
    assert removed["vo"] == v1_s006["vo"] and removed["image"] == v1_s006["image"]
    assert by_id["s011"]["status"] == "todo"


def test_effective_plan_is_pure(v1: dict[str, Any]) -> None:
    director = Director.model_validate(v1)
    project = Project.model_validate(
        {
            "schema": "studio.project/1",
            "episode_id": EPISODE,
            "channel": "cursus",
            "director_version": "v001",
            "director_versions": {
                "v001": {
                    "version": "v001",
                    "hash": "sha256:x",
                    "imported_at": "2026-10-07T00:00:00+00:00",
                    "parts": 1,
                    "source": "bridge",
                    "shots": 10,
                    "added": 10,
                    "changed": 0,
                    "removed": 0,
                }
            },
            "shots": {"s002": {"status": "done", "user_override": {"vo": NEW_VO}}},
            "updated_at": "2026-10-07T00:00:00+00:00",
        }
    )
    director_before = copy.deepcopy(director.model_dump())
    project_before = copy.deepcopy(project.model_dump())

    plan = effective_plan(director, project)
    assert plan.source == "bridge"
    assert plan.shots[1].vo == NEW_VO and plan.shots[1].status == "done"
    # Кадр без записи в project.json — состояние по умолчанию.
    assert plan.shots[0].status == "todo" and plan.shots[0].overridden == []
    assert director.model_dump() == director_before
    assert project.model_dump() == project_before


def test_override_helpers() -> None:
    assert prune_override({"vo": None, "motion": {"strength": None}, "sfx": []}) == {"sfx": []}
    assert prune_override({"motion": {"type": None}}) is None
    override = ShotOverride.model_validate({"sfx": [], "image": {"prompt": "x"}})
    assert overridden_fields(override) == ["image.prompt", "sfx"]
    assert overridden_fields(None) == []
    # В JSON — только заданные поля.
    assert override.model_dump(mode="json") == {"image": {"prompt": "x"}, "sfx": []}
    state = ShotState(status="todo")
    director = Director.model_validate(load("director_pirate_10shots.json"))
    shot = director.shots[0]
    assert edit_stale(state, shot, shot) is state


# --- проверка без записи --------------------------------------------------------------------------


def test_validate_reports_items_and_writes_nothing(
    episode: TestClient, paths: StudioPaths, v1: dict[str, Any]
) -> None:
    before = on_disk(paths)
    assert episode.post(VALIDATE_URL, json=v1).json() == {"ok": True, "errors": [], "items": []}

    style = episode.post(VALIDATE_URL, json=load("director_broken_style_token.json")).json()
    assert style["ok"] is False
    assert style["items"] == [
        {
            "shot_id": "s003",
            "path": "image.prompt",
            "message": f"кадр s003: в image.prompt стилевой токен «cinematic lighting» "
            f"(lighting), {STYLE_TAIL}",
        },
        {
            "shot_id": "s003",
            "path": "image.prompt",
            "message": f"кадр s003: в image.prompt стилевой токен «8k» (render), {STYLE_TAIL}",
        },
    ]
    assert style["errors"] == [item["message"] for item in style["items"]]

    motion = episode.post(VALIDATE_URL, json=load("director_broken_motion_strength.json")).json()
    assert motion["items"] == [
        {
            "shot_id": "s002",
            "path": "motion.strength",
            "message": "кадр s002: motion.strength = 0.4 вне диапазона, ожидалось ≤ 0.25",
        }
    ]

    alien = copy.deepcopy(v1)
    alien["meta"]["episode_id"] = "other-episode"
    assert episode.post(VALIDATE_URL, json=alien).json() == {
        "ok": False,
        "errors": [
            f"meta: episode_id «other-episode» — план для другого выпуска, ожидалось «{EPISODE}»"
        ],
        "items": [
            {
                "shot_id": None,
                "path": "meta.episode_id",
                "message": "meta: episode_id «other-episode» — план для другого выпуска, "
                f"ожидалось «{EPISODE}»",
            }
        ],
    }

    assert on_disk(paths) == before
    assert list(paths.director_dir("cursus", EPISODE).iterdir()) == []


def test_import_422_carries_items(episode: TestClient) -> None:
    detail = episode.post(DIRECTOR_URL, json=load("director_broken_style_token.json")).json()
    detail = detail["detail"]
    assert len(detail["errors"]) == 2
    assert [item["message"] for item in detail["items"]] == detail["errors"]
    assert {item["shot_id"] for item in detail["items"]} == {"s003"}


def test_items_for_domain_and_structural_errors(v1: dict[str, Any]) -> None:
    broken = copy.deepcopy(v1)
    broken["shots"][1]["id"] = "s001"
    broken["music"][0]["section"] = "nope"
    with pytest.raises(DirectorValidationError) as caught:
        validate_director(broken)
    items = caught.value.items
    assert [(i.shot_id, i.path) for i in items] == [("s001", "id"), (None, "music.0.section")]
    assert [i.message for i in items] == caught.value.errors

    no_id = copy.deepcopy(v1)
    del no_id["shots"][0]["id"]
    with pytest.raises(DirectorValidationError) as caught:
        validate_director(no_id)
    assert caught.value.items == [
        ValidationItem(
            shot_id=None, path="id", message="кадр #1: нет поля id, ожидалось обязательное поле"
        )
    ]


# --- версия из JSON -------------------------------------------------------------------------------


def test_source_query_saves_manual_version(
    planned: TestClient, paths: StudioPaths, v1: dict[str, Any]
) -> None:
    edited = copy.deepcopy(v1)
    edited["shots"][0]["vo"] = NEW_VO
    saved = planned.post(DIRECTOR_URL + "?source=manual", json=edited)
    assert saved.status_code == 200, saved.text
    assert (saved.json()["version"], saved.json()["created"]) == ("v002", True)
    assert on_disk(paths)["director_versions"]["v002"]["source"] == "manual"
    assert planned.get(PLAN_URL).json()["source"] == "manual"

    again = planned.post(DIRECTOR_URL + "?source=manual", json=edited).json()
    assert (again["version"], again["created"]) == ("v002", False)
