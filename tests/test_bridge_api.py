"""Мост: источник плана, журнал обменов, ошибка ответа 422, заявка выпуска в project.json."""

import json
import shutil
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.api.bridge import REASON_NO_KEY, REASON_NOT_WIRED
from app.main import create_app
from app.pipeline import bridge as bridge_pkg
from app.pipeline.bridge import (
    BridgeAnswerError,
    BridgeIssue,
    RenderedPrompt,
    RunNotFound,
    close_run,
    latest_runs,
    load_templates,
    open_run,
    record_answer,
)
from app.providers.base import ConfigError
from app.settings import REPO_ROOT, Settings
from app.storage.db import connect
from app.storage.paths import StudioPaths
from app.tools.seed import seed

FIXTURE_PROMPTS = Path(__file__).parent / "fixtures" / "prompts"


@pytest.fixture
def paths(settings: Settings) -> StudioPaths:
    return StudioPaths(settings.studio_data_dir)


@pytest.fixture
def seeded(client: TestClient, paths: StudioPaths) -> Iterator[TestClient]:
    conn = connect(paths.db_path)
    try:
        seed(paths, conn)
    finally:
        conn.close()
    yield client


@pytest.fixture
def prompt() -> RenderedPrompt:
    context = {"channel": "Cursus", "idea": "Pirate ship", "brief_json": "{}"}
    return load_templates(FIXTURE_PROMPTS).render("echo", context)


def _config_with(tmp_path: Path, **changes: Any) -> Path:
    config = tmp_path / "config"
    shutil.copytree(REPO_ROOT / "config", config)
    providers = config / "providers.yaml"
    data = yaml.safe_load(providers.read_text(encoding="utf-8"))
    data.update(changes)
    providers.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    return config


# --- plan_source ---------------------------------------------------------------------------------


def test_settings_without_key(client: TestClient) -> None:
    response = client.get("/api/bridge/settings")
    assert response.status_code == 200
    assert response.json() == {
        "plan_source": "bridge",
        "api": {"available": False, "reason": "Нет ключа ANTHROPIC_API_KEY — docs/api_keys.md"},
    }
    assert REASON_NO_KEY == response.json()["api"]["reason"]


def test_settings_with_key_api_is_not_wired_yet(settings: Settings) -> None:
    """В M4 пути через API нет: ключ не включает его, план идёт через мост (устав M4)."""
    keyed = settings.model_copy(update={"anthropic_api_key": SecretStr("sk-ant-test")})
    with TestClient(create_app(keyed)) as client:
        body = client.get("/api/bridge/settings").json()
    assert body == {
        "plan_source": "bridge",
        "api": {"available": False, "reason": REASON_NOT_WIRED},
    }


def test_plan_source_api_without_key_still_starts(tmp_path: Path) -> None:
    config = _config_with(tmp_path, plan_source="api")
    settings = Settings(_env_file=None, studio_data_dir=tmp_path / "data", config_dir=config)
    with TestClient(create_app(settings)) as client:
        body = client.get("/api/bridge/settings").json()
    assert body == {"plan_source": "bridge", "api": {"available": False, "reason": REASON_NO_KEY}}


def test_unknown_plan_source_stops_start(tmp_path: Path) -> None:
    config = _config_with(tmp_path, plan_source="chat")
    settings = Settings(_env_file=None, studio_data_dir=tmp_path / "data", config_dir=config)
    with pytest.raises(ConfigError) as caught:
        create_app(settings)
    assert "plan_source: «chat» — неизвестный источник плана, допустимо: bridge, api." in str(
        caught.value
    )


def test_plan_source_defaults_to_bridge(tmp_path: Path) -> None:
    config = _config_with(tmp_path)
    providers = config / "providers.yaml"
    data = yaml.safe_load(providers.read_text(encoding="utf-8"))
    del data["plan_source"]
    providers.write_text(yaml.safe_dump(data), encoding="utf-8")
    settings = Settings(_env_file=None, studio_data_dir=tmp_path / "data", config_dir=config)
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/bridge/settings").json()["plan_source"] == "bridge"


# --- журнал --------------------------------------------------------------------------------------


