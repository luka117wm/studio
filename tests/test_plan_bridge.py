"""M4.2: план через мост — части, `canon_ref` и `voice` из кода, импорт `source: bridge`, ошибки.

Конфиг теста: пресет Cursus — 10 кадров, `plan.shots_per_part: 4` → 3 части. Ответы чата собраны
из `director_pirate_10shots.json` и обёрнуты прозой; ответов настоящего чата в репозитории нет.
"""

import copy
import json
import os
import shutil
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import create_app
from app.models.canon import CanonEntity, Character, Period, Style
from app.models.channel import ChannelProfile
from app.models.formats import FormatPreset
from app.models.project import DirectorVersionInfo
from app.pipeline import script as script_pkg
from app.pipeline.bridge import RenderedPrompt
from app.pipeline.script.plan_bridge import issue_path, voice_for
from app.providers.base import Route
from app.settings import REPO_ROOT, Settings
from app.storage import canon_store
from app.storage.canon_store import CHARACTERS, PERIODS, STYLE, Layer
from app.storage.db import connect
from app.storage.paths import StudioPaths
from app.tools.seed import seed

FIXTURES = Path(__file__).parent / "fixtures"
GOLDEN = FIXTURES / "prompts"
# `STUDIO_UPDATE_GOLDEN=1 uv run pytest tests/test_plan_bridge.py` перезаписывает эталоны промптов.
UPDATE_GOLDEN = os.environ.get("STUDIO_UPDATE_GOLDEN") == "1"

EPISODE = "c01"
PROMPT = f"/api/projects/{EPISODE}/plan/prompt"
ANSWER = f"/api/projects/{EPISODE}/plan/answer"
PARTS = f"/api/projects/{EPISODE}/plan/parts"
SHOTS_PER_PART = 4

BRIEF = {
    "idea": "Every rank on a Caribbean pirate ship of 1716, from powder monkey to captain",
    "angle": "Second person: you are the boy, then the sailor, then the officer",
    "hook_promise": "Why the captain was the least powerful man aboard in peacetime",
    "notes": "",
    "sources": [{"title": "A General History of the Pyrates", "url": "https://example.org/ghp"}],
}
# Факт → кадр: факты ложатся в часть своего кадра.
FACT_SHOTS = ("s002", "s006", "s004")


@pytest.fixture
def config_dir(tmp_path: Path) -> Path:
    """Конфиг приложения, у пресета Cursus — 10 кадров на 3 части по 4."""
    config = tmp_path / "config"
    shutil.copytree(REPO_ROOT / "config", config)
    path = config / "formats.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    data["formats"]["every_rank"].update(
        minutes={"min": 18, "target": 20, "max": 25}, sections=2, shots=10, words_per_minute=150
    )
    data["plan"] = {"shots_per_part": SHOTS_PER_PART}
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    return config


@pytest.fixture
def app(tmp_path: Path, config_dir: Path) -> FastAPI:
    settings = Settings(_env_file=None, studio_data_dir=tmp_path / "data", config_dir=config_dir)
    return create_app(settings)


@pytest.fixture
def paths(app: FastAPI) -> StudioPaths:
    result: StudioPaths = app.state.paths
    return result


@pytest.fixture
def client(app: FastAPI, paths: StudioPaths) -> Iterator[TestClient]:
    """Каналы засеяны, выпуск c01 создан, заявка заполнена, плана нет."""
    with TestClient(app) as client:
        conn = connect(paths.db_path)
        try:
            seed(paths, conn)
        finally:
            conn.close()
        assert client.post("/api/episodes", json={"channel": "cursus"}).status_code == 201
        assert client.patch(f"/api/projects/{EPISODE}", json={"brief": BRIEF}).status_code == 200
        yield client


@pytest.fixture
def parts() -> list[dict[str, Any]]:
    return cut_parts(json.loads((FIXTURES / "director_pirate_10shots.json").read_text("utf-8")))


