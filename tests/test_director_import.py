"""M2.4: версии плана на диске, части, мёрдж по shot.id, stale и блокировки, отчёт расхождений."""

import copy
import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.models.director import Director
from app.models.project import Asset, Project, ShotState, merge_patch
from app.models.validators import DirectorValidationError
from app.pipeline.director_import import (
    PartsError,
    assemble_parts,
    canonical_hash,
    diff_canon,
    diff_shots,
    merge_into_project,
)
from app.pipeline.director_import.stale import decide, lock_conflicts, text_change
from app.settings import Settings
from app.storage.db import connect
from app.storage.paths import StudioPaths
from app.tools.seed import seed

FIXTURES = Path(__file__).parent / "fixtures"
EPISODE = "c07-pirate-ship"
URL = f"/api/projects/{EPISODE}/director"
# Фикстура `draw` из conftest.py: версия картинки кадра, первая — выбранная.
DrawShot = Callable[..., Asset]


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
    """Каналы засеяны, выпуск из фикстуры создан, план ещё не импортирован."""
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


def project_on_disk(paths: StudioPaths) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(
        paths.project_path("cursus", EPISODE).read_text(encoding="utf-8")
    )
    return data


def statuses(project: dict[str, Any]) -> dict[str, str]:
    return {shot_id: state["status"] for shot_id, state in project["shots"].items()}


# --- версии --------------------------------------------------------------------------------------


def test_first_import_writes_v001_and_all_shots_are_todo(
    episode: TestClient, paths: StudioPaths, v1: dict[str, Any]
) -> None:
    response = episode.post(URL, json=v1)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["version"] == "v001" and result["created"] is True
    assert (result["added"], result["changed"], result["removed"]) == (10, 0, 0)
    assert [c["kind"] for c in result["changes"]] == ["added"] * 10
    assert result["changes"][0] == {
        "shot_id": "s001",
        "section": "r1",
        "kind": "added",
        "change": "Новый кадр",
        "fields": [],
        "stale": False,
        "drawn_at": None,
        "price": None,
    }

    version_path = paths.director_version_path("cursus", EPISODE, 1)
    assert version_path.is_file()
    assert json.loads(version_path.read_text(encoding="utf-8")) == v1
    project = project_on_disk(paths)
    assert project["director_version"] == "v001"
    assert statuses(project) == {f"s{n:03d}": "todo" for n in range(1, 11)}
    assert all(state["stale_reasons"] == [] for state in project["shots"].values())
    info = project["director_versions"]["v001"]
    assert info["hash"].startswith("sha256:") and info["parts"] == 1 and info["shots"] == 10
    assert (info["added"], info["changed"], info["removed"]) == (10, 0, 0)
    assert episode.get("/api/projects/" + EPISODE).json() == project


def test_reimport_of_same_plan_creates_no_version(
    episode: TestClient, paths: StudioPaths, v1: dict[str, Any]
) -> None:
    assert episode.post(URL, json=v1).status_code == 200
    before = project_on_disk(paths)
    # Другой порядок ключей и пробелы — тот же план.
    shuffled = json.loads(json.dumps(v1, sort_keys=True))
    shuffled["shots"][0]["motion"] = dict(reversed(list(shuffled["shots"][0]["motion"].items())))

    again = episode.post(URL, json=shuffled)
    assert again.status_code == 200, again.text
    assert again.json() == {
        "version": "v001",
        "created": False,
        "added": 0,
        "changed": 0,
        "removed": 0,
        "changes": [],
    }
    assert sorted(p.name for p in paths.director_dir("cursus", EPISODE).iterdir()) == ["v001.json"]
    assert project_on_disk(paths) == before


