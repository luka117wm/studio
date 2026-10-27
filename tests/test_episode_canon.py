"""M5.2: канон выпуска — правило версий `canon_ref`, статусы, «Перевести на новые версии»,
«нужно каналу» и скелеты. Утверждение с проверкой канона — `tests/test_plan_approve.py`, план из
моста — `tests/test_plan_bridge.py`."""

import copy
import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.models.canon import CanonEntity, Character, Period
from app.models.director import CanonRef, Director
from app.models.project import Asset
from app.pipeline.canon.episode_canon import (
    AnchorSheet,
    CanonPins,
    PublishedCanon,
    Versions,
    episode_canon,
    no_sheet,
    updated_ref,
)
from app.pipeline.script.plan_bridge import build_canon_ref, fill_canon_ref
from app.settings import Settings
from app.storage import canon_store
from app.storage.atomic import read_json
from app.storage.canon_store import CHARACTERS, PERIODS, Layer
from app.storage.db import connect
from app.storage.paths import StudioPaths
from app.tools.seed import seed

FIXTURES = Path(__file__).parent / "fixtures"
EPISODE = "c07-pirate-ship"
# Фикстура `draw` из conftest.py: версия картинки кадра, первая — выбранная.
DrawShot = Callable[..., Asset]
OTHER = "c08-navy"
CANON_URL = f"/api/projects/{EPISODE}/canon"
UPDATE_URL = f"{CANON_URL}/update"
NEEDED_URL = "/api/canon/cursus/needed"
V001_REFS = {
    "style": "style/v001",
    "periods": {"caribbean-1716": "periods/caribbean-1716/v001"},
    "appearances": {"you@powder-monkey-11": "characters/you/v001#powder-monkey-11"},
}
# Кадры фикстуры с обликом you@powder-monkey-11; остальные (s001, s004, s007) — без персонажа.
POWDER_MONKEY_SHOTS = ["s002", "s003", "s005", "s006", "s008", "s009", "s010"]


def plan(episode_id: str = EPISODE) -> dict[str, Any]:
    """Фикстура плана, прибитая к заготовкам `v001`, как план из моста до канона."""
    data: dict[str, Any] = json.loads(
        (FIXTURES / "director_pirate_10shots.json").read_text(encoding="utf-8")
    )
    data["meta"]["episode_id"] = episode_id
    data["canon_ref"] = copy.deepcopy(V001_REFS)
    return data


def canon_fixture[E: CanonEntity](model: type[E], name: str) -> E:
    return model.model_validate_json((FIXTURES / "canon" / name).read_text(encoding="utf-8"))


PERIOD_V1 = canon_fixture(Period, "period_caribbean_1716.json")
PERIOD_V2 = PERIOD_V1.model_copy(update={"forbidden": [*PERIOD_V1.forbidden, "tin cans"]})
CHARACTER_V1 = canon_fixture(Character, "character_you.json")
CHARACTER_V2 = CHARACTER_V1.model_copy(update={"label": "Ты, моряк"})


def publish[E: CanonEntity](
    paths: StudioPaths, layer: Layer[E], entity_id: str | None, data: E
) -> None:
    canon_store.save_draft(paths, "cursus", layer, entity_id, data)
    canon_store.publish(paths, "cursus", layer, entity_id)


@pytest.fixture
def paths(settings: Settings) -> StudioPaths:
    return StudioPaths(settings.studio_data_dir)


@pytest.fixture
def seeded(client: TestClient, paths: StudioPaths) -> Iterator[TestClient]:
    """Каналы засеяны, выпуск c07-pirate-ship создан, плана нет."""
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
def planned(seeded: TestClient) -> TestClient:
    response = seeded.post(f"/api/projects/{EPISODE}/director", json=plan())
    assert response.status_code == 200, response.text
    return seeded


