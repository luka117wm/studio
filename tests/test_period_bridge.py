"""M5.6: эпоха через мост — промпт черновика и «Дополнить запреты» (эталоны), приём ответа в
черновик, ручные поля не затираются, запреты без повторов, стоп-лист и кириллица — отказ с полем,
журнал обменов, ни строки расхода. Публикует человек."""

import copy
import json
import os
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.settings import REPO_ROOT, Settings
from app.storage.db import connect
from app.storage.paths import StudioPaths
from app.tools.seed import seed

FIXTURES = REPO_ROOT / "tests" / "fixtures"
GOLDEN = FIXTURES / "prompts"
# `STUDIO_UPDATE_GOLDEN=1 uv run pytest tests/test_period_bridge.py` перезаписывает эталоны.
UPDATE_GOLDEN = os.environ.get("STUDIO_UPDATE_GOLDEN") == "1"
EPISODE = "c09-galley"
PERIOD = "venice-1570"
BASE = "/api/canon/cursus"
PERIOD_URL = f"{BASE}/periods/{PERIOD}"
STYLE = json.loads((FIXTURES / "canon" / "style_cursus.json").read_text(encoding="utf-8"))

DRAFT_ANSWER: dict[str, Any] = {
    "label": "Венеция, 1570",
    "region": "Republic of Venice: the lagoon, the Arsenal and the Adriatic galley routes",
    "years": {"from": 1565, "to": 1575},
    "palette_shift": ["oxidised copper green", "brick red", "lagoon grey-green water"],
    "materials": [
        "larch and oak planking",
        "hemp cordage",
        "pitch",
        "wrought iron",
        "Murano glass",
    ],
    "light_sources": ["Mediterranean sun", "oil lamps", "tallow candles", "torches"],
    "architecture": ["war galleys with lateen sails", "the Arsenal shipyards", "stone quays"],
    "clothing": ["linen shirts", "wool hose", "doublets", "red caps of the oarsmen", "cloaks"],
    "props": ["oars", "chains and shackles", "wooden buckets", "arquebuses", "ship's biscuit"],
    "forbidden": [
        "steam engines",
        "screw propellers",
        "flintlock pistols",
        "tricorn hats",
        "zippers",
        "rubber boots",
        "wristwatches",
        "electric light",
        "plastic",
        "printed T-shirts",
    ],
}


def answer_text(data: dict[str, Any]) -> str:
    """Ответ чата как он приходит: проза вокруг одного блока ```json."""
    block = json.dumps(data, indent=2, ensure_ascii=False)
    return f"Here is the period sheet.\n\n```json\n{block}\n```\n\nLet me know if you need more."


def galley_plan() -> dict[str, Any]:
    """План фикстуры, перенесённый в Венецию 1570: эпоха и заявка — для контекста промпта."""
    plan: dict[str, Any] = json.loads(
        (FIXTURES / "director_pirate_10shots.json").read_text(encoding="utf-8")
    )
    plan = copy.deepcopy(plan)
    plan["meta"]["episode_id"] = EPISODE
    plan["meta"]["working_title"] = "Every Rank on a Venetian Galley"
    plan["brief"]["idea"] = (
        "Climb every rank of a Venetian war galley of 1570, from oarsman to captain."
    )
    plan["brief"]["angle"] = "Second person: you start chained to an oar and end at the stern."
    plan["canon_ref"]["periods"] = {PERIOD: f"periods/{PERIOD}/v001"}
    for shot in plan["shots"]:
        shot["image"]["period"] = PERIOD
    return plan


@pytest.fixture
def paths(settings: Settings) -> StudioPaths:
    return StudioPaths(settings.studio_data_dir)


@pytest.fixture
def galley(client: TestClient, paths: StudioPaths) -> Iterator[TestClient]:
    """Каналы, опубликованный стиль канала и выпуск, чей план ссылается на venice-1570."""
    conn = connect(paths.db_path)
    try:
        seed(paths, conn)
    finally:
        conn.close()
    assert client.put(f"{BASE}/style/draft", json=STYLE).status_code == 200
    assert client.post(f"{BASE}/style/publish").status_code == 201
    created = client.post(
        "/api/episodes", json={"id": EPISODE, "channel": "cursus", "title": "Галера"}
    )
    assert created.status_code == 201, created.text
    assert client.post(f"/api/projects/{EPISODE}/director", json=galley_plan()).status_code == 200
    yield client


def check_golden(name: str, prompt: dict[str, Any]) -> None:
    """Эталон: строка `prompt: <id>, version: <n>`, пустая строка, текст промпта (как у идей)."""
    path = GOLDEN / name
    header = f"prompt: {prompt['prompt_id']}, version: {prompt['version']}"
    if UPDATE_GOLDEN:
        path.write_text(f"{header}\n\n{prompt['text']}", encoding="utf-8")
    golden_header, _, golden_text = path.read_text(encoding="utf-8").partition("\n\n")
    if prompt["text"] != golden_text and golden_header == header:
        pytest.fail(
            f"Текст {prompt['prompt_id']} изменился, а version осталась {prompt['version']}:"
            " поднимите version в backend/app/prompts/canon_period.md и обновите эталоны"
            " (STUDIO_UPDATE_GOLDEN=1 uv run pytest tests/test_period_bridge.py)."
        )
    assert golden_header == header, f"Эталон {name} от другой версии — обновите его."
    assert prompt["text"] == golden_text, f"Эталон {name} устарел — обновите его."