def test_second_version_merges_stale_added_removed(
    episode: TestClient,
    paths: StudioPaths,
    v1: dict[str, Any],
    v2: dict[str, Any],
    draw: DrawShot,
) -> None:
    assert episode.post(URL, json=v1).status_code == 200
    draw(EPISODE, "s002")  # картинка есть только у s002
    response = episode.post(URL, json=v2)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["version"] == "v002" and result["created"] is True
    assert (result["added"], result["changed"], result["removed"]) == (1, 3, 1)
    by_id = {c["shot_id"]: c for c in result["changes"]}
    assert list(by_id) == ["s002", "s008", "s009", "s011", "s006"]
    assert by_id["s002"]["stale"] is True and by_id["s002"]["fields"] == ["image.prompt"]
    assert by_id["s002"]["change"] == (
        "Промпт: добавлено „his small silhouette framed by the low doorway“"
    )
    # Облики сменились, но картинки нет — устаревать нечему (M6.1).
    assert by_id["s008"]["stale"] is False and by_id["s008"]["fields"] == ["image.appearances"]
    assert by_id["s008"]["change"] == "Облики: добавлен gun-captain@caribbean-1716"
    # VO без блокировки — в отчёте, но кадр не stale.
    assert by_id["s009"]["stale"] is False and by_id["s009"]["fields"] == ["vo"]
    assert by_id["s009"]["change"] == "VO: добавлено „Sunday.“; убрано „Thursday.“"
    assert by_id["s011"] == {
        "shot_id": "s011",
        "section": "r2",
        "kind": "added",
        "change": "Новый кадр",
        "fields": [],
        "stale": False,
        "drawn_at": None,
        "price": None,
    }
    assert by_id["s006"]["kind"] == "removed" and by_id["s006"]["section"] == "r1"

    project = project_on_disk(paths)
    assert project["director_version"] == "v002"
    expected = {f"s{n:03d}": "todo" for n in range(1, 12)}
    expected.update({"s002": "stale", "s006": "removed"})
    assert statuses(project) == expected
    assert project["shots"]["s002"]["stale_reasons"] == [by_id["s002"]["change"]]
    # У кадра без картинки причина — история изменения, а не статус.
    assert project["shots"]["s008"]["stale_reasons"] == [by_id["s008"]["change"]]
    assert project["shots"]["s009"]["stale_reasons"] == []
    assert project["shots"]["s006"]["stale_reasons"] == ["Кадр убран из плана v002"]

    assert sorted(p.name for p in paths.director_dir("cursus", EPISODE).iterdir()) == [
        "v001.json",
        "v002.json",
    ]
    assert json.loads(paths.director_version_path("cursus", EPISODE, 1).read_text()) == v1
    assert json.loads(paths.director_version_path("cursus", EPISODE, 2).read_text()) == v2
    assert list(project["director_versions"]) == ["v001", "v002"]
    info = project["director_versions"]["v002"]
    assert (info["added"], info["changed"], info["removed"], info["shots"]) == (1, 3, 1, 10)


def test_locked_fields_survive_and_flag_stale(
    episode: TestClient,
    paths: StudioPaths,
    v1: dict[str, Any],
    v2: dict[str, Any],
    draw: DrawShot,
) -> None:
    assert episode.post(URL, json=v1).status_code == 200
    override = {"image": {"prompt": "my own prompt"}}
    patch = episode.patch(
        "/api/projects/" + EPISODE,
        json={
            "shots": {
                "s009": {"duration_locked": True},
                "s002": {"prompt_locked": True, "user_override": override},
                "s003": {"user_override": {"motion": {"strength": 0.2}}},
            }
        },
    )
    assert patch.status_code == 200, patch.text
    draw(EPISODE, "s002")
    draw(EPISODE, "s009")

    result = episode.post(URL, json=v2).json()
    by_id = {c["shot_id"]: c for c in result["changes"]}
    project = project_on_disk(paths)

    # VO изменился при заблокированной длительности — конфликт, кадр stale.
    assert by_id["s009"]["stale"] is True
    assert project["shots"]["s009"] == {
        "status": "stale",
        "image_version": 1,
        "duration_locked": True,
        "prompt_locked": False,
        "user_override": None,
        "stale_reasons": ["План изменил текст VO (длительность), но длительность заблокирована"],
    }
    # Промпт изменился при заблокированном промпте и ручной правке — обе причины, правка цела.
    assert project["shots"]["s002"]["prompt_locked"] is True
    assert project["shots"]["s002"]["user_override"] == override
    assert project["shots"]["s002"]["status"] == "stale"
    assert project["shots"]["s002"]["stale_reasons"] == [
        "Промпт: добавлено „his small silhouette framed by the low doorway“",
        "План изменил промпт, но промпт заблокирован — действует ручная правка",
        "План изменил image.prompt, но действует ручная правка image.prompt",
    ]
    # Ручная правка поля, которое план не менял, — не конфликт и не stale.
    assert project["shots"]["s003"]["status"] == "todo"
    assert project["shots"]["s003"]["user_override"] == {"motion": {"strength": 0.2}}
    assert "s003" not in by_id


