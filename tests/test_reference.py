"""M4.10: референс — субтитры, разбор через мост, метрики, выпуск по структуре, промпт плана без
текста референса, сходство и отказ «Утвердить план» (принцип 11)."""

import json
import math
import os
import shutil
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from app.main import create_app
from app.pipeline.research.similarity import ngrams, words
from app.providers.base import ConfigError
from app.settings import REPO_ROOT, Settings
from app.storage.atomic import read_json
from app.storage.db import connect
from app.storage.paths import StudioPaths
from app.tools.seed import seed

FIXTURES = Path(__file__).parent / "fixtures"
SRT = (FIXTURES / "reference_warship.srt").read_text(encoding="utf-8")
GOLDEN = FIXTURES / "prompts"
# `STUDIO_UPDATE_GOLDEN=1 uv run pytest tests/test_reference.py` перезаписывает эталон промпта.
UPDATE_GOLDEN = os.environ.get("STUDIO_UPDATE_GOLDEN") == "1"

STARTS = [0, 20, 40, 80, 90, 130, 145, 165]
FACTS = [0, 0, 3, 0, 2, 1, 2, 0]
KINDS = ["hook", "promise", "rank", "retention", "rank", "rank", "rank", "finale"]
LABELS = [
    "Cold open",
    "What you will get",
    "Rank 1: rower",
    "Teaser",
    "Rank 2: marine",
    "Rank 3: helmsman",
    "Rank 4: trierarch",
    "Ending",
]
ANALYSIS: dict[str, Any] = {
    "title": "Every Rank on a Roman Warship",
    "author": "Sample channel",
    "topic": "How power and pay were split among the crew of an ancient Roman galley",
    "segments": [
        {"kind": k, "label": label, "start": f"{s // 60:02d}:{s % 60:02d}", "facts": f}
        for k, label, s, f in zip(KINDS, LABELS, STARTS, FACTS, strict=True)
    ],
    "techniques": [
        {"text": "Rank named aloud and repeated when its block ends", "count": 4},
        {"text": "Pay compared at each step", "count": 3},
    ],
    "comment": "лишний ключ чата не мешает",
}


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
def reference(seeded: TestClient) -> dict[str, Any]:
    response = seeded.post(
        "/api/references",
        json={"channel": "cursus", "url": " youtube.com/watch?v=sample ", "subtitles": SRT},
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def answer(analysis: dict[str, Any]) -> str:
    return (
        "Here is the breakdown.\n```json\n"
        + json.dumps(analysis, indent=2)
        + "\n```\nHope it helps."
    )


@pytest.fixture
def analyzed(seeded: TestClient, reference: dict[str, Any]) -> dict[str, Any]:
    response = seeded.post(
        f"/api/references/{reference['id']}/answer", json={"text": answer(ANALYSIS)}
    )
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


# --- хранение -------------------------------------------------------------------------------------


def test_create_parses_subtitles_and_keeps_text(
    seeded: TestClient, reference: dict[str, Any]
) -> None:
    assert reference["id"] == "ref0001"
    assert (reference["channel"], reference["url"]) == ("cursus", "youtube.com/watch?v=sample")
    assert (reference["duration_s"], reference["cues"]) == (180.0, 14)
    assert reference["subtitles"] == SRT
    assert (reference["analysis"], reference["metrics"], reference["analyzed_at"]) == (
        None,
        None,
        None,
    )
    assert (reference["title"], reference["author"]) == ("", "")

    second = seeded.post(
        "/api/references", json={"channel": "otto", "subtitles": "0:00 hello\n0:05 there"}
    )
    assert second.json()["id"] == "ref0002"
    assert [r["id"] for r in seeded.get("/api/references").json()] == ["ref0002", "ref0001"]
    assert [
        r["id"] for r in seeded.get("/api/references", params={"channel": "cursus"}).json()
    ] == ["ref0001"]
    assert seeded.get("/api/references/ref0001").json()["cues"] == 14


def test_not_subtitles_is_422_and_unknown_is_404(seeded: TestClient) -> None:
    response = seeded.post("/api/references", json={"channel": "cursus", "subtitles": "just text"})
    assert response.status_code == 422
    assert response.json()["detail"] == (
        "Не похоже на субтитры: нет таймкодов. Вставьте SRT, VTT или расшифровку с YouTube."
    )
    assert seeded.get("/api/references/ref0042").status_code == 404
    assert (
        seeded.post("/api/references", json={"channel": "vlog", "subtitles": SRT}).status_code
        == 422
    )


# --- мост -----------------------------------------------------------------------------------------


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
            " поднимите version в backend/app/prompts/reference.md и обновите эталон"
            " (STUDIO_UPDATE_GOLDEN=1 uv run pytest tests/test_reference.py)."
        )
    assert golden_header == header, f"Эталон {name} от другой версии — обновите его."
    assert prompt["text"] == golden_text, f"Эталон {name} устарел — обновите его."