def project(paths: StudioPaths, episode_id: str = EPISODE) -> dict[str, Any]:
    data: dict[str, Any] = read_json(paths.project_path("cursus", episode_id))
    return data


def version_file(paths: StudioPaths, number: int) -> dict[str, Any]:
    data: dict[str, Any] = read_json(paths.director_version_path("cursus", EPISODE, number))
    return data


def set_stage(paths: StudioPaths, value: str) -> None:
    conn = connect(paths.db_path)
    try:
        with conn:
            conn.execute("UPDATE episodes SET stage = ? WHERE id = ?", (value, EPISODE))
    finally:
        conn.close()


# --- правило версий (чистые функции) -------------------------------------------------------------


SHOTS = [
    {"id": "s001", "image": {"period": "caribbean-1716", "appearances": ["you@captain-35"]}},
    {"id": "s002", "image": {"period": "venice-1570", "appearances": ["you@comito-34"]}},
    {"id": "s003", "image": {"period": "england-1347", "appearances": []}},
]
PUBLISHED = PublishedCanon(
    style=Versions(("v001", "v002")),
    periods={"caribbean-1716": Versions(("v001", "v002")), "venice-1570": Versions(("v001",))},
    appearances={
        "you@captain-35": Versions(("v002", "v003")),
        "you@comito-34": Versions(("v003",)),
    },
)


def test_pins_keep_previous_take_latest_or_placeholder() -> None:
    previous = CanonRef(
        style="style/v001",
        periods={"caribbean-1716": "periods/caribbean-1716/v001"},
        appearances={"you@captain-35": "characters/you/v002#captain-35"},
    )
    ref = build_canon_ref(SHOTS, CanonPins(previous=previous, published=PUBLISHED))
    assert ref == CanonRef(
        style="style/v001",  # прибит, хотя есть v002
        periods={
            "caribbean-1716": "periods/caribbean-1716/v001",  # прибита, хотя есть v002
            "england-1347": "periods/england-1347/v001",  # версий нет — заготовка
            "venice-1570": "periods/venice-1570/v001",  # новая — последняя опубликованная
        },
        appearances={
            "you@captain-35": "characters/you/v002#captain-35",
            "you@comito-34": "characters/you/v003#comito-34",
        },
    )


def test_first_plan_takes_latest_and_no_canon_gives_placeholders() -> None:
    assert build_canon_ref(SHOTS, CanonPins(published=PUBLISHED)).style == "style/v002"
    assert build_canon_ref(SHOTS) == CanonRef(
        style="style/v001",
        periods={p: f"periods/{p}/v001" for p in ("caribbean-1716", "england-1347", "venice-1570")},
        appearances={
            "you@captain-35": "characters/you/v001#captain-35",
            "you@comito-34": "characters/you/v001#comito-34",
        },
    )


def test_fill_keeps_sent_refs_and_adds_missing() -> None:
    """«Сохранить как версию»: присланное — как есть (даже не по формату — об этом скажет
    валидатор), недостающее — по правилу; без блока — ничего не дописывается."""
    pins = CanonPins(published=PUBLISHED)
    body = {
        "canon_ref": {"periods": {"caribbean-1716": "periods/caribbean-1716/v9"}},
        "shots": SHOTS,
    }
    assert fill_canon_ref(body, pins)["canon_ref"] == {
        "style": "style/v002",
        "periods": {
            "caribbean-1716": "periods/caribbean-1716/v9",
            "england-1347": "periods/england-1347/v001",
            "venice-1570": "periods/venice-1570/v001",
        },
        "appearances": {
            "you@captain-35": "characters/you/v003#captain-35",
            "you@comito-34": "characters/you/v003#comito-34",
        },
    }
    assert "canon_ref" not in fill_canon_ref({"shots": SHOTS}, pins)
    broken = {"canon_ref": {"style": "style/v001", "periods": []}, "shots": SHOTS}
    assert fill_canon_ref(broken, pins)["canon_ref"]["periods"] == []