def test_canon_version_bump_marks_only_affected_shots(
    episode: TestClient, paths: StudioPaths, v1: dict[str, Any], draw: DrawShot
) -> None:
    assert episode.post(URL, json=v1).status_code == 200
    draw(EPISODE, "s002")
    assets = project_on_disk(paths)["assets"]

    bumped = copy.deepcopy(v1)
    bumped["canon_ref"]["appearances"]["you@powder-monkey-11"] = (
        "characters/you/v005#powder-monkey-11"
    )
    result = episode.post(URL, json=bumped).json()
    assert result["version"] == "v002"
    with_boy = [s["id"] for s in v1["shots"] if s["image"]["appearances"]]
    assert [c["shot_id"] for c in result["changes"]] == with_boy
    assert all(c["fields"] == [] for c in result["changes"])
    assert [c["shot_id"] for c in result["changes"] if c["stale"]] == ["s002"]

    project = project_on_disk(paths)
    reason = (
        "Облик you@powder-monkey-11: characters/you/v004#powder-monkey-11 → "
        "characters/you/v005#powder-monkey-11"
    )
    for shot_id, state in project["shots"].items():
        if shot_id == "s002":
            assert (state["status"], state["stale_reasons"]) == ("stale", [reason])
        elif shot_id in with_boy:
            # Картинки нет: статус прежний, причина — в истории кадра.
            assert (state["status"], state["stale_reasons"]) == ("todo", [reason])
        else:
            assert (state["status"], state["stale_reasons"]) == ("todo", [])
    # Картинка на месте (принцип 14).
    assert project["assets"] == assets


def test_shot_without_image_keeps_status_and_collects_history(
    episode: TestClient, paths: StudioPaths, v1: dict[str, Any], v2: dict[str, Any]
) -> None:
    """Хвост M5.2: кадр без картинки не становится `stale` — ни от изменения промпта, ни от
    конфликта с блокировкой. Причины копятся историей без повторов."""
    assert episode.post(URL, json=v1).status_code == 200
    patch = episode.patch(
        "/api/projects/" + EPISODE, json={"shots": {"s009": {"duration_locked": True}}}
    )
    assert patch.status_code == 200, patch.text
    lock = "План изменил текст VO (длительность), но длительность заблокирована"

    result = episode.post(URL, json=v2).json()
    by_id = {c["shot_id"]: c for c in result["changes"]}
    assert not any(c["stale"] for c in result["changes"])
    shots = project_on_disk(paths)["shots"]
    assert (shots["s009"]["status"], shots["s009"]["stale_reasons"]) == ("todo", [lock])
    assert shots["s002"]["stale_reasons"] == [by_id["s002"]["change"]]

    # Назад к v1: VO снова другой — та же причина не дублируется; промпт — новая причина.
    back = episode.post(URL, json=v1).json()
    back_s002 = next(c for c in back["changes"] if c["shot_id"] == "s002")
    shots = project_on_disk(paths)["shots"]
    assert (shots["s009"]["status"], shots["s009"]["stale_reasons"]) == ("todo", [lock])
    assert shots["s002"]["status"] == "todo"
    assert shots["s002"]["stale_reasons"] == [by_id["s002"]["change"], back_s002["change"]]