def test_prompt_matches_golden_and_opens_run(seeded: TestClient, reference: dict[str, Any]) -> None:
    response = seeded.post(f"/api/references/{reference['id']}/prompt")
    assert response.status_code == 200, response.text
    prompt = response.json()
    check_golden("reference_warship.txt", prompt)
    assert "[02:45] So when the order to ram comes" in prompt["text"]
    assert "Duration: 03:00 (180 seconds)." in prompt["text"]
    runs = seeded.get("/api/bridge/runs", params={"task": "reference"}).json()
    assert [(r["id"], r["status"], r["target_id"]) for r in runs] == [
        (prompt["run_id"], "prompted", reference["id"])
    ]


def test_answer_with_prose_is_saved(seeded: TestClient, reference: dict[str, Any]) -> None:
    prompt = seeded.post(f"/api/references/{reference['id']}/prompt").json()
    body = seeded.post(
        f"/api/references/{reference['id']}/answer", json={"text": answer(ANALYSIS)}
    ).json()
    assert (body["title"], body["author"]) == ("Every Rank on a Roman Warship", "Sample channel")
    assert body["analyzed_at"] is not None
    assert [s["start"] for s in body["analysis"]["segments"]] == [float(s) for s in STARTS]
    assert "comment" not in body["analysis"]
    runs = seeded.get("/api/bridge/runs", params={"task": "reference"}).json()
    assert [(r["id"], r["status"]) for r in runs] == [(prompt["run_id"], "applied")]


def broken(**changes: Any) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(json.dumps(ANALYSIS))
    for index, segment in changes.pop("segments", {}).items():
        data["segments"][index].update(segment)
    data.update(changes)
    return data


