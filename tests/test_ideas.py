"""M4.8: бэклог идей — CRUD и статусы, семена ниши, промпт идей, ответ чата, выпуск из идеи."""

import json
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.settings import Settings
from app.storage.atomic import read_json
from app.storage.db import connect
from app.storage.paths import StudioPaths
from app.tools.seed import seed

GOLDEN = Path(__file__).parent / "fixtures" / "prompts"
# `STUDIO_UPDATE_GOLDEN=1 uv run pytest tests/test_ideas.py` перезаписывает эталон промпта.
UPDATE_GOLDEN = os.environ.get("STUDIO_UPDATE_GOLDEN") == "1"
PIRATE = "Every Rank on a Pirate Ship"


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


def idea(client: TestClient, title: str, channel: str = "cursus", **fields: Any) -> dict[str, Any]:
    response = client.post("/api/ideas", json={"channel": channel, "title": title, **fields})
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def set_status(paths: StudioPaths, idea_id: str, status: str) -> None:
    """Статус в обход переходов — для подготовки случаев таблицы."""
    conn = connect(paths.db_path)
    try:
        with conn:
            conn.execute("UPDATE ideas SET status = ? WHERE id = ?", (status, idea_id))
    finally:
        conn.close()


def messages(response: Any) -> list[str]:
    assert response.status_code == 422, response.text
    return [error["msg"] for error in response.json()["detail"]]


# --- CRUD -----------------------------------------------------------------------------------------


def test_manual_idea_goes_to_backlog_with_sequential_ids(seeded: TestClient) -> None:
    first = idea(seeded, f"  {PIRATE}  ", angle=" Ranks seen by a boy ", score=82.0)
    assert first["id"] == "i0001"
    assert first["title"] == PIRATE
    assert first["angle"] == "Ranks seen by a boy"
    assert (first["source"], first["status"], first["score"]) == ("manual", "backlog", 82)
    assert first["episode_id"] is None
    second = idea(seeded, "A Day in a Roman Bathhouse", channel="otto")
    assert second["id"] == "i0002"

    assert [i["id"] for i in seeded.get("/api/ideas").json()] == ["i0002", "i0001"]
    assert [i["id"] for i in seeded.get("/api/ideas", params={"channel": "otto"}).json()] == [
        "i0002"
    ]
    assert seeded.get("/api/ideas", params={"status": "proposed"}).json() == []


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({"title": "   "}, "Название не может быть пустым — введите текст."),
        ({"title": "x" * 201}, "Название длиннее 200 знаков — сократите его."),
        ({"title": "ok", "score": 101}, "Оценка — целое число от 0 до 100 или null."),
        ({"title": "ok", "score": "high"}, "Оценка — целое число от 0 до 100 или null."),
        ({"title": "ok", "score": True}, "Оценка — целое число от 0 до 100 или null."),
    ],
)
def test_create_errors_are_one_readable_message(
    seeded: TestClient, body: dict[str, Any], message: str
) -> None:
    assert messages(seeded.post("/api/ideas", json={"channel": "cursus", **body})) == [message]


def test_unknown_channel_and_idea(client: TestClient, seeded: TestClient) -> None:
    assert seeded.post("/api/ideas", json={"channel": "vlog", "title": "x"}).status_code == 422
    response = seeded.patch("/api/ideas/i0042", json={"title": "x"})
    assert response.status_code == 404
    assert response.json()["detail"] == "Идея «i0042» не найдена."


def test_patch_texts_score_reset_and_frozen_fields(seeded: TestClient) -> None:
    created = idea(seeded, PIRATE, score=70, score_reason="strong hook")
    response = seeded.patch(
        f"/api/ideas/{created['id']}", json={"summary": "Ranks, bottom to top.", "score": None}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["summary"], body["score"], body["score_reason"]) == (
        "Ranks, bottom to top.",
        None,
        "strong hook",
    )
    assert body["updated_at"] >= created["updated_at"]

    frozen = seeded.patch(
        f"/api/ideas/{created['id']}", json={"channel": "otto", "source": "bridge"}
    )
    assert messages(frozen) == [
        "Поля channel, source через PATCH не меняются — уберите их из запроса. Канал и источник"
        " задаются при создании, выпуск — созданием выпуска из идеи."
    ]
    assert messages(seeded.patch(f"/api/ideas/{created['id']}", json={"title": None})) == [
        "Название не может быть пустым — введите текст."
    ]