def runs(client: TestClient) -> list[dict[str, Any]]:
    response = client.get("/api/bridge/runs?task=canon_period")
    assert response.status_code == 200, response.text
    items: list[dict[str, Any]] = response.json()
    return items


def answer(client: TestClient, data: dict[str, Any], mode: str = "draft", status: int = 200) -> Any:
    response = client.post(f"{PERIOD_URL}/answer?mode={mode}", json={"text": answer_text(data)})
    assert response.status_code == status, response.text
    return response.json()


def cost_rows(paths: StudioPaths) -> int:
    conn = connect(paths.db_path)
    try:
        count: int = conn.execute("SELECT COUNT(*) FROM cost_ledger").fetchone()[0]
        return count
    finally:
        conn.close()


# --- промпты -------------------------------------------------------------------------------------


def test_draft_prompt_matches_golden_and_opens_a_run(galley: TestClient) -> None:
    response = galley.post(f"{PERIOD_URL}/prompt?mode=draft")
    assert response.status_code == 200, response.text
    prompt = response.json()
    assert (prompt["prompt_id"], prompt["mode"], prompt["period_id"]) == (
        "canon_period",
        "draft",
        PERIOD,
    )
    check_golden("canon_period_draft.txt", prompt)
    text = prompt["text"]
    assert "Climb every rank of a Venetian war galley" in text and '"title": "Галера"' in text
    assert "Your mode is `draft`" in text and '"shots": 10' in text
    assert STYLE["render"] not in text  # стиля канала в промпте эпохи нет (принцип 13)
    [run] = runs(galley)
    assert (run["status"], run["target_id"], run["episode_id"], run["id"]) == (
        "prompted",
        PERIOD,
        None,
        prompt["run_id"],
    )


def test_forbidden_prompt_needs_a_period_then_matches_golden(galley: TestClient) -> None:
    refused = galley.post(f"{PERIOD_URL}/prompt?mode=forbidden")
    assert refused.status_code == 409
    assert refused.json()["detail"].startswith(f"У эпохи {PERIOD} нет ни черновика, ни версий")
    answer(galley, DRAFT_ANSWER)
    prompt = galley.post(f"{PERIOD_URL}/prompt?mode=forbidden").json()
    check_golden("canon_period_forbidden.txt", prompt)
    assert "Your mode is `forbidden`" in prompt["text"] and '"screw propellers"' in prompt["text"]


def test_bad_mode_is_422_in_russian(galley: TestClient) -> None:
    response = galley.post(f"{PERIOD_URL}/prompt?mode=style")
    assert response.status_code == 422
    assert response.json()["detail"][0]["msg"] == (
        "Режима «style» нет: ожидалось draft (черновик) или forbidden (дополнить запреты)."
    )


# --- черновик ------------------------------------------------------------------------------------


def test_answer_with_prose_fills_the_draft_but_does_not_publish(
    galley: TestClient, paths: StudioPaths
) -> None:
    prompt = galley.post(f"{PERIOD_URL}/prompt").json()
    result = answer(galley, DRAFT_ANSWER)
    assert result["run_id"] == prompt["run_id"]
    assert result["filled"] == [
        "label",
        "region",
        "years",
        "palette_shift",
        "materials",
        "light_sources",
        "architecture",
        "clothing",
        "props",
        "forbidden",
    ]
    assert result["conflicts"] == [] and result["added"] == []
    assert result["message"] == "Черновик эпохи: заполнено 10 полей. Публикует человек."
    doc = result["doc"]
    assert (doc["draft"], doc["version"], doc["based_on"]) == (True, None, None)
    assert {k: doc["data"][k] for k in DRAFT_ANSWER} == DRAFT_ANSWER
    assert galley.get(f"{BASE}").json()["periods"][0]["versions"] == []  # публикует человек
    [run] = runs(galley)
    assert (run["status"], run["errors"]) == ("applied", [])
    assert cost_rows(paths) == 0
    # Стиль и облики мост не пишет: в каноне только стиль, опубликованный тестом, и эпоха.
    canon = paths.canon_dir("cursus")
    assert sorted(p.name for p in (canon / "style").iterdir()) == ["v001.json"]
    assert not (canon / "characters").exists()

    published = galley.post(f"{PERIOD_URL}/publish")
    assert published.status_code == 201 and published.json()["version"] == "v001"