def test_run_open_and_close(seeded: TestClient, paths: StudioPaths, prompt: RenderedPrompt) -> None:
    seeded.post("/api/episodes", json={"channel": "cursus"})
    conn = connect(paths.db_path)
    try:
        opened = open_run(
            conn, task="plan", channel="cursus", prompt=prompt, episode_id="c01", parts_total=4
        )
        assert opened.status == "prompted"
        assert (opened.prompt_id, opened.prompt_version, opened.prompt_hash) == (
            "echo",
            3,
            prompt.sha256,
        )
        assert (opened.part, opened.parts_total) == (1, 4)
        assert opened.answered_at is None
        assert opened.errors == []

        applied = close_run(conn, opened.id, "applied")
        assert applied.id == opened.id
        assert applied.status == "applied"
        assert applied.answered_at is not None

        second = open_run(
            conn,
            task="plan",
            channel="cursus",
            prompt=prompt,
            episode_id="c01",
            part=2,
            parts_total=4,
        )
        issues = [BridgeIssue(path="s027.image.prompt", message="Стилевой токен «8k»")]
        failed = close_run(conn, second.id, "failed", issues)
        assert failed.status == "failed"
        assert failed.errors == issues
    finally:
        conn.close()


def test_answer_to_closed_run_is_a_new_row(
    seeded: TestClient, paths: StudioPaths, prompt: RenderedPrompt
) -> None:
    conn = connect(paths.db_path)
    try:
        opened = open_run(conn, task="ideas", channel="cursus", prompt=prompt)
        failed = close_run(conn, opened.id, "failed", [BridgeIssue(path="", message="x")])
        retry = close_run(conn, opened.id, "applied")
        assert retry.id != opened.id
        assert retry.status == "applied"
        assert (retry.prompt_hash, retry.task, retry.channel) == (prompt.sha256, "ideas", "cursus")
        assert retry.created_at == retry.answered_at
        # Закрытая строка не переписана.
        assert latest_runs(conn, task="ideas")[1] == failed

        with pytest.raises(RunNotFound):
            close_run(conn, "nope", "applied")
    finally:
        conn.close()


def test_answer_without_open_run(
    seeded: TestClient, paths: StudioPaths, prompt: RenderedPrompt
) -> None:
    conn = connect(paths.db_path)
    try:
        run = record_answer(
            conn,
            task="reference",
            channel="otto",
            prompt=prompt,
            status="applied",
            target_id="ref-42",
        )
        assert run.status == "applied"
        assert run.answered_at == run.created_at
        assert run.target_id == "ref-42"
        assert run.episode_id is None
        assert latest_runs(conn, target_id="ref-42") == [run]
    finally:
        conn.close()


def test_latest_runs_by_episode_and_task(
    seeded: TestClient, paths: StudioPaths, prompt: RenderedPrompt
) -> None:
    seeded.post("/api/episodes", json={"channel": "cursus"})
    seeded.post("/api/episodes", json={"channel": "cursus"})
    conn = connect(paths.db_path)
    try:
        first = open_run(
            conn, task="plan", channel="cursus", prompt=prompt, episode_id="c01", parts_total=2
        )
        second = open_run(
            conn,
            task="plan",
            channel="cursus",
            prompt=prompt,
            episode_id="c01",
            part=2,
            parts_total=2,
        )
        open_run(conn, task="plan", channel="cursus", prompt=prompt, episode_id="c02")
        ideas = open_run(conn, task="ideas", channel="cursus", prompt=prompt)
        close_run(conn, first.id, "applied")
    finally:
        conn.close()

    by_episode = seeded.get("/api/bridge/runs", params={"episode_id": "c01", "task": "plan"})
    assert by_episode.status_code == 200
    runs = by_episode.json()
    assert [r["id"] for r in runs] == [second.id, first.id]
    assert [r["status"] for r in runs] == ["prompted", "applied"]
    assert runs[1]["errors"] == []

    only_ideas = seeded.get("/api/bridge/runs", params={"task": "ideas"}).json()
    assert [r["id"] for r in only_ideas] == [ideas.id]
    assert len(seeded.get("/api/bridge/runs").json()) == 4
    assert len(seeded.get("/api/bridge/runs", params={"limit": 1}).json()) == 1
    assert seeded.get("/api/bridge/runs", params={"task": "script"}).status_code == 422


def test_bridge_writes_no_cost_rows(
    seeded: TestClient, paths: StudioPaths, prompt: RenderedPrompt
) -> None:
    """Мост для приложения бесплатен: ни одной строки `cost_ledger` (устав M4, решение 1)."""
    conn = connect(paths.db_path)
    try:
        run = open_run(conn, task="ideas", channel="cursus", prompt=prompt)
        close_run(conn, run.id, "failed", [BridgeIssue(path="", message="x")])
        close_run(conn, run.id, "applied")
        record_answer(conn, task="ideas", channel="otto", prompt=prompt, status="applied")
        assert conn.execute("SELECT COUNT(*) FROM cost_ledger").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM bridge_runs").fetchone()[0] == 3
    finally:
        conn.close()

    package = Path(bridge_pkg.__file__).parent
    for source in package.glob("*.py"):
        text = source.read_text(encoding="utf-8")
        for forbidden in ("anthropic", "app.cost", "app.providers.gateway"):
            assert forbidden not in text, f"{source.name} imports {forbidden}"