# --- статусы --------------------------------------------------------------------------------------

ALLOWED = [
    ("proposed", "backlog"),
    ("proposed", "dropped"),
    ("backlog", "dropped"),
    ("dropped", "backlog"),
]
REFUSED = [
    (
        "backlog",
        "proposed",
        "Идею со статусом «в бэклоге» нельзя перевести в «предложена»: можно «отброшена».",
    ),
    (
        "dropped",
        "proposed",
        "Идею со статусом «отброшена» нельзя перевести в «предложена»: можно «в бэклоге».",
    ),
    (
        "used",
        "backlog",
        "Идею со статусом «взята в выпуск» нельзя перевести в «в бэклоге»: можно никуда.",
    ),
    (
        "used",
        "dropped",
        "Идею со статусом «взята в выпуск» нельзя перевести в «отброшена»: можно никуда.",
    ),
]


@pytest.mark.parametrize(("before", "after"), ALLOWED)
def test_allowed_transitions(
    seeded: TestClient, paths: StudioPaths, before: str, after: str
) -> None:
    created = idea(seeded, PIRATE)
    set_status(paths, created["id"], before)
    response = seeded.patch(f"/api/ideas/{created['id']}", json={"status": after})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == after


@pytest.mark.parametrize(("before", "after", "message"), REFUSED)
def test_refused_transitions_are_409_with_text(
    seeded: TestClient, paths: StudioPaths, before: str, after: str, message: str
) -> None:
    created = idea(seeded, PIRATE)
    set_status(paths, created["id"], before)
    response = seeded.patch(f"/api/ideas/{created['id']}", json={"status": after})
    assert response.status_code == 409
    assert response.json()["detail"] == message


def test_used_is_set_only_by_episode_creation(seeded: TestClient) -> None:
    created = idea(seeded, PIRATE)
    response = seeded.patch(f"/api/ideas/{created['id']}", json={"status": "used"})
    assert response.status_code == 409
    assert response.json()["detail"].startswith("Статус «взята в выпуск» ставит создание выпуска")
    # Тот же статус — не переход, ничего не меняется
    same = seeded.patch(f"/api/ideas/{created['id']}", json={"status": "backlog"})
    assert same.status_code == 200
    assert same.json()["updated_at"] == created["updated_at"]


# --- семена ---------------------------------------------------------------------------------------


def test_seeds_are_cleaned_and_written_atomically(seeded: TestClient, paths: StudioPaths) -> None:
    response = seeded.patch(
        "/api/channels/cursus", json={"seeds": ["  pirate ships ", "", "Roman legions", "   "]}
    )
    assert response.status_code == 200, response.text
    assert response.json()["seeds"] == ["pirate ships", "Roman legions"]
    on_disk = read_json(paths.profile_path("cursus"))
    assert on_disk["seeds"] == ["pirate ships", "Roman legions"]
    assert on_disk["budgets"]["monthly_usd"] == 150  # остальной профиль на месте
    assert not list(paths.channel_dir("cursus").glob("*.tmp"))
    assert seeded.get("/api/channels/cursus").json()["seeds"] == ["pirate ships", "Roman legions"]

    cleared = seeded.patch("/api/channels/cursus", json={"seeds": []})
    assert cleared.status_code == 200
    assert "seeds" not in read_json(paths.profile_path("cursus"))


@pytest.mark.parametrize(
    ("seeds", "message"),
    [
        ([f"topic {n}" for n in range(21)], "Семян 21, а можно не больше 20 — уберите лишние."),
        (["Pirates", "pirates"], "Семя «pirates» повторяется — оставьте одно."),
        (["x" * 81], f"Семя «{'x' * 40}…» длиннее 80 знаков — сократите его до пары слов."),
    ],
)
def test_bad_seeds_are_422_with_text(seeded: TestClient, seeds: list[str], message: str) -> None:
    assert messages(seeded.patch("/api/channels/cursus", json={"seeds": seeds})) == [message]


def test_channel_patch_takes_only_seeds(seeded: TestClient) -> None:
    assert seeded.patch("/api/channels/cursus", json={"seeds": [], "name": "x"}).status_code == 422
    assert seeded.patch("/api/channels/vlog", json={"seeds": []}).status_code == 404


# --- промпт ---------------------------------------------------------------------------------------


