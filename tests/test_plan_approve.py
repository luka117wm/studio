"""M4.6: «Утвердить план» — проверки, стадия `generate`, повтор, возврат в `script` новой версии."""

import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.models.canon import Character, Period, Style
from app.models.project import Asset, merge_patch
from app.pipeline.canon import episode_canon
from app.pipeline.canon.episode_canon import AnchorSheet
from app.pipeline.script import approve
from app.pipeline.script.approve import ApprovalProblem, ApprovalSubject, refusal
from app.settings import Settings
from app.storage import canon_store
from app.storage.atomic import read_json, write_json_atomic
from app.storage.canon_store import CHARACTERS, PERIODS, STYLE
from app.storage.db import connect
from app.storage.paths import StudioPaths
from app.tools.seed import seed

FIXTURES = Path(__file__).parent / "fixtures"
CANON = FIXTURES / "canon"
EPISODE = "c07-pirate-ship"
EPISODE_URL = f"/api/episodes/{EPISODE}"
APPROVE_URL = f"{EPISODE_URL}/approve"
DIRECTOR_URL = f"/api/projects/{EPISODE}/director"
PLAN_URL = f"/api/projects/{EPISODE}/plan"
FIX_HINT = " — допишите на листе сценария или в таблице плана и утвердите снова."
DrawShot = Callable[..., Asset]  # фикстура `draw` из conftest.py