def cut_parts(plan: dict[str, Any]) -> list[dict[str, Any]]:
    """План целиком → ответы чата на части 1…N, как их просят шаблоны: без `canon_ref` и
    `voice`, в частях 2…N — без `brief`, `thumbnail`, `publish`. Раздел, который переходит в
    следующую часть, повторяется там без изменений; музыка — в части, где раздел начался."""
    shots = plan["shots"]
    chunks = [shots[i : i + SHOTS_PER_PART] for i in range(0, len(shots), SHOTS_PER_PART)]
    facts = [
        {**fact, "shot_id": shot} for fact, shot in zip(plan["facts"], FACT_SHOTS, strict=True)
    ]
    meta = {key: value for key, value in plan["meta"].items() if key not in ("part", "parts_total")}
    result: list[dict[str, Any]] = []
    started: set[str] = set()
    for number, chunk in enumerate(chunks, start=1):
        ids = [shot["id"] for shot in chunk]
        used = list(dict.fromkeys(shot["section"] for shot in chunk))
        part: dict[str, Any] = {
            "schema": plan["schema"],
            "meta": {**meta, "episode_id": EPISODE, "part": number, "parts_total": len(chunks)},
            "sections": [s for s in plan["sections"] if s["id"] in used],
            "shots": copy.deepcopy(chunk),
            "music": [
                m for m in plan["music"] if m["section"] in used and m["section"] not in started
            ],
            "facts": [f for f in facts if f["shot_id"] in ids],
        }
        if number == 1:
            part |= {key: plan[key] for key in ("brief", "thumbnail", "publish")}
        started.update(used)
        result.append(part)
    return result


def wrap(part: dict[str, Any]) -> str:
    """Ответ чата: проза вокруг одного блока ```json."""
    number = part["meta"]["part"]
    body = json.dumps(part, indent=2, ensure_ascii=False)
    return f"Here is part {number}.\n\n```json\n{body}\n```\n\nTell me when to continue."


def disk(paths: StudioPaths) -> dict[str, bytes]:
    """Файлы выпуска: project.json, версии плана, набор частей."""
    root = paths.episode_dir("cursus", EPISODE)
    return {
        str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()
    }


def plan_runs(client: TestClient) -> list[dict[str, Any]]:
    runs: list[dict[str, Any]] = client.get(
        "/api/bridge/runs", params={"episode_id": EPISODE, "task": "plan"}
    ).json()
    return runs


def voice_route(app: FastAPI) -> Route:
    route: Route = app.state.gateway.registry.resolve("voice")
    return route


# --- полный цикл ---------------------------------------------------------------------------------