def check_golden(name: str, prompt: dict[str, Any]) -> None:
    """Эталон: строка `prompt: <id>, version: <n>`, пустая строка, текст промпта (как у плана)."""
    path = GOLDEN / name
    header = f"prompt: {prompt['prompt_id']}, version: {prompt['version']}"
    if UPDATE_GOLDEN:
        path.write_text(f"{header}\n\n{prompt['text']}", encoding="utf-8")
    golden_header, _, golden_text = path.read_text(encoding="utf-8").partition("\n\n")
    if prompt["text"] != golden_text and golden_header == header:
        pytest.fail(
            f"Текст {prompt['prompt_id']} изменился, а version осталась {prompt['version']}:"
            " поднимите version в backend/app/prompts/ideas.md и обновите эталон"
            " (STUDIO_UPDATE_GOLDEN=1 uv run pytest tests/test_ideas.py)."
        )
    assert golden_header == header, f"Эталон {name} от другой версии — обновите его."
    assert prompt["text"] == golden_text, f"Эталон {name} устарел — обновите его."


@pytest.fixture
def channel_with_history(seeded: TestClient, paths: StudioPaths) -> TestClient:
    """Семена, бэклог из двух идей, предложенная и отброшенная, выпуски с названием и без."""
    seeded.patch("/api/channels/cursus", json={"seeds": ["pirate ships", "Roman legions"]})
    idea(seeded, PIRATE)
    idea(seeded, "Every Rank in a Roman Legion")
    proposed = idea(seeded, "Every Rank in a Medieval Monastery")
    set_status(paths, proposed["id"], "proposed")
    dropped = idea(seeded, "Every Rank in a Coal Mine")
    set_status(paths, dropped["id"], "dropped")
    idea(seeded, "A Day in Pompeii", channel="otto")
    seeded.post(
        "/api/episodes", json={"channel": "cursus", "title": "Every Rank in a Samurai House"}
    )
    seeded.post("/api/episodes", json={"channel": "cursus"})  # «Новый выпуск» — не тема
    return seeded


def test_prompt_matches_golden_and_lists_backlog_and_episodes(
    channel_with_history: TestClient,
) -> None:
    response = channel_with_history.post("/api/ideas/prompt", json={"channel": "cursus"})
    assert response.status_code == 200, response.text
    prompt = response.json()
    assert (prompt["prompt_id"], prompt["count"]) == ("ideas", 6)
    check_golden("ideas_cursus.txt", prompt)

    avoid = prompt["text"].split("## Do not repeat")[1].split("## Rules")[0]
    assert json.loads(avoid[avoid.index("[") : avoid.rindex("]") + 1]) == [
        PIRATE,
        "Every Rank in a Roman Legion",
        "Every Rank in a Samurai House",
    ]
    assert '"pirate ships"' in prompt["text"]
    runs = channel_with_history.get("/api/bridge/runs", params={"task": "ideas"}).json()
    assert [(r["id"], r["status"], r["channel"]) for r in runs] == [
        (prompt["run_id"], "prompted", "cursus")
    ]


def test_prompt_count_and_empty_seeds(seeded: TestClient) -> None:
    prompt = seeded.post("/api/ideas/prompt", json={"channel": "otto", "count": 3}).json()
    assert "Propose 3 new video ideas" in prompt["text"]
    assert "The channel's format is `host`" in prompt["text"]
    assert "## Niche seeds" in prompt["text"] and "\n[]\n" in prompt["text"]
    assert seeded.post("/api/ideas/prompt", json={"channel": "otto", "count": 0}).status_code == 422


# --- ответ чата -----------------------------------------------------------------------------------


def proposal(title: str, **fields: Any) -> dict[str, Any]:
    return {
        "title": title,
        "angle": f"{title}: the angle",
        "hook_promise": "You will know who held the power",
        "summary": "Two sentences. About ranks.",
        "score": 74,
        "score_reason": "Clear hierarchy, strong visuals",
        **fields,
    }


def answer_text(ideas: list[Any]) -> str:
    return "Here are the ideas.\n```json\n" + json.dumps({"ideas": ideas}, indent=2) + "\n```\n"