def test_updated_ref_moves_only_what_is_published() -> None:
    ref = CanonRef(
        style="style/v001",
        periods={
            "caribbean-1716": "periods/caribbean-1716/v001",
            "england-1347": "periods/england-1347/v001",
        },
        appearances={"you@captain-35": "characters/you/v001#captain-35"},
    )
    assert updated_ref(ref, PUBLISHED) == CanonRef(
        style="style/v002",
        periods={
            "caribbean-1716": "periods/caribbean-1716/v002",
            "england-1347": "periods/england-1347/v001",  # нечего публиковать — как было
        },
        appearances={"you@captain-35": "characters/you/v003#captain-35"},
    )


# --- статусы канона выпуска -----------------------------------------------------------------------


def status_plan() -> Director:
    data = plan()
    data["shots"][0]["image"]["period"] = "england-1347"
    data["shots"][3]["image"]["appearances"] = ["you@captain-35"]
    data["shots"][6]["image"]["appearances"] = ["you@cook-40"]
    data["canon_ref"] = {
        "style": "style/v001",
        "periods": {
            "caribbean-1716": "periods/caribbean-1716/v002",
            "england-1347": "periods/england-1347/v001",
        },
        "appearances": {
            "you@captain-35": "characters/you/v001#captain-35",
            "you@cook-40": "characters/you/v001#cook-40",
            "you@powder-monkey-11": "characters/you/v001#powder-monkey-11",
        },
    }
    return Director.model_validate(data)


def test_statuses_and_problems() -> None:
    published = PublishedCanon(
        style=Versions(("v001", "v002")),
        periods={
            "caribbean-1716": Versions(("v001", "v002")),
            "england-1347": Versions((), draft=True),
        },
        # Облик капитана появился в v002 персонажа — ссылка на v001 его не находит.
        appearances={
            "you@captain-35": Versions(("v002",)),
            "you@powder-monkey-11": Versions(("v001", "v002")),
        },
    )
    asked: list[tuple[str, str]] = []

    def sheets(appearance_id: str, version: str) -> AnchorSheet:
        asked.append((appearance_id, version))
        return AnchorSheet(status="partial", chosen=3)

    canon = episode_canon(status_plan(), "v004", published, sheets)
    assert (canon.plan_version, canon.ready, canon.updatable) == ("v004", False, True)
    rows = [canon.style, *canon.periods, *canon.appearances]
    assert [(r.id, r.pinned, r.latest, r.status, r.resolved, r.shots) for r in rows] == [
        ("style", "v001", "v002", "outdated", True, 10),
        ("caribbean-1716", "v002", "v002", "ready", True, 9),
        ("england-1347", "v001", None, "draft_only", False, 1),
        ("you@captain-35", "v001", "v002", "outdated", False, 1),
        ("you@cook-40", "v001", None, "missing", False, 1),
        ("you@powder-monkey-11", "v001", "v002", "outdated", True, 7),
    ]
    assert asked == [("you@powder-monkey-11", "v001")]  # лист — только у найденной версии
    assert canon.appearances[0].sheet == no_sheet()
    assert [(p.kind, p.id, p.issue, p.message) for p in canon.problems] == [
        (
            "period",
            "england-1347",
            "unpublished",
            "эпоха england-1347: есть только черновик — опубликуйте его на экране «Канон»",
        ),
        (
            "appearance",
            "you@captain-35",
            "unresolved",
            "облик you@captain-35: ссылка characters/you/v001#captain-35 не находит опубликованную"
            " версию — переведите выпуск на v002 кнопкой «Перевести на новые версии»",
        ),
        (
            "appearance",
            "you@cook-40",
            "unpublished",
            "облик you@cook-40 не опубликован — создайте и опубликуйте его на экране «Канон»",
        ),
        (
            "appearance",
            "you@powder-monkey-11",
            "sheet_incomplete",
            "облик you@powder-monkey-11: лист 3/6 — выберите недостающие ракурсы на экране «Канон»",
        ),
    ]