def test_removed_shot_keeps_assets_and_returns_as_todo_or_stale(
    episode: TestClient,
    paths: StudioPaths,
    v1: dict[str, Any],
    v2: dict[str, Any],
    draw: DrawShot,
) -> None:
    assert episode.post(URL, json=v1).status_code == 200
    draw(EPISODE, "s006")
    assert episode.post(URL, json=v2).status_code == 200
    project = project_on_disk(paths)
    assert project["shots"]["s006"]["status"] == "removed"
    assert project["assets"]["img-s006-v1"]["path"] == "media/s006/v001.png"

    # Возврат к v1: тот же хэш → файл не пишется, версия переиспользуется. У s006 картинка
    # есть, но с чем её сравнить, мёрдж не знает — `stale`, пусть человек сверит.
    back = episode.post(URL, json=v1).json()
    assert back["version"] == "v001" and back["created"] is False
    assert (back["added"], back["changed"], back["removed"]) == (1, 3, 1)
    returned = next(c for c in back["changes"] if c["shot_id"] == "s006")
    assert (returned["kind"], returned["change"], returned["stale"]) == (
        "added",
        "Кадр вернулся в план",
        True,
    )
    project = project_on_disk(paths)
    assert project["director_version"] == "v001"
    assert project["shots"]["s006"]["status"] == "stale"
    assert project["shots"]["s006"]["stale_reasons"] == [
        "Кадр снова в плане v001: картинка — от прежнего кадра, сверьте её"
    ]
    assert project["shots"]["s011"]["status"] == "removed"

    # Кадр без картинки возвращается в `todo`.
    assert episode.post(URL, json=v2).status_code == 200
    state = project_on_disk(paths)["shots"]["s011"]
    assert (state["status"], state["stale_reasons"]) == ("todo", [])
    assert sorted(p.name for p in paths.director_dir("cursus", EPISODE).iterdir()) == [
        "v001.json",
        "v002.json",
    ]


# --- части ---------------------------------------------------------------------------------------


def test_parts_assemble_to_same_project_as_whole(
    episode: TestClient, paths: StudioPaths, v1: dict[str, Any], v2: dict[str, Any]
) -> None:
    assert episode.post(URL, json=v1).status_code == 200
    part1, part2 = load("director_pirate_part1.json"), load("director_pirate_part2.json")

    first = episode.post(URL, json=part1)
    assert first.status_code == 409, first.text
    assert first.json()["detail"]["received"] == [1]
    assert first.json()["detail"]["missing"] == [2]
    assert paths.director_part_path("cursus", EPISODE, 1).is_file()
    assert project_on_disk(paths)["director_version"] == "v001"

    second = episode.post(URL, json=part2)
    assert second.status_code == 200, second.text
    from_parts = second.json()
    assert from_parts["version"] == "v002" and from_parts["created"] is True
    assert not list(paths.director_parts_dir("cursus", EPISODE).iterdir())
    # На диске — цельный план, байт в байт равный v2 целиком.
    assert json.loads(paths.director_version_path("cursus", EPISODE, 2).read_text()) == v2
    project_parts = project_on_disk(paths)

    # Тот же путь целиком — в другом выпуске — даёт структурно тот же результат.
    whole = _fresh_episode(episode, paths, "whole")
    assert whole.post(_url("whole"), json=_renamed(v1, "whole")).status_code == 200
    from_whole = whole.post(_url("whole"), json=_renamed(v2, "whole")).json()
    assert from_whole == from_parts
    project_whole = json.loads(paths.project_path("cursus", "whole").read_text())
    assert _comparable(project_parts) == _comparable(project_whole)
    # Хэш собранного плана — хэш v2 целиком (episode_id «whole» в другом выпуске его меняет).
    assert project_parts["director_versions"]["v002"]["hash"] == canonical_hash(
        Director.model_validate(v2)
    )
    assert project_parts["director_versions"]["v002"]["parts"] == 2
    assert project_whole["director_versions"]["v002"]["parts"] == 1