@pytest.mark.parametrize(
    ("analysis", "messages"),
    [
        (
            broken(segments={1: {"kind": "intro"}, 3: {"start": "00:30"}}),
            [
                "сегмент 2: вид «intro» неизвестен, ожидалось одно из: hook, promise, rank,"
                " retention, finale, other",
            ],
        ),
        (
            broken(segments={3: {"start": "00:30"}}),
            ["сегмент 4: начало 00:30 не позже предыдущего 00:40 — сегменты идут по порядку"],
        ),
        (
            broken(segments={0: {"start": 31}, 1: {"start": 35}}),
            ["сегмент 1: начинается в 00:31, а должен — в первые 30 секунд ролика"],
        ),
        (
            broken(segments={7: {"start": "03:05"}}),
            ["сегмент 8: начало 03:05 за концом ролика 03:00"],
        ),
        (
            {**ANALYSIS, "segments": ANALYSIS["segments"][:1]},
            ["сегментов меньше двух — разбор слишком грубый"],
        ),
        (
            {**ANALYSIS, "topic": " ", "techniques": [{"text": "x", "count": 0}]},
            [
                "нет темы «topic» — одной строкой своими словами",
                "приём 1: нужны «text» — приём своими словами и «count» ≥ 1",
            ],
        ),
        (
            broken(segments={2: {"start": "soon", "facts": -1}}),
            [
                "сегмент 3: начало «soon» — ожидались секунды или mm:ss",
                "сегмент 3: «facts» — целое число фактов, не меньше 0",
            ],
        ),
        # Принцип 11 (L-036): тема, подписи и приёмы уходят в промпт плана — фразы субтитров нельзя
        (
            {
                **broken(segments={1: {"label": "Three hundred men pull together"}}),
                "topic": "Climbing from the bottom of the hull to the top",
                "techniques": [
                    {"text": "Every rank on a Roman warship had its own pay", "count": 2}
                ],
            },
            [
                "тема «topic» повторяет субтитры «from the bottom of the hull to the» — перескажите"
                " своими словами",
                "сегмент 2: подпись повторяет субтитры «three hundred men pull together» —"
                " перескажите своими словами",
                "приём 1: текст повторяет субтитры «every rank on a roman warship had its own"
                " pay» — перескажите своими словами",
            ],
        ),
    ],
)
def test_bad_analysis_is_422_with_segment_numbers(
    seeded: TestClient, reference: dict[str, Any], analysis: dict[str, Any], messages: list[str]
) -> None:
    response = seeded.post(
        f"/api/references/{reference['id']}/answer", json={"text": answer(analysis)}
    )
    assert response.status_code == 422
    body = response.json()
    assert [e["message"] for e in body["errors"]] == messages
    assert body["message"].startswith("Разбор не прошёл проверку:")
    assert seeded.get(f"/api/references/{reference['id']}").json()["analysis"] is None
    runs = seeded.get("/api/bridge/runs", params={"task": "reference"}).json()
    assert [r["status"] for r in runs] == ["failed"]


# --- метрики --------------------------------------------------------------------------------------


def test_metrics_match_hand_count(analyzed: dict[str, Any]) -> None:
    """Слова — по пробелам вручную: в фикстуре нет дефисов, тире и чисел."""
    blocks = [b for b in SRT.strip().split("\n\n")]
    cue_words = [len(" ".join(b.split("\n")[2:]).split()) for b in blocks]
    cue_starts = [0, 6.5, 13, 20, 28.5, 40, 52, 65, 80, 90, 105, 130, 145, 165]
    ends = [*STARTS[1:], 180]
    seg_words = [
        sum(w for w, s in zip(cue_words, cue_starts, strict=True) if lo <= s < hi)
        for lo, hi in zip(STARTS, ends, strict=True)
    ]
    total = sum(cue_words)
    m = analyzed["metrics"]

    assert m["words"] == total == sum(seg_words)
    assert m["pace_wpm"] == round(total / 3, 1)
    assert (m["norm_wpm"], m["pace_delta"]) == (150, round((total / 3 - 150) / 150, 3))
    assert (m["facts_total"], m["facts_per_min"]) == (8, round(8 / 3, 2))
    # Плотность: гребец 4.5, морпех 3.0, кормчий 4.0, триерарх 6.0 в минуту — все ≥ 70 % от 2.67;
    # последний такой сегмент кончается в 02:45
    assert m["holds_until_s"] == 165.0
    assert m["retention_hooks_s"] == [80.0]
    assert (m["segments_total"], m["ranks_total"]) == (8, 4)
    rows = m["segments"]
    assert [r["duration_s"] for r in rows] == [hi - lo for lo, hi in zip(STARTS, ends, strict=True)]
    assert [r["words"] for r in rows] == seg_words
    assert [r["pace_wpm"] for r in rows] == [
        round(w / ((hi - lo) / 60), 1) for w, lo, hi in zip(seg_words, STARTS, ends, strict=True)
    ]
    assert [r["facts_per_min"] for r in rows] == [
        round(f / ((hi - lo) / 60), 2) for f, lo, hi in zip(FACTS, STARTS, ends, strict=True)
    ]


# --- выпуск по референсу и промпт плана -----------------------------------------------------------