def test_ready_canon_has_no_problems() -> None:
    director = Director.model_validate(plan())
    published = PublishedCanon(
        style=Versions(("v001",)),
        periods={"caribbean-1716": Versions(("v001",))},
        appearances={"you@powder-monkey-11": Versions(("v001",))},
    )
    canon = episode_canon(
        director, "v001", published, lambda _a, _v: AnchorSheet(status="ready", chosen=6)
    )
    assert (canon.ready, canon.updatable, canon.problems) == (True, False, [])


# --- канон выпуска и «Сохранить как версию» (API) ------------------------------------------------


def test_episode_canon_without_plan_is_null(seeded: TestClient) -> None:
    response = seeded.get(CANON_URL)
    assert response.status_code == 200
    assert response.json() is None


def test_episode_canon_reads_channel(planned: TestClient, paths: StudioPaths) -> None:
    publish(paths, PERIODS, "caribbean-1716", PERIOD_V1)
    publish(paths, PERIODS, "caribbean-1716", PERIOD_V2)
    canon_store.save_draft(paths, "cursus", CHARACTERS, "you", CHARACTER_V1)
    body = planned.get(CANON_URL).json()
    assert (body["plan_version"], body["ready"], body["updatable"]) == ("v001", False, True)
    assert body["style"]["status"] == "missing"
    assert body["periods"][0] == {
        "id": "caribbean-1716",
        "ref": "periods/caribbean-1716/v001",
        "pinned": "v001",
        "latest": "v002",
        "status": "outdated",
        "resolved": True,
        "draft": False,
        "shots": 10,
    }
    [appearance] = body["appearances"]
    assert (appearance["status"], appearance["draft"], appearance["sheet"]) == (
        "draft_only",
        True,
        {"status": "missing", "chosen": 0, "total": 6},
    )
    assert [p["issue"] for p in body["problems"]] == ["unpublished", "unpublished"]


def test_save_as_version_keeps_pins_and_fills_new_ids(
    planned: TestClient, paths: StudioPaths
) -> None:
    """Редактор шлёт `canon_ref` текущей версии: прибитое остаётся, новый облик без ключа получает
    последнюю опубликованную версию; проверка без записи согласна с импортом."""
    publish(paths, PERIODS, "caribbean-1716", PERIOD_V1)
    publish(paths, PERIODS, "caribbean-1716", PERIOD_V2)
    publish(paths, CHARACTERS, "you", CHARACTER_V1)
    publish(paths, CHARACTERS, "you", CHARACTER_V2)

    edited = version_file(paths, 1)
    edited["shots"][1]["vo"] += " Again."
    edited["shots"][3]["image"]["appearances"] = ["you@captain-35"]
    check = planned.post(f"/api/projects/{EPISODE}/director/validate", json=edited)
    assert check.json() == {"ok": True, "errors": [], "items": []}
    response = planned.post(f"/api/projects/{EPISODE}/director", json=edited)
    assert response.status_code == 200, response.text
    assert response.json()["version"] == "v002"
    assert version_file(paths, 2)["canon_ref"] == {
        "style": "style/v001",
        "periods": {"caribbean-1716": "periods/caribbean-1716/v001"},
        "appearances": {
            "you@captain-35": "characters/you/v002#captain-35",
            "you@powder-monkey-11": "characters/you/v001#powder-monkey-11",
        },
    }
    versions = planned.get(f"/api/projects/{EPISODE}/director/versions").json()
    assert versions[-1]["source"] == "manual"


def test_import_without_canon_still_works_and_shows_missing(planned: TestClient) -> None:
    """Устав M5, решение 3: отсутствующий канон импорт не останавливает — канон выпуска
    показывает `missing`, отказ будет только при утверждении."""
    body = planned.get(CANON_URL).json()
    assert [r["status"] for r in [body["style"], *body["periods"], *body["appearances"]]] == [
        "missing",
        "missing",
        "missing",
    ]
    assert body["updatable"] is False