# --- ошибка ответа -------------------------------------------------------------------------------


def test_bridge_answer_error_is_422_bridge_error(app: FastAPI) -> None:
    @app.post("/api/test/bridge-answer")
    async def answer(body: dict[str, str]) -> dict[str, Any]:
        bridge_pkg.extract_json(body["text"])
        raise BridgeAnswerError(
            "План не прошёл проверку: 1 ошибка.",
            "Попросите чат исправить кадр s027.",
            [BridgeIssue(path="s027.image.prompt", message="Стилевой токен «8k»")],
        )

    with TestClient(app) as client:
        truncated = client.post("/api/test/bridge-answer", json={"text": '```json\n{"a": ['})
        assert truncated.status_code == 422
        assert truncated.json() == {
            "message": "Ответ обрывается на строке 2: JSON-объект не закрыт.",
            "hint": (
                "Напишите чату «continue», склейте продолжение с ответом и вставьте целиком —"
                " или запросите часть поменьше."
            ),
            "errors": [],
        }

        invalid = client.post("/api/test/bridge-answer", json={"text": '{"a": 1}'})
        assert invalid.status_code == 422
        assert invalid.json() == {
            "message": "План не прошёл проверку: 1 ошибка.",
            "hint": "Попросите чат исправить кадр s027.",
            "errors": [{"path": "s027.image.prompt", "message": "Стилевой токен «8k»"}],
        }


# --- заявка --------------------------------------------------------------------------------------

BRIEF = {
    "idea": "Every rank on a pirate ship",
    "angle": "",
    "hook_promise": "",
    "notes": "",
    "sources": [],
}


def test_patch_brief_creates_and_merges(seeded: TestClient, paths: StudioPaths) -> None:
    seeded.post("/api/episodes", json={"channel": "cursus"})
    assert seeded.get("/api/projects/c01").json()["brief"] is None

    created = seeded.patch("/api/projects/c01", json={"brief": BRIEF})
    assert created.status_code == 200, created.text
    assert created.json()["brief"] == {
        **BRIEF,
        "idea_id": None,
        "reference_id": None,
        "reference_mode": "none",
    }

    sources = [{"title": "Pirate articles", "url": "https://example.org/articles"}]
    merged = seeded.patch(
        "/api/projects/c01",
        json={"brief": {"angle": "Ranks through a powder monkey", "sources": sources}},
    ).json()["brief"]
    assert merged["idea"] == BRIEF["idea"]
    assert merged["angle"] == "Ranks through a powder monkey"
    assert merged["sources"] == sources

    on_disk = json.loads(paths.project_path("cursus", "c01").read_text(encoding="utf-8"))
    assert on_disk["brief"] == merged
    assert seeded.patch("/api/projects/c01", json={"brief": None}).json()["brief"] is None


@pytest.mark.parametrize(
    ("brief", "message"),
    [
        ({**BRIEF, "title": "x"}, "Лишнее поле brief.title — уберите его из запроса."),
        (
            {**BRIEF, "sources": [{"title": "x", "url": "y", "year": 1716}]},
            "Лишнее поле brief.sources[0].year — уберите его из запроса.",
        ),
        (
            {**BRIEF, "sources": [{"title": "x"}]},
            "Нет обязательного поля brief.sources[0].url.",
        ),
        (
            {**BRIEF, "reference_mode": "copy"},
            "Поле brief.reference_mode: недопустимое значение «copy», допустимо: none,"
            " structure_clone, own_version.",
        ),
        ({**BRIEF, "idea": 42}, "Поле brief.idea должно быть строкой."),
    ],
)
def test_bad_brief_is_one_readable_422(
    seeded: TestClient, paths: StudioPaths, brief: dict[str, Any], message: str
) -> None:
    seeded.post("/api/episodes", json={"channel": "cursus"})
    before = paths.project_path("cursus", "c01").read_text(encoding="utf-8")

    response = seeded.patch("/api/projects/c01", json={"brief": brief})
    assert response.status_code == 422
    assert [e["msg"] for e in response.json()["detail"]] == [message]
    assert paths.project_path("cursus", "c01").read_text(encoding="utf-8") == before