def test_episode_before_analysis_is_409(seeded: TestClient, reference: dict[str, Any]) -> None:
    response = seeded.post(
        f"/api/references/{reference['id']}/episodes", json={"mode": "own_version"}
    )
    assert response.status_code == 409
    assert response.json()["detail"].startswith("Сначала разберите референс")


@pytest.mark.parametrize(
    ("mode", "idea"), [("own_version", ANALYSIS["topic"]), ("structure_clone", "")]
)
def test_episode_from_reference(
    seeded: TestClient, analyzed: dict[str, Any], paths: StudioPaths, mode: str, idea: str
) -> None:
    response = seeded.post(f"/api/references/{analyzed['id']}/episodes", json={"mode": mode})
    assert response.status_code == 201, response.text
    episode = response.json()
    assert (episode["channel"], episode["origin"], episode["stage"]) == (
        "cursus",
        "reference",
        "script",
    )
    assert episode["title"] == "Новый выпуск"  # чужое название не переносим
    brief = read_json(paths.project_path("cursus", episode["id"]))["brief"]
    assert brief == {
        "idea": idea,
        "angle": "",
        "hook_promise": "",
        "notes": "",
        "sources": [],
        "idea_id": None,
        "reference_id": analyzed["id"],
        "reference_mode": mode,
    }


def test_plan_prompt_gets_structure_but_no_subtitle_ngrams(
    seeded: TestClient, analyzed: dict[str, Any]
) -> None:
    episode = seeded.post(
        f"/api/references/{analyzed['id']}/episodes", json={"mode": "own_version"}
    ).json()
    response = seeded.post(f"/api/projects/{episode['id']}/plan/prompt", params={"part": 1})
    assert response.status_code == 200, response.text
    text = response.json()["text"]

    block = text.split("## Reference structure")[1].split("`null` means")[0]
    structure = json.loads(block[block.index("{") : block.rindex("}") + 1])
    assert structure["mode"] == "own_version"
    assert [(s["kind"], s["label"]) for s in structure["segments"]] == list(
        zip(KINDS, LABELS, strict=True)
    )
    assert [s["seconds"] for s in structure["segments"]] == [20, 20, 40, 10, 40, 15, 20, 15]
    assert structure["pace_wpm"] == round(analyzed["metrics"]["pace_wpm"])
    assert structure["techniques"] == ANALYSIS["techniques"]

    # Принцип 11: ни одной 5-граммы субтитров в промпте плана
    subtitle_grams = set(
        ngrams(words(" ".join(b.split("\n", 2)[2] for b in SRT.strip().split("\n\n"))), 5)
    )
    leaked = subtitle_grams & set(ngrams(words(text), 5))
    assert leaked == set()


def test_plan_prompt_without_reference_has_null(seeded: TestClient) -> None:
    created = seeded.post("/api/episodes", json={"channel": "cursus"}).json()
    seeded.patch(
        f"/api/projects/{created['id']}", json={"brief": {"idea": "Every rank in a kitchen"}}
    )
    text = seeded.post(f"/api/projects/{created['id']}/plan/prompt", params={"part": 1}).json()[
        "text"
    ]
    assert "## Reference structure\n\nnull\n" in text


# --- сходство и утверждение -----------------------------------------------------------------------

# Совпавшие фразы — нормализованные: нижний регистр, без пунктуации
HELMSMAN = (
    "the helmsman holds two steering oars at the stern and reads the water like a farmer"
    " reads the sky"
)
THREE_HUNDRED = (
    "three hundred men pull together below deck and none of them can see where the ship is going"
)
COPIED = [
    "Three hundred men pull together below deck, and none of them can see where the ship is going.",
    "The helmsman holds two steering oars at the stern and reads the water like a farmer reads"
    " the sky.",
]