# --- «Перевести на новые версии» ------------------------------------------------------------------


def test_update_moves_to_latest_and_marks_drawn_shots_stale(
    planned: TestClient, paths: StudioPaths, draw: DrawShot
) -> None:
    publish(paths, PERIODS, "caribbean-1716", PERIOD_V1)
    publish(paths, PERIODS, "caribbean-1716", PERIOD_V2)
    set_stage(paths, "generate")
    drawn = draw(EPISODE, "s001")  # картинка есть только у s001
    before = project(paths)

    response = planned.post(UPDATE_URL)
    assert response.status_code == 200, response.text
    result = response.json()
    assert (result["version"], result["created"], result["changed"]) == ("v002", True, 10)
    reason = "Эпоха caribbean-1716: periods/caribbean-1716/v001 → periods/caribbean-1716/v002"
    # Дата и цена выбранной версии (M6.11): «картинка 12:41, $0.067 — устарела».
    assert result["changes"][0] == {
        "shot_id": "s001",
        "section": "r1",
        "kind": "changed",
        "change": reason,
        "fields": [],
        "stale": True,
        "drawn_at": drawn.created_at,
        "price": {"usd_micro": drawn.usd_micro, "usd": "$0.067"},
    }
    assert result["changes"][1]["drawn_at"] is None and result["changes"][1]["price"] is None

    v001, v002 = version_file(paths, 1), version_file(paths, 2)
    assert v002["canon_ref"] == V001_REFS | {
        "periods": {"caribbean-1716": "periods/caribbean-1716/v002"}
    }
    assert {k: v for k, v in v002.items() if k != "canon_ref"} == {
        k: v for k, v in v001.items() if k != "canon_ref"
    }
    assert [c["shot_id"] for c in result["changes"] if c["stale"]] == ["s001"]
    after = project(paths)
    assert (after["shots"]["s001"]["status"], after["shots"]["s001"]["stale_reasons"]) == (
        "stale",
        [reason],
    )
    # Без картинки устаревать нечему: `todo`, причина — в истории кадра (M6.1).
    others = [state for shot_id, state in after["shots"].items() if shot_id != "s001"]
    assert all((s["status"], s["stale_reasons"]) == ("todo", [reason]) for s in others)
    assert (after["assets"], after["timings"]) == (before["assets"], before["timings"])
    assert after["director_versions"]["v002"]["source"] == "manual"
    # Утверждённый выпуск возвращается в «Сценарий» — новую версию утверждают снова (M4.6).
    assert planned.get(f"/api/episodes/{EPISODE}").json()["stage"] == "script"
    assert planned.get(CANON_URL).json()["updatable"] is False


def test_update_touches_only_shots_with_changed_appearance(
    planned: TestClient, paths: StudioPaths, draw: DrawShot
) -> None:
    publish(paths, PERIODS, "caribbean-1716", PERIOD_V1)
    publish(paths, CHARACTERS, "you", CHARACTER_V1)
    publish(paths, CHARACTERS, "you", CHARACTER_V2)
    draw(EPISODE, "s001")
    draw(EPISODE, "s002")
    result = planned.post(UPDATE_URL).json()
    assert [c["shot_id"] for c in result["changes"]] == POWDER_MONKEY_SHOTS
    shots = project(paths)["shots"]
    reason = (
        "Облик you@powder-monkey-11: characters/you/v001#powder-monkey-11 →"
        " characters/you/v002#powder-monkey-11"
    )
    assert [k for k, v in shots.items() if v["status"] == "stale"] == ["s002"]
    assert shots["s002"]["stale_reasons"] == [reason]
    assert all(
        (shots[k]["status"], shots[k]["stale_reasons"]) == ("todo", [reason])
        for k in POWDER_MONKEY_SHOTS
        if k != "s002"
    )
    # У s001 облика нет — картинка в силе.
    assert (shots["s001"]["status"], shots["s001"]["stale_reasons"]) == ("done", [])


