import json
from pathlib import Path
from typing import Any

import pytest

from app.jobs.queue import Job, JobStatus
from app.models.director import Director
from app.models.episode_summary import count_words, current_jobs, summarize
from app.models.project import Project

FIXTURE = Path(__file__).parent / "fixtures" / "director_pirate_10shots.json"
# Слова VO фикстуры по кадрам s001…s010, посчитаны вручную: всего 204.
WORDS = [19, 21, 28, 21, 17, 17, 19, 22, 17, 23]


@pytest.fixture
def director() -> Director:
    return Director.model_validate(json.loads(FIXTURE.read_text(encoding="utf-8")))


def project(shots: dict[str, str], timings: dict[str, tuple[float, str]] | None = None) -> Project:
    start = 0.0
    timing_map: dict[str, Any] = {}
    for shot_id, (duration, source) in (timings or {}).items():
        timing_map[shot_id] = {
            "shot_id": shot_id,
            "start": start,
            "duration": duration,
            "source": source,
        }
        start += duration
    return Project.model_validate(
        {
            "schema": "studio.project/1",
            "episode_id": "c07-pirate-ship",
            "channel": "cursus",
            "director_version": "v001",
            "shots": {k: {"status": v} for k, v in shots.items()},
            "timings": timing_map,
            "updated_at": "2026-09-26T10:00:00+00:00",
        }
    )


def job(
    job_id: str,
    status: JobStatus,
    episode_id: str | None,
    progress: float = 0.0,
    message: str | None = None,
) -> Job:
    return Job(
        id=job_id,
        kind="images",
        status=status,
        progress=progress,
        message=message,
        payload={},
        result=None,
        error=None,
        attempts=0,
        cancel_requested=False,
        episode_id=episode_id,
        batch_id=None,
        idempotency_key=None,
        created_at="2026-09-26T10:00:00+00:00",
        started_at=None,
        finished_at=None,
    )


PARTLY_DONE = {
    "s001": "done",
    "s002": "done",
    "s003": "done",
    "s004": "done",
    "s005": "failed",
    "s006": "stale",
    "s007": "generating",
    "s008": "queued",
    # s009 в project.json нет — считается `todo`.
    "s010": "done",
    # Кадр прошлой версии плана: в текущей его нет, в сводку не входит.
    "s011": "removed",
}


def test_counts_on_pirate_fixture(director: Director) -> None:
    summary = summarize(project(PARTLY_DONE), director, 1_750_000, None)
    assert summary.model_dump() == {
        "shots_total": 10,
        "shots_done": 5,
        "shots_failed": 1,
        "shots_stale": 1,
        "shots_generating": 1,
        "vo_words": 204,
        "duration_s": 81.6,  # 204 слова при 150 слов/мин
        "duration_source": "estimate",
        "spent_usd_micro": 1_750_000,
        "job": None,
    }


def test_removed_shot_leaves_total_and_words(director: Director) -> None:
    summary = summarize(project({**PARTLY_DONE, "s010": "removed"}), director, 0, None)
    assert summary.shots_total == 9
    assert summary.shots_done == 4
    assert summary.vo_words == 204 - WORDS[9]


def test_duration_from_voice_timings(director: Director) -> None:
    timings = {s.id: (5.25, "voice") for s in director.shots}
    timings["s002"] = (4.0, "locked")  # ручная длина — тоже измеренная
    summary = summarize(project(PARTLY_DONE, timings), director, 0, None)
    assert summary.duration_source == "voice"
    assert summary.duration_s == pytest.approx(9 * 5.25 + 4.0)


@pytest.mark.parametrize(
    "timings",
    [
        {"s001": (5.0, "voice")},  # выравнивание не у всех кадров
        {f"s{n:03d}": (5.0, "estimate") for n in range(1, 11)},  # оценка — ещё не голос
    ],
)
def test_partial_or_estimated_timings_fall_back_to_words(
    director: Director, timings: dict[str, tuple[float, str]]
) -> None:
    summary = summarize(project(PARTLY_DONE, timings), director, 0, None)
    assert summary.duration_source == "estimate"
    assert summary.duration_s == pytest.approx(81.6)


def test_duration_from_target_without_vo(director: Director) -> None:
    silent = director.model_copy(
        update={"shots": [s.model_copy(update={"vo": " — "}) for s in director.shots]}
    )
    summary = summarize(project({}), silent, 0, None)
    assert summary.vo_words == 0
    assert summary.duration_source == "target"
    assert summary.duration_s == 20 * 60.0


def test_no_plan_gives_zeros() -> None:
    for proj in (project({}), None):
        summary = summarize(proj, None, 380_000, None)
        assert summary.model_dump() == {
            "shots_total": 0,
            "shots_done": 0,
            "shots_failed": 0,
            "shots_stale": 0,
            "shots_generating": 0,
            "vo_words": 0,
            "duration_s": None,
            "duration_source": None,
            "spent_usd_micro": 380_000,
            "job": None,
        }


def test_current_job_prefers_running_then_latest() -> None:
    jobs = [
        job("a", "queued", "ep1"),
        job("b", "running", "ep1", 0.4, "4 из 10"),
        job("c", "queued", "ep1"),
        job("x", "queued", "ep2"),
        job("y", "queued", "ep2"),
        job("z", "running", None),
        job("d", "done", "ep3"),
    ]
    picked = current_jobs(jobs)
    assert {k: v.id for k, v in picked.items()} == {"ep1": "b", "ep2": "y"}

    summary = summarize(None, None, 0, picked["ep1"])
    assert summary.job is not None
    assert summary.job.model_dump() == {
        "kind": "images",
        "status": "running",
        "progress": 0.4,
        "message": "4 из 10",
    }


@pytest.mark.parametrize(
    ("text", "words"),
    [
        ("Sponge. Load. Ram. Prime.", 4),
        ("You don't — and you won’t…", 5),
        ("eighteen inches, 1716", 3),
        ("", 0),
    ],
)
def test_count_words(text: str, words: int) -> None:
    assert count_words(text) == words