def import_plan(client: TestClient, episode_id: str, copied: list[str]) -> None:
    """План фикстуры для выпуска; первые кадры — со скопированным VO."""
    plan = json.loads((FIXTURES / "director_pirate_10shots.json").read_text(encoding="utf-8"))
    plan["meta"]["episode_id"] = episode_id
    for shot, vo in zip(plan["shots"], copied, strict=False):
        shot["vo"] = vo
    assert client.post(f"/api/projects/{episode_id}/director", json=plan).status_code == 200


@pytest.fixture
def reference_episode(seeded: TestClient, analyzed: dict[str, Any]) -> str:
    episode = seeded.post(
        f"/api/references/{analyzed['id']}/episodes", json={"mode": "structure_clone"}
    )
    episode_id: str = episode.json()["id"]
    return episode_id


def test_similarity_reasons_without_plan_or_reference(
    seeded: TestClient, reference_episode: str
) -> None:
    assert seeded.get(f"/api/projects/{reference_episode}/similarity").json() == {
        "similarity": None,
        "reason": "Плана ещё нет — сравнивать нечего.",
    }
    plain = seeded.post("/api/episodes", json={"channel": "cursus"}).json()
    assert seeded.get(f"/api/projects/{plain['id']}/similarity").json() == {
        "similarity": None,
        "reason": "Выпуск не по референсу — сравнивать не с чем.",
    }


def test_own_plan_is_below_threshold_and_approves(
    seeded: TestClient, reference_episode: str, no_canon_gate: None
) -> None:
    import_plan(seeded, reference_episode, [])
    found = seeded.get(f"/api/projects/{reference_episode}/similarity").json()["similarity"]
    assert (found["ok"], found["threshold"], found["ngram"]) == (True, 0.1, 5)
    assert found["phrases"] == []
    assert seeded.post(f"/api/episodes/{reference_episode}/approve").status_code == 200


def test_copied_plan_is_refused_with_phrases(
    seeded: TestClient, reference_episode: str, no_canon_gate: None
) -> None:
    import_plan(seeded, reference_episode, COPIED)
    found = seeded.get(f"/api/projects/{reference_episode}/similarity").json()["similarity"]
    assert not found["ok"]
    assert found["ratio"] > 0.10
    assert found["phrases"] == [
        HELMSMAN,
        THREE_HUNDRED,
    ]

    response = seeded.post(f"/api/episodes/{reference_episode}/approve")
    assert response.status_code == 409
    detail = response.json()["detail"]
    pct = f"{round(found['ratio'] * 100, 1):g} %"
    expected = (
        f"Сходство с референсом {pct} при пороге 10 %: перепишите совпавшие фразы — "
        f"«{found['phrases'][0]}»; «{found['phrases'][1]}»."
    )
    assert detail["message"] == expected
    assert detail["problems"] == [{"check": "similarity", "shot_id": None, "message": expected}]
    assert seeded.get(f"/api/episodes/{reference_episode}").json()["stage"] == "script"


# --- конфиг ---------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("content", "match"),
    [
        ({"ngram": 1, "max_similarity": 0.1}, "настройки референса некорректны"),
        ({"ngram": 5, "max_similarity": 1.5}, "настройки референса некорректны"),
        ({"ngram": 5}, "настройки референса некорректны"),
        (None, "Не прочитать настройки референса"),
    ],
)
def test_bad_reference_config_is_startup_error(
    tmp_path: Path, content: dict[str, Any] | None, match: str
) -> None:
    config = tmp_path / "config"
    shutil.copytree(REPO_ROOT / "config", config)
    path = config / "reference.yaml"
    if content is None:
        path.unlink()
    else:
        path.write_text(yaml.safe_dump(content), encoding="utf-8")
    settings = Settings(_env_file=None, studio_data_dir=tmp_path / "data", config_dir=config)
    with pytest.raises(ConfigError, match=match):
        create_app(settings)


def test_shipped_config() -> None:
    data = yaml.safe_load((REPO_ROOT / "config" / "reference.yaml").read_text(encoding="utf-8"))
    assert data == {"ngram": 5, "max_similarity": 0.1}
    assert math.isclose(data["max_similarity"], 0.10)