def test_nothing_to_update_keeps_version(planned: TestClient, paths: StudioPaths) -> None:
    publish(paths, PERIODS, "caribbean-1716", PERIOD_V1)
    before = project(paths)
    response = planned.post(UPDATE_URL)
    assert response.status_code == 200
    assert response.json() == {
        "version": "v001",
        "created": False,
        "added": 0,
        "changed": 0,
        "removed": 0,
        "changes": [],
    }
    assert project(paths) == before


def test_update_without_plan_is_409(seeded: TestClient) -> None:
    response = seeded.post(UPDATE_URL)
    assert response.status_code == 409
    assert response.json()["detail"].startswith("Плана ещё нет — переводить нечего")


# --- нужно каналу ---------------------------------------------------------------------------------


@pytest.fixture
def two_plans(planned: TestClient) -> TestClient:
    """Второй выпуск: кадр s001 — в Англии 1347, в кадре s002 вместо юнги — капитан."""
    created = planned.post(
        "/api/episodes", json={"id": OTHER, "channel": "cursus", "title": "Navy"}
    )
    assert created.status_code == 201, created.text
    other = plan(OTHER)
    other["shots"][0]["image"]["period"] = "england-1347"
    other["shots"][1]["image"]["appearances"] = ["you@captain-35"]
    del other["canon_ref"]["appearances"]  # дополнит импорт по правилу
    response = planned.post(f"/api/projects/{OTHER}/director", json=other)
    assert response.status_code == 200, response.text
    return planned


def test_needed_over_two_episodes(two_plans: TestClient, paths: StudioPaths) -> None:
    needed = two_plans.get(NEEDED_URL).json()
    assert needed["channel"] == "cursus"
    assert needed["periods"] == [
        {
            "id": "caribbean-1716",
            "draft": False,
            "shots": 19,
            "episodes": [
                {"id": EPISODE, "title": "Pirate", "shots": 10},
                {"id": OTHER, "title": "Navy", "shots": 9},
            ],
        },
        {
            "id": "england-1347",
            "draft": False,
            "shots": 1,
            "episodes": [{"id": OTHER, "title": "Navy", "shots": 1}],
        },
    ]
    assert [(a["id"], a["shots"], a["character_exists"]) for a in needed["appearances"]] == [
        ("you@captain-35", 1, False),
        ("you@powder-monkey-11", 13, False),
    ]

    publish(paths, PERIODS, "caribbean-1716", PERIOD_V1)
    canon_store.save_draft(paths, "cursus", PERIODS, "england-1347", Period(id="england-1347"))
    publish(paths, CHARACTERS, "you", CHARACTER_V1)
    after = two_plans.get(NEEDED_URL).json()
    assert [(p["id"], p["draft"]) for p in after["periods"]] == [("england-1347", True)]
    assert after["appearances"] == []


def test_summary_counts_episodes_of_each_period(two_plans: TestClient, paths: StudioPaths) -> None:
    """Экран 12: сколько выпусков ссылаются на эпоху текущими планами (`canon_ref` или кадры)."""
    publish(paths, PERIODS, "caribbean-1716", PERIOD_V1)
    canon_store.save_draft(paths, "cursus", PERIODS, "england-1347", Period(id="england-1347"))
    canon_store.save_draft(paths, "cursus", PERIODS, "venice-1570", Period(id="venice-1570"))
    summary = two_plans.get("/api/canon/cursus").json()
    assert [(p["id"], p["episodes"]) for p in summary["periods"]] == [
        ("caribbean-1716", 2),
        ("england-1347", 1),
        ("venice-1570", 0),
    ]
    assert two_plans.get("/api/canon/otto").json()["periods"] == []