def test_full_cycle_imports_v001_from_bridge(
    client: TestClient, app: FastAPI, paths: StudioPaths, parts: list[dict[str, Any]]
) -> None:
    # Чат всё же прислал canon_ref, а облик капитана впервые появляется в последней части.
    parts[0]["canon_ref"] = {"style": "style/v003", "periods": {}, "appearances": {}}
    parts[2]["shots"][-1]["image"]["appearances"] = ["you@captain-35"]

    first = client.post(PROMPT, params={"part": 1})
    assert first.status_code == 200, first.text
    prompt = first.json()
    assert (prompt["prompt_id"], prompt["version"]) == ("plan_first", 2)
    assert (prompt["part"], prompt["parts_total"]) == (1, 3)
    assert (prompt["first_shot"], prompt["last_shot"]) == ("s001", "s004")

    accepted = client.post(ANSWER, json={"text": wrap(parts[0])})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json() == {
        "run_id": prompt["run_id"],
        "part": 1,
        "parts_total": 3,
        "shots_in_part": 4,
        "received": [1],
        "next_part": 2,
        "import_result": None,
        "warnings": [
            "Чат прислал canon_ref — заменён: ссылки на канон подставляет приложение, не чат.",
            "Факт без источника (not_found): «Felt curtains were used at magazine doors"
            " specifically to catch sparks.»",
        ],
    }

    second = client.post(PROMPT, params={"part": 2}).json()
    assert (second["prompt_id"], second["first_shot"], second["last_shot"]) == (
        "plan_next",
        "s005",
        "s008",
    )
    assert '"shots_so_far": 4' in second["text"]
    assert '"id": "s004"' in second["text"]
    assert client.post(ANSWER, json={"text": wrap(parts[1])}).json()["next_part"] == 3

    third = client.post(PROMPT, params={"part": 3}).json()
    assert (third["first_shot"], third["last_shot"]) == ("s009", "s010")
    done = client.post(ANSWER, json={"text": wrap(parts[2])})
    assert done.status_code == 200, done.text
    result = done.json()
    assert (result["part"], result["received"], result["next_part"]) == (3, [1, 2, 3], None)
    imported = result["import_result"]
    assert (imported["version"], imported["created"], imported["added"]) == ("v001", True, 10)

    v001 = json.loads(paths.director_version_path("cursus", EPISODE, 1).read_text("utf-8"))
    assert v001["meta"]["part"] == v001["meta"]["parts_total"] == 1
    assert [s["id"] for s in v001["shots"]] == [f"s{n:03d}" for n in range(1, 11)]
    assert v001["canon_ref"] == {
        "style": "style/v001",
        "periods": {"caribbean-1716": "periods/caribbean-1716/v001"},
        "appearances": {
            "you@captain-35": "characters/you/v001#captain-35",
            "you@powder-monkey-11": "characters/you/v001#powder-monkey-11",
        },
    }
    route = voice_route(app)
    assert v001["voice"] == {
        "provider": route.provider,
        "voice_id": "unset",
        "model": route.model,
        "pace_wpm": 150,
    }
    assert [f["shot_id"] for f in v001["facts"]] == ["s002", "s004", "s006"]

    versions = client.get(f"/api/projects/{EPISODE}/director/versions").json()
    assert [(v["version"], v["source"], v["parts"]) for v in versions] == [("v001", "bridge", 3)]
    assert client.get(f"/api/episodes/{EPISODE}").json()["stage"] == "script"
    assert not any(paths.director_parts_dir("cursus", EPISODE).glob("*.json"))

    runs = plan_runs(client)
    assert [(r["part"], r["status"], r["prompt_id"]) for r in runs] == [
        (3, "applied", "plan_next"),
        (2, "applied", "plan_next"),
        (1, "applied", "plan_first"),
    ]
    conn = connect(paths.db_path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM cost_ledger").fetchone()[0] == 0
    finally:
        conn.close()


# --- canon_ref новой версии плана (M5.2) ---------------------------------------------------------


def send_all(client: TestClient, parts: list[dict[str, Any]]) -> dict[str, Any]:
    """Ответы чата на все части по порядку; итог импорта после последней."""
    for part in parts:
        response = client.post(ANSWER, json={"text": wrap(part)})
        assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()["import_result"]
    return result


def publish[E: CanonEntity](
    paths: StudioPaths, layer: Layer[E], entity_id: str | None, data: E
) -> None:
    canon_store.save_draft(paths, "cursus", layer, entity_id, data)
    canon_store.publish(paths, "cursus", layer, entity_id)


def canon_fixture[E: CanonEntity](model: type[E], name: str) -> E:
    return model.model_validate_json((FIXTURES / "canon" / name).read_text(encoding="utf-8"))


def test_new_version_keeps_pinned_canon_and_new_ids_get_latest(
    client: TestClient, paths: StudioPaths, parts: list[dict[str, Any]]
) -> None:
    """Устав M5, решение 3: прибитое в прошлой версии плана остаётся, хотя опубликовано новее;
    новый облик получает последнюю опубликованную версию; без версии — заготовку v001."""
    assert send_all(client, parts)["version"] == "v001"

    style = canon_fixture(Style, "style_cursus.json")
    period = canon_fixture(Period, "period_caribbean_1716.json")
    character = canon_fixture(Character, "character_you.json")
    publish(paths, STYLE, None, style)
    publish(paths, STYLE, None, style.model_copy(update={"grain": "heavy film grain"}))
    publish(paths, PERIODS, "caribbean-1716", period)
    later = [*period.forbidden, "aluminium buckets"]
    publish(paths, PERIODS, "caribbean-1716", period.model_copy(update={"forbidden": later}))
    publish(paths, CHARACTERS, "you", character)
    publish(paths, CHARACTERS, "you", character.model_copy(update={"label": "Ты, моряк"}))

    second = copy.deepcopy(parts)
    second[0]["shots"][0]["vo"] += " Again."
    second[1]["shots"][0]["image"]["appearances"] = ["you@quartermaster-28"]
    second[2]["shots"][0]["image"]["appearances"] = ["you@cook-40"]
    result = send_all(client, second)
    assert (result["version"], result["created"]) == ("v002", True)

    v002 = json.loads(paths.director_version_path("cursus", EPISODE, 2).read_text("utf-8"))
    assert v002["canon_ref"] == {
        "style": "style/v001",
        "periods": {"caribbean-1716": "periods/caribbean-1716/v001"},
        "appearances": {
            "you@cook-40": "characters/you/v001#cook-40",
            "you@powder-monkey-11": "characters/you/v001#powder-monkey-11",
            "you@quartermaster-28": "characters/you/v002#quartermaster-28",
        },
    }
    # Версии канона не менялись — кадры с прежними эпохой и обликом не устарели.
    shots = client.get(f"/api/projects/{EPISODE}").json()["shots"]
    assert shots["s002"]["status"] == "queued"


def test_first_plan_gets_latest_published_canon(
    client: TestClient, paths: StudioPaths, parts: list[dict[str, Any]]
) -> None:
    """Канон опубликован до первого плана: ссылки — на последние версии, прибивать нечего."""
    period = canon_fixture(Period, "period_caribbean_1716.json")
    publish(paths, PERIODS, "caribbean-1716", period)
    publish(paths, PERIODS, "caribbean-1716", period.model_copy(update={"region": "Caribbean"}))
    assert send_all(client, parts)["version"] == "v001"
    v001 = json.loads(paths.director_version_path("cursus", EPISODE, 1).read_text("utf-8"))
    assert v001["canon_ref"]["style"] == "style/v001"
    assert v001["canon_ref"]["periods"] == {"caribbean-1716": "periods/caribbean-1716/v002"}


def test_answer_without_prompt_is_journaled(
    client: TestClient, parts: list[dict[str, Any]]
) -> None:
    """Вставка без выданного промпта (из старого чата): строка журнала открывается и
    закрывается сразу, промпт — тот, что приложение выдало бы сейчас."""
    response = client.post(ANSWER, json={"text": wrap(parts[0])})
    assert response.status_code == 200, response.text
    [run] = plan_runs(client)
    assert (run["part"], run["parts_total"], run["status"]) == (1, 3, "applied")
    assert run["prompt_id"] == "plan_first"
    assert run["created_at"] == run["answered_at"]


def test_parts_state(client: TestClient, parts: list[dict[str, Any]]) -> None:
    assert client.get(PARTS).json() == {
        "parts_total": 3,
        "shots_per_part": SHOTS_PER_PART,
        "received": [],
        "next_part": 1,
        "last_run": None,
    }
    client.post(PROMPT, params={"part": 1})
    client.post(ANSWER, json={"text": wrap(parts[0])})
    state = client.get(PARTS).json()
    assert (state["received"], state["next_part"]) == ([1], 2)
    assert (state["last_run"]["part"], state["last_run"]["status"]) == (1, "applied")


def test_manual_import_is_source_manual_and_moves_stage(client: TestClient) -> None:
    plan = json.loads((FIXTURES / "director_pirate_10shots.json").read_text("utf-8"))
    plan["meta"]["episode_id"] = EPISODE
    response = client.post(f"/api/projects/{EPISODE}/director", json=plan)
    assert response.status_code == 200, response.text
    [version] = client.get(f"/api/projects/{EPISODE}/director/versions").json()
    assert version["source"] == "manual"
    assert client.get(f"/api/episodes/{EPISODE}").json()["stage"] == "script"


# --- ошибки --------------------------------------------------------------------------------------


def test_answer_for_another_episode(
    client: TestClient, paths: StudioPaths, parts: list[dict[str, Any]]
) -> None:
    client.post(PROMPT, params={"part": 1})
    parts[0]["meta"]["episode_id"] = "c07-pirate-ship"
    before = disk(paths)
    response = client.post(ANSWER, json={"text": wrap(parts[0])})
    assert response.status_code == 422
    assert response.json() == {
        "message": "Это план выпуска «c07-pirate-ship», а открыт выпуск «c01».",
        "hint": "Скопируйте промпт этого выпуска и вставьте ответ на него.",
        "errors": [],
    }
    assert disk(paths) == before
    [run] = plan_runs(client)
    assert run["status"] == "failed"
    assert run["errors"] == [{"path": "", "message": response.json()["message"]}]


def test_part_out_of_order(
    client: TestClient, paths: StudioPaths, parts: list[dict[str, Any]]
) -> None:
    client.post(PROMPT, params={"part": 1})
    client.post(ANSWER, json={"text": wrap(parts[0])})
    client.post(PROMPT, params={"part": 2})
    before = disk(paths)
    response = client.post(ANSWER, json={"text": wrap(parts[2])})
    assert response.status_code == 422
    assert response.json()["message"] == (
        "Это часть 3, ожидалась часть 2 — скопируйте промпт части 2."
    )
    assert disk(paths) == before
    assert plan_runs(client)[0]["status"] == "failed"


def test_truncated_answer(
    client: TestClient, paths: StudioPaths, parts: list[dict[str, Any]]
) -> None:
    client.post(PROMPT, params={"part": 1})
    text = wrap(parts[0])
    before = disk(paths)
    response = client.post(ANSWER, json={"text": text[: len(text) // 2]})
    assert response.status_code == 422
    body = response.json()
    assert body["message"].startswith("Ответ обрывается на строке ")
    assert body["message"].endswith(": JSON-объект не закрыт.")
    assert "continue" in body["hint"]
    assert disk(paths) == before


def test_style_token_in_image_prompt(
    client: TestClient, paths: StudioPaths, parts: list[dict[str, Any]]
) -> None:
    client.post(PROMPT, params={"part": 1})
    parts[0]["shots"][2]["image"]["prompt"] += ", cinematic lighting"
    before = disk(paths)
    response = client.post(ANSWER, json={"text": wrap(parts[0])})
    assert response.status_code == 422
    assert response.json() == {
        "message": "Часть 1 не прошла проверку: 1 ошибка.",
        "hint": "Скопируйте ошибки в чат и попросите прислать часть 1 исправленной, целиком"
        " одним блоком ```json.",
        "errors": [
            {
                "path": "s003",
                "message": "кадр s003: в image.prompt стилевой токен «cinematic lighting»"
                " (lighting), ожидалось только действие, композиция и ракурс — стиль задаёт канон",
            }
        ],
    }
    assert disk(paths) == before
    assert plan_runs(client)[0]["errors"] == response.json()["errors"]


def test_part_two_without_part_one(
    client: TestClient, paths: StudioPaths, parts: list[dict[str, Any]]
) -> None:
    refused = client.post(PROMPT, params={"part": 2})
    assert refused.status_code == 409
    assert refused.json()["detail"] == (
        "Сначала вставьте ответ на часть 1 — промпт части 2 продолжает её."
    )
    before = disk(paths)
    response = client.post(ANSWER, json={"text": wrap(parts[1])})
    assert response.status_code == 422
    assert response.json()["message"] == (
        "Это часть 2, ожидалась часть 1 — скопируйте промпт части 1."
    )
    assert disk(paths) == before


def test_appearance_id_out_of_format(
    client: TestClient, paths: StudioPaths, parts: list[dict[str, Any]]
) -> None:
    parts[0]["shots"][1]["image"]["appearances"] = ["Powder Monkey"]
    before = disk(paths)
    response = client.post(ANSWER, json={"text": wrap(parts[0])})
    assert response.status_code == 422
    assert response.json()["errors"] == [
        {
            "path": "s002",
            "message": "кадр s002: облик «Powder Monkey» не по формату, ожидалось"
            " <персонаж>@<облик>, например you@powder-monkey-11",
        }
    ]
    assert disk(paths) == before


def test_assembly_error_keeps_parts_and_accepts_fixed_part(
    client: TestClient, paths: StudioPaths, parts: list[dict[str, Any]]
) -> None:
    """Факт части 3 ссылается на кадр, которого нет во всём плане: это видно только при сборке.
    Части остаются, исправленная часть 3 присылается одна."""
    fixed = copy.deepcopy(parts[2])
    parts[2]["facts"] = [
        {"claim": "x", "status": "verified", "source_url": None, "shot_id": "s099"}
    ]
    for part in parts[:2]:
        client.post(ANSWER, json={"text": wrap(part)})
    response = client.post(ANSWER, json={"text": wrap(parts[2])})
    assert response.status_code == 422
    assert response.json() == {
        "message": "План не собрался из частей: 1 ошибка.",
        "hint": "Попросите чат исправить часть, о которой ошибка, и вставьте её — остальные части"
        " уже приняты.",
        "errors": [
            {
                "path": "facts[3]",
                "message": "facts[3]: кадр «s099» не найден, ожидалось id кадра этого плана",
            }
        ],
    }
    assert client.get(PARTS).json()["received"] == [1, 2, 3]

    done = client.post(ANSWER, json={"text": wrap(fixed)})
    assert done.status_code == 200, done.text
    assert done.json()["import_result"]["version"] == "v001"


def test_prompt_needs_brief(client: TestClient) -> None:
    assert client.patch(f"/api/projects/{EPISODE}", json={"brief": None}).status_code == 200
    response = client.post(PROMPT, params={"part": 1})
    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Сначала заполните заявку: без идеи чату не из чего писать план."
    )


def test_issue_path() -> None:
    assert issue_path("кадр s003: пустой vo, ожидалось …") == "s003"
    assert issue_path("раздел r1: id повторяется, ожидалось …") == "r1"
    assert issue_path("meta: part = 2 больше parts_total = 1") == "meta"
    assert issue_path("без префикса") == ""


# --- старые записи и голос -----------------------------------------------------------------------


def test_old_records_read_with_defaults(app: FastAPI) -> None:
    profile = ChannelProfile.model_validate(
        {
            "id": "cursus",
            "name": "Cursus",
            "format": "every_rank",
            "budgets": {"monthly_usd": 150, "per_episode_usd": 15, "animation_usd": 5},
            "voice_quota": {"limit_chars": 600_000},
        }
    )
    assert (profile.voice.voice_id, profile.voice.pace_wpm) == ("unset", None)
    preset: FormatPreset = app.state.formats.formats["every_rank"]
    voice = voice_for(profile, preset, voice_route(app))
    assert (voice.voice_id, voice.pace_wpm) == ("unset", preset.words_per_minute)

    info = DirectorVersionInfo.model_validate(
        {
            "version": "v001",
            "hash": "0" * 64,
            "imported_at": "2026-09-21T10:00:00Z",
            "parts": 1,
            "shots": 10,
            "added": 10,
            "changed": 0,
            "removed": 0,
        }
    )
    assert info.source == "manual"


def test_plan_bridge_has_no_paid_calls() -> None:
    """План через мост бесплатен: модули сценария не зовут gateway, Anthropic и учёт расходов.
    Смета плана (`estimate.py`, M4.6) берёт цены у `Gateway.estimate` — без вызова и журнала."""
    package = Path(script_pkg.__file__).parent
    for source in package.glob("*.py"):
        text = source.read_text(encoding="utf-8")
        forbidden = (
            ("anthropic", ".call(", "ledger")
            if source.name == "estimate.py"
            else ("anthropic", "app.cost", "app.providers.gateway")
        )
        for name in forbidden:
            assert name not in text, f"{source.name} uses {name}"


# --- эталоны промптов ----------------------------------------------------------------------------


def check_golden(name: str, prompt: RenderedPrompt) -> None:
    """Эталон: строка `prompt: <id>, version: <n>`, пустая строка, текст промпта.

    Текст изменился, а версия шаблона нет — тест просит поднять `version`: по версии в журнале
    обменов видно, каким текстом сделан ответ (`docs/bridge.md`)."""
    path = GOLDEN / name
    header = f"prompt: {prompt.prompt_id}, version: {prompt.version}"
    if UPDATE_GOLDEN:
        path.write_text(f"{header}\n\n{prompt.text}", encoding="utf-8")
    golden_header, _, golden_text = path.read_text(encoding="utf-8").partition("\n\n")
    if prompt.text != golden_text and golden_header == header:
        pytest.fail(
            f"Текст {prompt.prompt_id} изменился, а version осталась {prompt.version}: поднимите"
            f" version в backend/app/prompts/{prompt.prompt_id}.md и обновите эталон"
            " (STUDIO_UPDATE_GOLDEN=1 uv run pytest tests/test_plan_bridge.py)."
        )
    assert golden_header == header, f"Эталон {name} от другой версии — обновите его."
    assert prompt.text == golden_text, f"Эталон {name} устарел — обновите его."


def rendered(body: dict[str, Any]) -> RenderedPrompt:
    return RenderedPrompt(
        text=body["text"], prompt_id=body["prompt_id"], version=body["version"], sha256=""
    )


def test_prompts_match_golden(client: TestClient, parts: list[dict[str, Any]]) -> None:
    first = client.post(PROMPT, params={"part": 1}).json()
    check_golden("plan_first_c01.txt", rendered(first))
    client.post(ANSWER, json={"text": wrap(parts[0])})
    second = client.post(PROMPT, params={"part": 2}).json()
    check_golden("plan_next_c01_p2.txt", rendered(second))


def test_next_part_keeps_reference_structure(
    client: TestClient, parts: list[dict[str, Any]]
) -> None:
    """Часть 2 выпуска по референсу несёт ту же структуру, что часть 1: продолжит и новый чат."""
    srt = (FIXTURES / "reference_warship.srt").read_text(encoding="utf-8")
    ref = client.post("/api/references", json={"channel": "cursus", "subtitles": srt}).json()
    analysis = {
        "title": "Every Rank on a Roman Warship",
        "author": "Sample channel",
        "topic": "Pay and danger on an ancient galley",
        "segments": [
            {"kind": "hook", "label": "Cold open", "start": 0, "facts": 0},
            {"kind": "rank", "label": "Rank 1: rower", "start": 40, "facts": 2},
        ],
        "techniques": [{"text": "Pay compared at each step", "count": 2}],
    }
    answered = client.post(
        f"/api/references/{ref['id']}/answer", json={"text": json.dumps(analysis)}
    )
    assert answered.status_code == 200, answered.text
    brief = {"reference_id": ref["id"], "reference_mode": "structure_clone"}
    assert client.patch(f"/api/projects/{EPISODE}", json={"brief": brief}).status_code == 200
    assert client.post(ANSWER, json={"text": wrap(parts[0])}).status_code == 200

    text = client.post(PROMPT, params={"part": 2}).json()["text"]
    block = text.split("## Reference structure")[1].split("`null` means")[0]
    structure = json.loads(block[block.index("{") : block.rindex("}") + 1])
    assert structure["mode"] == "structure_clone"
    assert [s["label"] for s in structure["segments"]] == ["Cold open", "Rank 1: rower"]