def test_six_ideas_one_broken_one_duplicate(channel_with_history: TestClient) -> None:
    client = channel_with_history
    prompt = client.post("/api/ideas/prompt", json={"channel": "cursus"}).json()
    ideas = [
        proposal("Every Rank in a Viking Longship"),
        {k: v for k, v in proposal("Every Rank in a Mongol Tumen").items() if k != "angle"},
        proposal("every rank on a pirate ship"),  # дубль бэклога без учёта регистра
        proposal("Every Rank in a Venetian Arsenal", score=None, score_reason=None, id="x1"),
        proposal("Every Rank in a Spanish Galleon", score=91.0),
        proposal("Every Rank in a Hanseatic Kontor"),
    ]
    response = client.post(
        "/api/ideas/answer", json={"channel": "cursus", "text": answer_text(ideas)}
    )
    assert response.status_code == 200, response.text
    result = response.json()

    created = result["created"]
    assert [i["title"] for i in created] == [
        "Every Rank in a Viking Longship",
        "Every Rank in a Venetian Arsenal",
        "Every Rank in a Spanish Galleon",
        "Every Rank in a Hanseatic Kontor",
    ]
    assert {(i["source"], i["status"], i["channel"]) for i in created} == {
        ("bridge", "proposed", "cursus")
    }
    assert [i["score"] for i in created] == [74, None, 91, 74]
    assert result["skipped"] == [
        {"index": 2, "title": "Every Rank in a Mongol Tumen", "reason": "нет поля «angle»"},
        {
            "index": 3,
            "title": "every rank on a pirate ship",
            "reason": "«every rank on a pirate ship» — уже в бэклоге",
        },
    ]

    runs = client.get("/api/bridge/runs", params={"task": "ideas"}).json()
    assert [(r["id"], r["status"]) for r in runs] == [(prompt["run_id"], "applied")]
    assert [e["message"] for e in runs[0]["errors"]] == [
        "идея 2: нет поля «angle»",
        "идея 3: «every rank on a pirate ship» — уже в бэклоге",
    ]
    assert (
        len(client.get("/api/ideas", params={"channel": "cursus", "status": "proposed"}).json())
        == 5
    )


@pytest.mark.parametrize(
    ("title", "reason"),
    [
        ("Every Rank in a Medieval Monastery", "уже предложена"),
        ("Every Rank in a Samurai House", "уже есть выпуск с таким названием"),
        ("A Day in Pompeii", None),  # идея другого канала — не дубль
        ("Every Rank in a Coal Mine", None),  # отброшенная — не дубль
    ],
)
def test_duplicates_against_ideas_and_episodes_of_channel(
    channel_with_history: TestClient, title: str, reason: str | None
) -> None:
    text = answer_text([proposal(title), proposal("Every Rank in a Roman Galley")])
    result = channel_with_history.post(
        "/api/ideas/answer", json={"channel": "cursus", "text": text}
    ).json()
    skipped = {s["title"]: s["reason"] for s in result["skipped"]}
    assert skipped.get(title) == (None if reason is None else f"«{title}» — {reason}")


def test_repeat_inside_answer_and_repaste_are_skipped(seeded: TestClient) -> None:
    text = answer_text(
        [proposal("Every Rank in a Roman Galley"), proposal("EVERY RANK IN A ROMAN GALLEY")]
    )
    first = seeded.post("/api/ideas/answer", json={"channel": "cursus", "text": text}).json()
    assert [s["reason"] for s in first["skipped"]] == [
        "«EVERY RANK IN A ROMAN GALLEY» — повторяет идею 1 этого ответа"
    ]
    again = seeded.post("/api/ideas/answer", json={"channel": "cursus", "text": text})
    assert again.status_code == 422
    assert again.json()["message"] == "Ни одна идея не принята: 2 пропущены."


def test_nothing_accepted_is_bridge_error_and_failed_run(seeded: TestClient) -> None:
    text = answer_text([{"title": ""}, "not an idea"])
    response = seeded.post("/api/ideas/answer", json={"channel": "cursus", "text": text})
    assert response.status_code == 422
    body = response.json()
    assert body["message"] == "Ни одна идея не принята: 2 пропущены."
    assert [e["message"] for e in body["errors"]] == [
        "идея 1: Название не может быть пустым — введите текст.; нет поля «angle»;"
        " нет поля «hook_promise»; нет поля «summary»",
        "идея 2: ожидался объект идеи {…}",
    ]
    assert seeded.get("/api/ideas").json() == []
    runs = seeded.get("/api/bridge/runs", params={"task": "ideas"}).json()
    assert [r["status"] for r in runs] == ["failed"]


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ('```json\n{"items": []}\n```', 'В ответе нет списка идей: ожидался {"ideas": [...]}.'),
        ('```json\n{"ideas": []}\n```', 'В ответе нет списка идей: ожидался {"ideas": [...]}.'),
        ("no json here", "В ответе нет JSON — ни блока ```json, ни объекта в фигурных скобках."),
    ],
)
def test_answer_without_ideas_list_is_422(seeded: TestClient, text: str, message: str) -> None:
    response = seeded.post("/api/ideas/answer", json={"channel": "cursus", "text": text})
    assert response.status_code == 422
    assert response.json()["message"] == message