def test_needed_unknown_channel_is_404(seeded: TestClient) -> None:
    assert seeded.get("/api/canon/nope/needed").status_code == 404


def test_period_skeleton(two_plans: TestClient, paths: StudioPaths) -> None:
    url = f"{NEEDED_URL}/periods/england-1347"
    created = two_plans.post(url)
    assert created.status_code == 201, created.text
    body = created.json()
    assert (body["draft"], body["version"], body["based_on"]) == (True, None, None)
    assert body["data"] == Period(id="england-1347").model_dump(mode="json", by_alias=True)
    assert two_plans.get(NEEDED_URL).json()["periods"][1]["draft"] is True

    again = two_plans.post(url)
    assert again.status_code == 409
    assert again.json()["detail"] == (
        "У эпохи england-1347 уже есть черновик — откройте его на экране «Канон» и опубликуйте."
    )
    publish(paths, PERIODS, "caribbean-1716", PERIOD_V1)
    published = two_plans.post(f"{NEEDED_URL}/periods/caribbean-1716")
    assert published.status_code == 409
    assert published.json()["detail"] == (
        "Эпоха caribbean-1716 уже опубликована (v001) — создавать её не нужно."
    )
    assert two_plans.post(f"{NEEDED_URL}/periods/England_1347").status_code == 422


def test_appearance_skeleton_creates_character_then_appends(two_plans: TestClient) -> None:
    first = two_plans.post(f"{NEEDED_URL}/appearances/you@captain-35")
    assert first.status_code == 201, first.text
    assert first.json()["data"]["id"] == "you"
    assert [a["id"] for a in first.json()["data"]["appearances"]] == ["you@captain-35"]
    assert two_plans.get(NEEDED_URL).json()["appearances"][0]["character_exists"] is True

    second = two_plans.post(f"{NEEDED_URL}/appearances/you@powder-monkey-11")
    assert second.status_code == 201
    assert [a["id"] for a in second.json()["data"]["appearances"]] == [
        "you@captain-35",
        "you@powder-monkey-11",
    ]
    again = two_plans.post(f"{NEEDED_URL}/appearances/you@captain-35")
    assert again.status_code == 409
    assert again.json()["detail"] == (
        "Облик you@captain-35 уже есть в черновике персонажа you — откройте его на экране"
        " «Канон» и опубликуйте."
    )
    bad = two_plans.post(f"{NEEDED_URL}/appearances/captain-35")
    assert bad.status_code == 422
    assert "нужен вид <персонаж>@<облик>" in bad.json()["detail"][0]["msg"]


def test_appearance_skeleton_starts_draft_from_latest_version(
    seeded: TestClient, paths: StudioPaths
) -> None:
    publish(paths, CHARACTERS, "you", CHARACTER_V1)
    created = seeded.post(f"{NEEDED_URL}/appearances/you@cook-40")
    assert created.status_code == 201, created.text
    body = created.json()
    assert (body["draft"], body["based_on"]) == (True, "v001")
    assert [a["id"] for a in body["data"]["appearances"]] == [
        *(a.id for a in CHARACTER_V1.appearances),
        "you@cook-40",
    ]
    published = seeded.post(f"{NEEDED_URL}/appearances/you@captain-35")
    assert published.status_code == 409
    assert published.json()["detail"] == (
        "Облик you@captain-35 уже опубликован в characters/you/v001 — создавать его не нужно."
    )


def test_canon_from_plan_is_channel_level(seeded: TestClient, paths: StudioPaths) -> None:
    """Канон одного канала другому не виден: план Cursus не попадает в «нужно» Otto."""
    seeded.post(f"/api/projects/{EPISODE}/director", json=plan())
    otto = seeded.get("/api/canon/otto/needed").json()
    assert (otto["periods"], otto["appearances"]) == ([], [])
