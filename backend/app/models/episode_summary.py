"""Сводка выпуска для карточки доски: кадры, слова VO, длительность, расход, текущий джоб.

В БД не хранится: считается при чтении из project.json, текущей версии плана, журнала расходов и
очереди джобов. Функции чистые — файлы и БД читает вызывающий (`api/episodes.py`), сюда приходят
готовые модели. Контракт полей — `docs/episodes.md`.
"""

import re
from collections import Counter
from collections.abc import Iterable
from typing import Literal

from app.jobs.queue import Job
from app.models.director import Director, StrictModel
from app.models.project import Project, ShotState, TimingSource

# Оценка длительности до озвучки; тот же темп, что `voice.pace_wpm` по умолчанию в плане.
ESTIMATE_WPM = 150
DurationSource = Literal["voice", "estimate", "target"]

# Слово — буквы и цифры, апостроф внутри (`don't`); тире и многоточия словами не считаются.
_WORD_RE = re.compile(r"\w+(?:['’]\w+)*")
# Тайминги, измеренные по голосу или заданные вручную; `estimate` — ещё не голос.
_MEASURED: frozenset[TimingSource] = frozenset({"voice", "locked"})
_NO_STATE = ShotState()


class EpisodeJob(StrictModel):
    """Джоб, который сейчас занят выпуском."""

    kind: str
    status: Literal["queued", "running"]
    progress: float
    message: str | None


class EpisodeSummary(StrictModel):
    # Кадры текущей версии плана без `removed`; `todo` и `queued` входят только в total.
    shots_total: int
    shots_done: int
    shots_failed: int
    shots_stale: int
    shots_generating: int
    vo_words: int
    # Секунды; источник — см. `summarize`. Без плана — null.
    duration_s: float | None
    duration_source: DurationSource | None
    # Потрачено по выпуску (`charged` + резерв `estimated`), микродоллары.
    spent_usd_micro: int
    job: EpisodeJob | None


def count_words(text: str) -> int:
    return len(_WORD_RE.findall(text))


def current_jobs(jobs: Iterable[Job]) -> dict[str, Job]:
    """Выпуск → его текущий джоб: `running` важнее `queued`, при равенстве — поставленный позже.

    `jobs` — активные джобы в порядке постановки (`queue.active_jobs`).
    """
    out: dict[str, Job] = {}
    for job in jobs:
        if job.episode_id is None or job.status not in ("queued", "running"):
            continue
        held = out.get(job.episode_id)
        if held is None or job.status == "running" or held.status == "queued":
            out[job.episode_id] = job
    return out


def summarize(
    project: Project | None, director: Director | None, spent_usd_micro: int, job: Job | None
) -> EpisodeSummary:
    """Длительность — первое, что есть: сумма таймингов, если у каждого кадра он измерен голосом
    или задан вручную (`voice`); иначе слова VO при `ESTIMATE_WPM` (`estimate`); иначе
    `target_minutes` плана (`target`). Без плана кадров нет и длительности тоже."""
    brief = (
        None
        if job is None or job.status not in ("queued", "running")
        else EpisodeJob(
            kind=job.kind, status=job.status, progress=job.progress, message=job.message
        )
    )
    if director is None:
        return EpisodeSummary(
            shots_total=0,
            shots_done=0,
            shots_failed=0,
            shots_stale=0,
            shots_generating=0,
            vo_words=0,
            duration_s=None,
            duration_source=None,
            spent_usd_micro=spent_usd_micro,
            job=brief,
        )

    states = project.shots if project is not None else {}
    timings = project.timings if project is not None else {}
    shots = [s for s in director.shots if states.get(s.id, _NO_STATE).status != "removed"]
    statuses = Counter(states.get(s.id, _NO_STATE).status for s in shots)
    words = sum(count_words(s.vo) for s in shots)

    duration: float
    source: DurationSource
    if shots and all(s.id in timings and timings[s.id].source in _MEASURED for s in shots):
        duration, source = sum(timings[s.id].duration for s in shots), "voice"
    elif words:
        duration, source = words * 60 / ESTIMATE_WPM, "estimate"
    else:
        duration, source = director.meta.target_minutes * 60.0, "target"

    return EpisodeSummary(
        shots_total=len(shots),
        shots_done=statuses["done"],
        shots_failed=statuses["failed"],
        shots_stale=statuses["stale"],
        shots_generating=statuses["generating"],
        vo_words=words,
        duration_s=round(duration, 3),
        duration_source=source,
        spent_usd_micro=spent_usd_micro,
        job=brief,
    )