# --- выпуск из идеи -------------------------------------------------------------------------------


def test_episode_from_backlog_idea(seeded: TestClient, paths: StudioPaths) -> None:
    created = idea(
        seeded,
        PIRATE,
        angle="Ranks through a powder monkey's eyes",
        hook_promise="From powder monkey to captain in twenty minutes",
        summary="Each rank shows what the ship needed from it.",
    )
    response = seeded.post(
        "/api/episodes", json={"channel": "cursus", "origin": "backlog", "idea_id": created["id"]}
    )
    assert response.status_code == 201, response.text
    episode = response.json()
    assert (episode["title"], episode["stage"], episode["origin"]) == (PIRATE, "idea", "backlog")

    brief = read_json(paths.project_path("cursus", episode["id"]))["brief"]
    assert brief == {
        "idea": PIRATE,
        "angle": "Ranks through a powder monkey's eyes",
        "hook_promise": "From powder monkey to captain in twenty minutes",
        "notes": "Each rank shows what the ship needed from it.",
        "sources": [],
        "idea_id": created["id"],
        "reference_id": None,
        "reference_mode": "none",
    }
    used = seeded.get("/api/ideas").json()[0]
    assert (used["status"], used["episode_id"]) == ("used", episode["id"])

    again = seeded.post(
        "/api/episodes", json={"channel": "cursus", "origin": "backlog", "idea_id": created["id"]}
    )
    assert again.status_code == 409
    assert again.json()["detail"] == (
        f"Идея «{PIRATE}» взята в выпуск {episode['id']} — выпуск создаётся только из идеи"
        " в бэклоге."
    )


def test_explicit_title_wins_over_idea_title(seeded: TestClient) -> None:
    created = idea(seeded, PIRATE)
    episode = seeded.post(
        "/api/episodes",
        json={
            "channel": "cursus",
            "origin": "backlog",
            "idea_id": created["id"],
            "title": "Pirates",
        },
    ).json()
    assert episode["title"] == "Pirates"


@pytest.mark.parametrize(
    ("setup", "body", "status", "detail"),
    [
        (
            "other_channel",
            {"channel": "cursus"},
            422,
            "— из канала otto, а выпуск создаётся в cursus. Выберите идею этого канала.",
        ),
        (
            "proposed",
            {"channel": "cursus"},
            409,
            "предложена — выпуск создаётся только из идеи в бэклоге.",
        ),
        (
            "dropped",
            {"channel": "cursus"},
            409,
            "отброшена — выпуск создаётся только из идеи в бэклоге.",
        ),
        ("unknown", {"channel": "cursus"}, 404, "Идея «i0099» не найдена."),
    ],
)
def test_episode_from_idea_refusals_leave_no_trace(
    seeded: TestClient,
    paths: StudioPaths,
    setup: str,
    body: dict[str, Any],
    status: int,
    detail: str,
) -> None:
    created = idea(seeded, PIRATE, channel="otto" if setup == "other_channel" else "cursus")
    if setup in ("proposed", "dropped"):
        set_status(paths, created["id"], setup)
    idea_id = "i0099" if setup == "unknown" else created["id"]
    response = seeded.post("/api/episodes", json={**body, "origin": "backlog", "idea_id": idea_id})
    assert response.status_code == status
    assert response.json()["detail"].endswith(detail)
    assert seeded.get("/api/episodes").json() == []
    assert not paths.episode_dir("cursus", "c01").exists()
    assert seeded.get("/api/ideas").json()[0]["status"] == (
        "backlog" if setup in ("other_channel", "unknown") else setup
    )


def test_idea_id_only_with_backlog_origin(seeded: TestClient) -> None:
    created = idea(seeded, PIRATE)
    response = seeded.post("/api/episodes", json={"channel": "cursus", "idea_id": created["id"]})
    assert messages(response) == [
        "Выпуск из идеи создаётся с origin «backlog» — поправьте origin или уберите idea_id."
    ]