def load(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return data


@pytest.fixture
def paths(settings: Settings) -> StudioPaths:
    return StudioPaths(settings.studio_data_dir)


@pytest.fixture
def episode(client: TestClient, paths: StudioPaths) -> Iterator[TestClient]:
    """Каналы засеяны, выпуск создан (стадия `script`), плана ещё нет."""
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
def planned(episode: TestClient, no_canon_gate: None) -> TestClient:
    """План импортирован; канон к нему не опубликован — проверка канона выключена."""
    assert episode.post(DIRECTOR_URL, json=load("director_pirate_10shots.json")).status_code == 200
    return episode


def on_disk(paths: StudioPaths) -> dict[str, Any]:
    data: dict[str, Any] = read_json(paths.project_path("cursus", EPISODE))
    return data


def write_project(paths: StudioPaths, patch: dict[str, Any]) -> None:
    """Мимо PATCH: пустой VO он не пропустит, а project.json может прийти и таким."""
    path = paths.project_path("cursus", EPISODE)
    write_json_atomic(path, merge_patch(read_json(path), patch))


def stage(client: TestClient) -> str:
    value: str = client.get(EPISODE_URL).json()["stage"]
    return value


def set_stage(paths: StudioPaths, value: str) -> None:
    conn = connect(paths.db_path)
    try:
        with conn:
            conn.execute("UPDATE episodes SET stage = ? WHERE id = ?", (value, EPISODE))
    finally:
        conn.close()


def refused(response: Any) -> dict[str, Any]:
    assert response.status_code == 409, response.text
    detail: dict[str, Any] = response.json()["detail"]
    assert detail["code"] == "plan_not_ready"
    return detail


def counts(paths: StudioPaths) -> tuple[int, int]:
    """Строк журнала расходов и джобов: утверждение не трогает ни то, ни другое (M6)."""
    conn = connect(paths.db_path)
    try:
        ledger = conn.execute("SELECT COUNT(*) FROM cost_ledger").fetchone()[0]
        jobs = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
    finally:
        conn.close()
    return ledger, jobs


# --- отказ ----------------------------------------------------------------------------------------


def test_no_plan_is_refused(episode: TestClient, paths: StudioPaths) -> None:
    detail = refused(episode.post(APPROVE_URL))
    message = "Плана ещё нет — скопируйте промпт части 1 и вставьте ответ чата."
    assert detail == {
        "code": "plan_not_ready",
        "message": message,
        "problems": [{"check": "plan", "shot_id": None, "message": message}],
    }
    assert stage(episode) == "script"
    assert "approved_version" not in on_disk(paths)


def test_incomplete_parts_are_refused(episode: TestClient) -> None:
    pending = episode.post(DIRECTOR_URL, json=load("director_pirate_part1.json"))
    assert pending.status_code == 409  # часть легла в набор, набор неполон
    detail = refused(episode.post(APPROVE_URL))
    assert detail["message"] == (
        "План ещё не собран: не хватает части 2 из 2 — вставьте ответы чата и утвердите снова."
    )


def test_shot_without_vo_after_edit_is_refused(planned: TestClient, paths: StudioPaths) -> None:
    # Через PATCH пустой VO не проходит — проверка утверждения страхует то, что в файле.
    patched = planned.patch(
        f"/api/projects/{EPISODE}", json={"shots": {"s003": {"user_override": {"vo": " "}}}}
    )
    assert patched.status_code == 422
    write_project(
        paths,
        {
            "shots": {
                "s003": {"user_override": {"vo": ""}},
                "s007": {"user_override": {"vo": "  "}},
                "s005": {"user_override": {"image": {"prompt": ""}}},
            }
        },
    )
    detail = refused(planned.post(APPROVE_URL))
    assert detail["message"] == "2 кадра без VO: s003, s007; 1 кадр без промпта: s005" + FIX_HINT
    assert [(p["check"], p["shot_id"]) for p in detail["problems"]] == [
        ("vo", "s003"),
        ("prompt", "s005"),
        ("vo", "s007"),
    ]
    assert detail["problems"][0]["message"] == (
        "кадр s003: пустой VO — допишите текст закадрового голоса"
    )
    assert stage(planned) == "script"
    assert "approved_version" not in on_disk(paths)


def test_removed_shots_are_not_checked(planned: TestClient, paths: StudioPaths) -> None:
    assert planned.post(DIRECTOR_URL, json=load("director_pirate_v2.json")).status_code == 200
    assert on_disk(paths)["shots"]["s006"]["status"] == "removed"
    write_project(paths, {"shots": {"s006": {"user_override": {"vo": ""}}}})
    assert planned.post(APPROVE_URL).status_code == 200


def test_late_stage_is_refused(planned: TestClient, paths: StudioPaths) -> None:
    set_stage(paths, "edit")
    detail = refused(planned.post(APPROVE_URL))
    assert detail["problems"] == [
        {
            "check": "stage",
            "shot_id": None,
            "message": "Выпуск уже на стадии «Монтаж» — план утверждается до начала генерации.",
        }
    ]


def test_checks_list_is_the_extension_point(
    planned: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """M4.10 добавит в `CHECKS` сходство с референсом — новая проверка сразу в отказе."""

    def similarity(subject: ApprovalSubject) -> list[ApprovalProblem]:
        assert subject.plan is not None and subject.plan.version == "v001"
        return [ApprovalProblem(check="plan", shot_id=None, message="Сходство 14 % выше 10 %.")]

    monkeypatch.setattr(approve, "CHECKS", [*approve.CHECKS, similarity])
    assert refused(planned.post(APPROVE_URL))["message"] == "Сходство 14 % выше 10 %."


def test_refusal_lists_first_shots_then_count() -> None:
    problems = [
        ApprovalProblem(check="vo", shot_id=f"s{n:03d}", message=f"кадр s{n:03d}: пустой VO")
        for n in range(1, 11)
    ]
    assert refusal(problems).message == (
        "10 кадров без VO: s001, s002, s003, s004, s005, s006, s007, s008 и ещё 2" + FIX_HINT
    )


# --- успех ----------------------------------------------------------------------------------------


def test_full_plan_is_approved(planned: TestClient, paths: StudioPaths) -> None:
    response = planned.post(APPROVE_URL)
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["id"], body["stage"]) == (EPISODE, "generate")
    assert body["summary"]["shots_total"] == 10

    project = on_disk(paths)
    assert project["approved_version"] == "v001"
    assert project["approved_at"] == project["updated_at"]
    plan = planned.get(PLAN_URL).json()
    assert (plan["version"], plan["approved_version"]) == ("v001", "v001")
    assert counts(paths) == (0, 0)


def test_repeat_changes_nothing(planned: TestClient, paths: StudioPaths) -> None:
    first = planned.post(APPROVE_URL)
    assert first.status_code == 200
    path = paths.project_path("cursus", EPISODE)
    before = (path.read_bytes(), path.stat().st_mtime_ns)

    second = planned.post(APPROVE_URL)
    assert second.status_code == 200
    assert (path.read_bytes(), path.stat().st_mtime_ns) == before
    assert second.json()["updated_at"] == first.json()["updated_at"]


def test_approved_fields_are_not_patchable(planned: TestClient) -> None:
    response = planned.patch(f"/api/projects/{EPISODE}", json={"approved_version": "v001"})
    assert response.status_code == 422
    assert [error["msg"] for error in response.json()["detail"]] == [
        "Поле approved_version меняется пайплайном, не через PATCH — уберите его из запроса."
    ]


# --- новая версия после утверждения ---------------------------------------------------------------


def test_new_version_returns_stage_to_script(planned: TestClient, paths: StudioPaths) -> None:
    assert planned.post(APPROVE_URL).status_code == 200
    assert planned.post(DIRECTOR_URL, json=load("director_pirate_v2.json")).status_code == 200

    assert stage(planned) == "script"
    assert on_disk(paths)["approved_version"] == "v001"  # история
    plan = planned.get(PLAN_URL).json()
    assert (plan["version"], plan["approved_version"]) == ("v002", "v001")

    again = planned.post(APPROVE_URL)
    assert again.status_code == 200
    assert again.json()["stage"] == "generate"
    assert on_disk(paths)["approved_version"] == "v002"


def test_same_plan_again_keeps_generate(planned: TestClient) -> None:
    assert planned.post(APPROVE_URL).status_code == 200
    again = planned.post(DIRECTOR_URL, json=load("director_pirate_10shots.json"))
    assert again.status_code == 200
    assert again.json()["created"] is False
    assert stage(planned) == "generate"


def test_edit_after_approval_keeps_approval_and_stales_drawn_shot(
    planned: TestClient, paths: StudioPaths, draw: DrawShot
) -> None:
    """Устав M6, решение 9: правка кадра на листе — не новая версия плана. Кадр с картинкой —
    `stale` с причиной, без картинки — просто правка; утверждение и стадия на месте, статус выпуска
    пересчитан (`stale` — что проверить руками)."""
    assert planned.post(APPROVE_URL).status_code == 200
    draw(EPISODE, "s001")
    edits = {
        "s001": {"user_override": {"image": {"prompt": "drops the cartridge case on the deck"}}},
        "s002": {"user_override": {"image": {"prompt": "counts the powder kegs by lantern"}}},
        "s003": {"user_override": {"vo": "A calmer line for the third shot."}},
    }
    response = planned.patch(f"/api/projects/{EPISODE}", json={"shots": edits})
    assert response.status_code == 200, response.text

    project = on_disk(paths)
    assert project["approved_version"] == project["director_version"] == "v001"
    shots = project["shots"]
    assert (shots["s001"]["status"], shots["s001"]["stale_reasons"]) == (
        "stale",
        ["Промпт изменён вручную"],
    )
    assert (shots["s002"]["status"], shots["s002"]["stale_reasons"]) == ("todo", [])
    assert (shots["s003"]["status"], shots["s003"]["stale_reasons"]) == ("todo", [])
    episode = planned.get(EPISODE_URL).json()
    assert (episode["stage"], episode["status"]) == ("generate", "warning")
    plan = planned.get(PLAN_URL).json()
    assert (plan["version"], plan["approved_version"]) == ("v001", "v001")
    # Утверждать снова нечего: повтор ничего не пишет.
    assert planned.post(APPROVE_URL).status_code == 200
    assert on_disk(paths)["updated_at"] == project["updated_at"]


def test_new_version_at_late_stage_keeps_stage(planned: TestClient, paths: StudioPaths) -> None:
    """После начала генерации стадию решает M6: импорт её не трогает."""
    set_stage(paths, "edit")
    assert planned.post(DIRECTOR_URL, json=load("director_pirate_v2.json")).status_code == 200
    assert stage(planned) == "edit"


def test_similarity_check_needs_plan_and_reference() -> None:
    """Принцип 11: без плана сравнивать нечего — отказ даёт только `plan_assembled`; без референса
    проверки нет (сам отказ по сходству — `tests/test_reference.py`)."""
    reference = approve.ReferenceText(
        text="you are seventeen and the navy hands you an oar", ngram=5, threshold=0.1
    )
    no_plan = ApprovalSubject(stage="script", plan=None, reference=reference)
    assert [p.check for p in approve.approval_problems(no_plan)] == ["plan"]
    assert approve.not_like_reference(ApprovalSubject(stage="script", plan=None)) == []


# --- канон (M5.2) ---------------------------------------------------------------------------------

V001_REFS = {
    "style": "style/v001",
    "periods": {"caribbean-1716": "periods/caribbean-1716/v001"},
    "appearances": {"you@powder-monkey-11": "characters/you/v001#powder-monkey-11"},
}


@pytest.fixture
def planned_v001(episode: TestClient) -> TestClient:
    """План прибит к заготовкам `v001`, как план из моста до канона; проверка канона включена."""
    plan = load("director_pirate_10shots.json") | {"canon_ref": V001_REFS}
    assert episode.post(DIRECTOR_URL, json=plan).status_code == 200
    return episode


def publish_canon(paths: StudioPaths) -> None:
    """Стиль, эпоха caribbean-1716 и персонаж you — по v001 из фикстур канона."""
    for layer, entity_id, model, name in (
        (STYLE, None, Style, "style_cursus.json"),
        (PERIODS, "caribbean-1716", Period, "period_caribbean_1716.json"),
        (CHARACTERS, "you", Character, "character_you.json"),
    ):
        data = model.model_validate_json((CANON / name).read_text(encoding="utf-8"))
        canon_store.save_draft(paths, "cursus", layer, entity_id, data)
        canon_store.publish(paths, "cursus", layer, entity_id)


def test_unpublished_canon_is_refused_with_ids(
    planned_v001: TestClient, paths: StudioPaths
) -> None:
    detail = refused(planned_v001.post(APPROVE_URL))
    assert detail["message"] == (
        "Канон не готов: стиль канала не опубликован, 1 эпоха не опубликована, 1 облик не"
        " опубликован — экран «Канон»."
    )
    assert [(p["check"], p["shot_id"], p["canon"]) for p in detail["problems"]] == [
        ("canon", None, {"kind": "style", "id": "style", "issue": "unpublished"}),
        ("canon", None, {"kind": "period", "id": "caribbean-1716", "issue": "unpublished"}),
        (
            "canon",
            None,
            {"kind": "appearance", "id": "you@powder-monkey-11", "issue": "unpublished"},
        ),
    ]
    assert detail["problems"][1]["message"] == (
        "эпоха caribbean-1716 не опубликована — создайте и опубликуйте её на экране «Канон»"
    )
    assert stage(planned_v001) == "script"
    assert "approved_version" not in on_disk(paths)


def test_published_canon_without_sheet_is_refused_then_approved(
    planned_v001: TestClient, paths: StudioPaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    publish_canon(paths)
    detail = refused(planned_v001.post(APPROVE_URL))
    assert detail["message"] == "Канон не готов: у 1 облика нет листа — экран «Канон»."
    assert detail["problems"] == [
        {
            "check": "canon",
            "shot_id": None,
            "message": "облик you@powder-monkey-11: нет листа опорных портретов — соберите его"
            " на экране «Канон»",
            "canon": {"kind": "appearance", "id": "you@powder-monkey-11", "issue": "no_sheet"},
        }
    ]

    # Листы — M5.4; до него статус листа — заглушка.
    sheets: list[tuple[str, str]] = []

    def ready(paths_: StudioPaths, channel: str, appearance_id: str, version: str) -> AnchorSheet:
        sheets.append((appearance_id, version))
        return AnchorSheet(status="ready", chosen=6)

    monkeypatch.setattr(episode_canon, "sheet_state", ready)
    response = planned_v001.post(APPROVE_URL)
    assert response.status_code == 200, response.text
    assert response.json()["stage"] == "generate"
    assert sheets == [("you@powder-monkey-11", "v001")]


def test_canon_summary_counts_by_issue() -> None:
    targets = [
        episode_canon.CanonTarget(kind="period", id=p, issue="unpublished")
        for p in ("venice-1570", "england-1347")
    ] + [
        episode_canon.CanonTarget(kind="appearance", id="you@captain-35", issue="unresolved"),
        episode_canon.CanonTarget(kind="appearance", id="you@comito-34", issue="sheet_incomplete"),
        episode_canon.CanonTarget(kind="appearance", id="you@cook-40", issue="sheet_outdated"),
    ]
    assert approve.canon_summary(targets) == (
        "Канон не готов: 2 эпохи не опубликованы, 1 ссылка не находит версию, у 1 облика лист не"
        " собран, у 1 облика лист устарел — экран «Канон» и «Перевести на новые версии»."
    )
    unresolved = [episode_canon.CanonTarget(kind="style", id="style", issue="unresolved")] * 5
    assert approve.canon_summary(unresolved) == (
        "Канон не готов: 5 ссылок не находят версию — «Перевести на новые версии»."
    )