def test_parts_that_disagree_are_409(episode: TestClient, paths: StudioPaths) -> None:
    part1, part2 = load("director_pirate_part1.json"), load("director_pirate_part2.json")
    # Часть 2 без части 1.
    orphan = episode.post(URL, json=part2)
    assert orphan.status_code == 409
    assert orphan.json()["detail"]["missing"] == [1]
    assert not paths.director_parts_dir("cursus", EPISODE).exists()

    assert episode.post(URL, json=part1).status_code == 409
    wrong_total = copy.deepcopy(part2)
    wrong_total["meta"]["parts_total"] = 3
    mismatch = episode.post(URL, json=wrong_total)
    assert mismatch.status_code == 409
    assert "parts_total = 3" in mismatch.json()["detail"]["message"]
    # Часть 2 с кадром, дублирующим часть 1, — ошибка сборки, части остаются для повторной отправки.
    duplicate = copy.deepcopy(part2)
    duplicate["shots"][0]["id"] = "s001"
    clash = episode.post(URL, json=duplicate)
    assert clash.status_code == 422
    assert any("кадр s001: id повторяется" in e for e in clash.json()["detail"]["errors"])
    assert sorted(p.name for p in paths.director_parts_dir("cursus", EPISODE).iterdir()) == [
        "part-01.json",
        "part-02.json",
    ]
    # Исправленная часть 2 одна — план собирается.
    assert episode.post(URL, json=part2).status_code == 200
    assert project_on_disk(paths)["director_version"] == "v001"


def test_assemble_parts_rules(v2: dict[str, Any]) -> None:
    part1 = Director.model_validate(load("director_pirate_part1.json"))
    part2 = Director.model_validate(load("director_pirate_part2.json"))
    whole = Director.model_validate(v2)
    assembled = assemble_parts([part2, part1])
    assert assembled == whole
    assert canonical_hash(assembled) == canonical_hash(whole)
    assert assembled.canon_ref == part1.canon_ref and assembled.voice == part1.voice

    with pytest.raises(PartsError, match=r"не хватает \[2\]"):
        assemble_parts([part1])
    conflicting = part2.model_copy(deep=True)
    conflicting.sections[0].title = "Other"
    with pytest.raises(PartsError, match="раздел r2: в части 2 отличается"):
        assemble_parts([part1, conflicting])
    # Часть 2 ссылается на облик, которого нет в canon_ref части 1, — ловится на сборке.
    ghost = json.loads(part2.model_dump_json(by_alias=True))
    ghost["shots"][0]["image"]["appearances"] = ["you@captain-35"]
    with pytest.raises(DirectorValidationError, match="облик «you@captain-35» нет"):
        assemble_parts([part1, Director.model_validate(ghost)])


# --- ошибки --------------------------------------------------------------------------------------


def test_invalid_plan_is_422_with_error_list(
    episode: TestClient, paths: StudioPaths, v1: dict[str, Any]
) -> None:
    broken = copy.deepcopy(v1)
    broken["shots"][1]["vo"] = ""
    broken["shots"][2]["motion"]["strength"] = 0.4
    response = episode.post(URL, json=broken)
    assert response.status_code == 422
    # Структурные ошибки — первыми; доменные (пустой vo) — когда структура цела (M2.2).
    assert response.json()["detail"]["errors"] == [
        "кадр s003: motion.strength = 0.4 вне диапазона, ожидалось ≤ 0.25"
    ]
    broken["shots"][2]["motion"]["strength"] = 0.1
    response = episode.post(URL, json=broken)
    assert response.status_code == 422
    assert response.json()["detail"]["errors"] == [
        "кадр s002: пустой vo, ожидалось текст закадрового голоса"
    ]
    assert not list(paths.director_dir("cursus", EPISODE).glob("*.json"))
    assert project_on_disk(paths)["director_version"] is None

    foreign = copy.deepcopy(v1)
    foreign["meta"]["episode_id"] = "other-episode"
    response = episode.post(URL, json=foreign)
    assert response.status_code == 422
    assert "план для другого выпуска" in response.json()["detail"]["errors"][0]
    assert episode.post("/api/projects/nope/director", json=v1).status_code == 404