def test_fields_filled_by_a_person_are_kept_and_listed(galley: TestClient) -> None:
    mine = {"id": PERIOD, "label": "Венеция", "region": "Venice and its lagoon", "materials": []}
    assert galley.put(f"{PERIOD_URL}/draft", json=mine).status_code == 200
    result = answer(galley, DRAFT_ANSWER)
    data = result["doc"]["data"]
    assert (data["label"], data["region"]) == ("Венеция", "Venice and its lagoon")
    assert data["materials"] == DRAFT_ANSWER["materials"]  # пустой список — заполнен
    assert result["conflicts"] == [
        {"field": "label", "current": "Венеция", "proposed": "Венеция, 1570"},
        {"field": "region", "current": "Venice and its lagoon", "proposed": DRAFT_ANSWER["region"]},
    ]
    assert "label" not in result["filled"] and "materials" in result["filled"]
    assert result["message"] == (
        "Черновик эпохи: заполнено 8 полей, чат предложил иначе для 2 — сравните на экране «Канон»."
        " Публикует человек."
    )


# --- запреты -------------------------------------------------------------------------------------


def test_forbidden_are_added_without_repeats(galley: TestClient) -> None:
    answer(galley, DRAFT_ANSWER)
    galley.post(f"{PERIOD_URL}/prompt?mode=forbidden")
    more = {
        "forbidden": [
            "Zippers",  # уже есть, другой регистр
            "the plastic.",  # уже есть, с артиклем и точкой
            "a pocket watch on a chain",
            "eyeglasses with metal frames",
            "pocket watch on a chain",  # повтор внутри ответа
        ]
    }
    result = answer(galley, more, mode="forbidden")
    assert result["added"] == ["a pocket watch on a chain", "eyeglasses with metal frames"]
    assert result["repeats"] == ["Zippers", "the plastic.", "pocket watch on a chain"]
    assert result["message"] == "Добавлено 2, повторов 3."
    assert result["doc"]["data"]["forbidden"] == [*DRAFT_ANSWER["forbidden"], *result["added"]]
    assert [r["status"] for r in runs(galley)] == ["applied", "applied"]


def test_forbidden_mode_takes_only_forbidden(galley: TestClient) -> None:
    answer(galley, DRAFT_ANSWER)
    error = answer(galley, {"forbidden": ["galleons"], "label": "x"}, mode="forbidden", status=422)
    assert error["errors"] == [
        {
            "path": "label",
            "message": "label: лишнее поле — в режиме «Дополнить запреты» его не присылают",
        }
    ]


# --- отказы --------------------------------------------------------------------------------------


def test_style_tokens_and_russian_are_refused_with_the_field(
    galley: TestClient, paths: StudioPaths
) -> None:
    galley.post(f"{PERIOD_URL}/prompt")
    bad = {
        **DRAFT_ANSWER,
        "region": "Венецианская республика",
        "light_sources": ["oil lamps", "golden hour sun"],
        "materials": ["oak", "oil painting on canvas", ""],
    }
    error = answer(galley, bad, status=422)
    assert error["message"] == "Эпоха из ответа не прошла проверку: 4 ошибки."
    assert [e["path"] for e in error["errors"]] == [
        "region",
        "materials[1]",
        "materials[2]",
        "light_sources[1]",
    ]
    assert error["errors"][1]["message"] == (
        "materials[1]: стилевой токен «oil painting» (medium) — эпоха описывает факты времени и"
        " места, а как выглядит картинка, задаёт стиль канала"
    )
    assert error["errors"][0]["message"].startswith("region: написано по-русски")
    assert not (paths.canon_period_dir("cursus", PERIOD) / "draft.json").exists()
    [run] = runs(galley)
    assert run["status"] == "failed" and len(run["errors"]) == 4


def test_draft_needs_ten_forbidden_and_the_exact_shape(galley: TestClient) -> None:
    few = answer(galley, {**DRAFT_ANSWER, "forbidden": ["steam engines"]}, status=422)
    assert few["errors"] == [
        {
            "path": "forbidden",
            "message": "forbidden: запретов 1, а нужно не меньше 10 — попросите чат дописать"
            " анахронизмы",
        }
    ]
    shape = {k: v for k, v in DRAFT_ANSWER.items() if k != "years"} | {"style": "painterly"}
    error = answer(galley, shape, status=422)
    assert [(e["path"], e["message"]) for e in error["errors"]] == [
        ("years", "years: нет поля"),
        ("style", "style: лишнее поле — в режиме черновик эпохи его не присылают"),
    ]
    assert "```json" in error["hint"]


def test_answer_without_open_run_is_recorded(galley: TestClient) -> None:
    answer(galley, DRAFT_ANSWER)
    [run] = runs(galley)
    assert (run["status"], run["created_at"]) == ("applied", run["answered_at"])


def test_period_bridge_imports_no_paid_modules() -> None:
    source = REPO_ROOT / "backend" / "app" / "pipeline" / "canon" / "period_bridge.py"
    text = source.read_text(encoding="utf-8")
    for forbidden in ("anthropic", "app.cost", "app.providers.gateway"):
        assert forbidden not in text, f"{source.name} imports {forbidden}"