def test_version_endpoints(episode: TestClient, v1: dict[str, Any], v2: dict[str, Any]) -> None:
    assert episode.get(URL + "/versions").json() == []
    assert episode.get(URL + "/v001").status_code == 404
    episode.post(URL, json=v1)
    episode.post(URL, json=v2)

    versions = episode.get(URL + "/versions").json()
    assert [v["version"] for v in versions] == ["v001", "v002"]
    assert versions[1]["added"] == 1 and versions[1]["removed"] == 1
    assert episode.get(URL + "/v001").json() == v1
    assert episode.get(URL + "/v002").json() == v2
    assert episode.get(URL + "/v999").status_code == 404
    assert episode.get(URL + "/latest").status_code == 404
    assert episode.get("/api/projects/nope/director/versions").status_code == 404


# --- чистые функции ------------------------------------------------------------------------------


def test_diff_shots_reasons(v1: dict[str, Any]) -> None:
    old = Director.model_validate(v1).shots[2]
    new = old.model_copy(deep=True)
    assert diff_shots(old, new) == []

    new.section = "r2"
    new.image.period = "england-1347"
    new.image.shot_size = "detail"
    new.motion.type, new.motion.strength = "pan_left", 0.12
    new.transition_in.type, new.transition_in.duration = "crossfade", 0.4
    new.animate.recommended = False
    new.sfx = []
    changes = diff_shots(old, new)
    assert [c.field for c in changes] == [
        "image.period",
        "image.shot_size",
        "section",
        "motion",
        "transition_in",
        "animate",
        "sfx",
    ]
    assert [c.reason for c in changes] == [
        "Эпоха: caribbean-1716 → england-1347",
        "Крупность: action → detail",
        "Раздел: r1 → r2",
        "Движение: pan_right 0.1 in_out_sine → pan_left 0.12 in_out_sine",
        "Переход: cut → crossfade 0.4 с",
        "Анимация: рекомендована, 5 с → не рекомендована",
        "SFX: изменены (было 1, стало 0)",
    ]


def test_text_and_list_reasons() -> None:
    assert text_change("Промпт", "a boy runs", "a boy runs with a lantern") == (
        "Промпт: добавлено „with a lantern“"
    )
    assert text_change("VO", "one two three", "one three") == "VO: убрано „two“"
    assert text_change("VO", "a b c", "a x c") == "VO: добавлено „x“; убрано „b“"
    assert text_change("VO", "a  b", "a b") == "VO: изменены пробелы"
    assert text_change("Промпт", "a b c d e f", "1 b 2 d 3 f") == "Промпт переписан"
    long = "x" * 80
    assert text_change("VO", "", long) == f"VO: добавлено „{'x' * 59}…“"

    old = Director.model_validate(load("director_pirate_10shots.json")).canon_ref
    assert old is not None
    new = old.model_copy(deep=True)
    new.style = "style/v004"
    new.periods["caribbean-1716"] = "periods/caribbean-1716/v003"
    new.appearances["you@captain-35"] = "characters/you/v004#captain-35"  # новый ключ — не смена
    canon = diff_canon(old, new)
    assert canon.style == "Стиль канала: style/v003 → style/v004"
    assert canon.periods == {
        "caribbean-1716": "Эпоха caribbean-1716: periods/caribbean-1716/v002 → "
        "periods/caribbean-1716/v003"
    }
    assert canon.appearances == {}
    assert not diff_canon(None, new) and not diff_canon(old, old)


def test_decide_and_lock_conflicts(v1: dict[str, Any]) -> None:
    director = Director.model_validate(v1)
    old, new = director.shots[1], director.shots[1].model_copy(deep=True)
    new.vo += " Really."
    new.motion.strength = 0.1
    changes = diff_shots(old, new)
    assert [c.field for c in changes] == ["vo", "motion"]

    assert decide(changes, [], ShotState()) == (False, [])
    assert decide(changes, [], ShotState(duration_locked=True)) == (
        True,
        ["План изменил текст VO (длительность), но длительность заблокирована"],
    )
    override = ShotState(user_override={"motion": {"strength": 0.05}, "sfx": []})
    assert lock_conflicts(changes, override) == [
        "План изменил motion, но действует ручная правка motion.strength"
    ]
    canon = ["Стиль канала: style/v003 → style/v004"]
    assert decide([], canon, ShotState()) == (True, canon)


def test_merge_is_pure_and_idempotent(v1: dict[str, Any], v2: dict[str, Any]) -> None:
    first, second = Director.model_validate(v1), Director.model_validate(v2)
    project = Project.model_validate(
        {
            "schema": "studio.project/1",
            "episode_id": EPISODE,
            "channel": "cursus",
            "updated_at": "t0",
        }
    )
    after_v1, _ = merge_into_project(project, None, first, "v001", parts=1, created=True, now="t1")
    assert project.shots == {} and project.director_version is None
    after_v2, report = merge_into_project(
        after_v1, first, second, "v002", parts=1, created=True, now="t2"
    )
    assert after_v1.shots["s002"].status == "todo"
    # Картинки нет — изменение промпта уходит в историю, статус прежний.
    assert after_v2.shots["s002"].status == "todo"
    assert after_v2.shots["s002"].stale_reasons == [report.changes[0].change]
    assert report.changes[0].stale is False
    assert after_v2.updated_at == "t2"
    # Тот же план поверх себя — ничего не меняется, кроме времени.
    again, empty = merge_into_project(
        after_v2, second, second, "v002", parts=1, created=False, now="t3"
    )
    assert empty.changes == [] and again.shots == after_v2.shots
    assert again.director_versions["v002"].imported_at == "t2"
    assert report.changes[0].shot_id == "s002"

    asset = {"id": "img-s002-v1", "shot_id": "s002", "kind": "image", "version": 1}
    drawn = Project.model_validate(
        merge_patch(
            after_v1.model_dump(mode="json"),
            {
                "assets": {"img-s002-v1": {**asset, "path": "media/s002/v001.png", "hash": "h"}},
                "shots": {"s002": {"status": "done", "image_version": 1}},
            },
        )
    )
    stale_v2, stale_report = merge_into_project(
        drawn, first, second, "v002", parts=1, created=True, now="t2"
    )
    assert stale_v2.shots["s002"].status == "stale" and stale_report.changes[0].stale is True


# --- вспомогательное -----------------------------------------------------------------------------


def _url(episode_id: str) -> str:
    return f"/api/projects/{episode_id}/director"


def _fresh_episode(client: TestClient, paths: StudioPaths, episode_id: str) -> TestClient:
    created = client.post(
        "/api/episodes", json={"id": episode_id, "channel": "cursus", "title": episode_id}
    )
    assert created.status_code == 201, created.text
    return client


def _renamed(plan: dict[str, Any], episode_id: str) -> dict[str, Any]:
    renamed = copy.deepcopy(plan)
    renamed["meta"]["episode_id"] = episode_id
    return renamed


def _comparable(project: dict[str, Any]) -> dict[str, Any]:
    """project.json без того, что законно различается: время, id выпуска, число частей, хэш."""
    stripped = copy.deepcopy(project)
    stripped.pop("updated_at")
    stripped.pop("episode_id")
    for info in stripped["director_versions"].values():
        info.pop("imported_at")
        info.pop("parts")
        info.pop("hash")
    return stripped
