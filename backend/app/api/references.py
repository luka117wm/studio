"""Референсы канала (устав M4, решение 10): субтитры, разбор через мост, метрики, выпуск по
структуре.

Хранение — таблица `reference_videos` (миграция 008); разбор субтитров, приём разбора и метрики —
`pipeline/research/`. Промпт и ответ — строки журнала `bridge_runs` (`task: reference`,
`target_id` — id референса). Сеть не используется: ссылка только хранится. Текст референса в промпт
плана не идёт (принцип 11). Контракт — `docs/research.md`, «Референс».
"""

import json
import re
import sqlite3

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.channels import read_profile, require_channel
from app.api.deps import DbDep, FormatsDep, PathsDep, PromptsDep
from app.api.episodes import EpisodeCreate, EpisodeListItem, episode_item, insert_episode
from app.models.director import Channel, StrictModel
from app.models.formats import FormatsConfig
from app.models.project import EpisodeBrief
from app.models.reference import ReferenceAnalysis, ReferenceMode, ReferenceVideo
from app.pipeline.bridge import (
    BridgeAnswerError,
    BridgeIssue,
    BridgeRun,
    PromptLibrary,
    RenderedPrompt,
    close_run,
    extract_json,
    latest_runs,
    open_run,
    record_answer,
)
from app.pipeline.bridge.runs import AnswerStatus
from app.pipeline.research.reference import (
    PROMPT_REFERENCE,
    metrics,
    reference_context,
    reference_structure,
    review_analysis,
)
from app.pipeline.research.subtitles import SubtitlesError, parse_subtitles
from app.storage.db import now_iso
from app.storage.paths import StudioPaths

router = APIRouter(tags=["references"])

# Субтитры часового ролика — сотни килобайт; предел — от вставки не того.
TEXT_MAX_CHARS = 2_000_000
_COLUMNS = (
    "id, channel, url, title, author, duration_s, subtitles, analysis, created_at, analyzed_at"
)
_ID = re.compile(r"ref(\d+)")


class ReferenceCreate(StrictModel):
    channel: Channel
    # Ссылка на ролик — только для памяти: сеть не используется.
    url: str = Field(default="", max_length=500)
    subtitles: str = Field(max_length=TEXT_MAX_CHARS)


class ReferencePrompt(BaseModel):
    """Промпт разбора для кнопки «Скопировать»; обмен открыт (`run_id`)."""

    text: str
    prompt_id: str
    version: int
    run_id: str


class ReferenceAnswer(StrictModel):
    text: str = Field(max_length=TEXT_MAX_CHARS)


class ReferenceEpisodeCreate(StrictModel):
    """«Новая тема по этой структуре» (`structure_clone`) или «Своя версия этой темы»
    (`own_version`)."""

    mode: ReferenceMode


# --- хранение ------------------------------------------------------------------------------------


def _row(db: sqlite3.Connection, reference_id: str) -> sqlite3.Row:
    row: sqlite3.Row | None = db.execute(
        f"SELECT {_COLUMNS} FROM reference_videos WHERE id = ?", (reference_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Референс «{reference_id}» не найден.")
    return row


def _norm_wpm(paths: StudioPaths, formats: FormatsConfig, channel: str) -> int:
    """Темп пресета нашего канала — норма для сравнения темпа референса."""
    return formats.formats[read_profile(paths, channel).format].words_per_minute


def to_video(row: sqlite3.Row, norm_wpm: int) -> ReferenceVideo:
    """Строка таблицы → ответ API: реплики разбираются заново (текст хранится как вставлен),
    метрики считаются при чтении — при смене пресета они следуют за нормой."""
    cues = parse_subtitles(row["subtitles"])
    analysis = (
        None
        if row["analysis"] is None
        else ReferenceAnalysis.model_validate(json.loads(row["analysis"]))
    )
    return ReferenceVideo(
        id=row["id"],
        channel=row["channel"],
        url=row["url"],
        title=row["title"],
        author=row["author"],
        duration_s=row["duration_s"],
        cues=len(cues),
        subtitles=row["subtitles"],
        analysis=analysis,
        metrics=None if analysis is None else metrics(cues, analysis, row["duration_s"], norm_wpm),
        created_at=row["created_at"],
        analyzed_at=row["analyzed_at"],
    )


def reference_text(db: sqlite3.Connection, reference_id: str) -> str | None:
    """Текст реплик референса одной строкой — для сходства; референса нет — None."""
    row = db.execute(
        "SELECT subtitles FROM reference_videos WHERE id = ?", (reference_id,)
    ).fetchone()
    if row is None:
        return None
    return " ".join(cue.text for cue in parse_subtitles(row["subtitles"]))


def structure_for(
    db: sqlite3.Connection, paths: StudioPaths, formats: FormatsConfig, brief: EpisodeBrief | None
) -> dict[str, object] | None:
    """Структура референса для промпта плана; выпуск не по референсу или он не разобран — None."""
    if brief is None or brief.reference_id is None or brief.reference_mode == "none":
        return None
    row = db.execute(
        f"SELECT {_COLUMNS} FROM reference_videos WHERE id = ?", (brief.reference_id,)
    ).fetchone()
    if row is None or row["analysis"] is None:
        return None
    video = to_video(row, _norm_wpm(paths, formats, row["channel"]))
    assert video.analysis is not None and video.metrics is not None
    return reference_structure(video.analysis, video.metrics, brief.reference_mode)


# --- CRUD -----------------------------------------------------------------------------------------


@router.post("/references", status_code=201)
async def create_reference(
    body: ReferenceCreate, db: DbDep, paths: PathsDep, formats: FormatsDep
) -> ReferenceVideo:
    """Субтитры разбираются сразу: не похоже на субтитры — 422 с тем, что вставить."""
    require_channel(db, body.channel)
    try:
        cues = parse_subtitles(body.subtitles)
    except SubtitlesError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    db.execute("BEGIN IMMEDIATE")
    try:
        rows = db.execute("SELECT id FROM reference_videos").fetchall()
        matches = [_ID.fullmatch(row["id"]) for row in rows]
        number = max((int(m.group(1)) for m in matches if m), default=0) + 1
        reference_id = f"ref{number:04d}"
        db.execute(
            "INSERT INTO reference_videos (id, channel, url, duration_s, subtitles, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (reference_id, body.channel, body.url.strip(), cues[-1].end, body.subtitles, now_iso()),
        )
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return to_video(_row(db, reference_id), _norm_wpm(paths, formats, body.channel))


@router.get("/references")
async def list_references(
    db: DbDep, paths: PathsDep, formats: FormatsDep, channel: Channel | None = None
) -> list[ReferenceVideo]:
    """Новые первыми; без `channel` — оба канала."""
    sql = f"SELECT {_COLUMNS} FROM reference_videos"
    params: tuple[str, ...] = ()
    if channel is not None:
        sql += " WHERE channel = ?"
        params = (channel,)
    rows = db.execute(sql + " ORDER BY created_at DESC, rowid DESC", params).fetchall()
    return [to_video(row, _norm_wpm(paths, formats, row["channel"])) for row in rows]


@router.get("/references/{reference_id}")
async def get_reference(
    reference_id: str, db: DbDep, paths: PathsDep, formats: FormatsDep
) -> ReferenceVideo:
    row = _row(db, reference_id)
    return to_video(row, _norm_wpm(paths, formats, row["channel"]))


# --- мост -----------------------------------------------------------------------------------------


def _render(
    row: sqlite3.Row, paths: StudioPaths, formats: FormatsConfig, prompts: PromptLibrary
) -> RenderedPrompt:
    profile = read_profile(paths, row["channel"])
    cues = parse_subtitles(row["subtitles"])
    context = reference_context(profile, formats.formats[profile.format], cues, row["duration_s"])
    return prompts.render(PROMPT_REFERENCE, context)


@router.post("/references/{reference_id}/prompt")
async def reference_prompt(
    reference_id: str, db: DbDep, paths: PathsDep, formats: FormatsDep, prompts: PromptsDep
) -> ReferencePrompt:
    """Промпт разбора референса и новый обмен `prompted` в журнале моста."""
    row = _row(db, reference_id)
    prompt = _render(row, paths, formats, prompts)
    run = open_run(
        db, task="reference", channel=row["channel"], prompt=prompt, target_id=reference_id
    )
    return ReferencePrompt(
        text=prompt.text, prompt_id=prompt.prompt_id, version=prompt.version, run_id=run.id
    )


@router.post("/references/{reference_id}/answer")
async def reference_answer(
    reference_id: str,
    body: ReferenceAnswer,
    db: DbDep,
    paths: PathsDep,
    formats: FormatsDep,
    prompts: PromptsDep,
) -> ReferenceVideo:
    """Ответ чата → разбор референса (`title`, `author` — из него). Ошибка — 422 `BridgeError`,
    разбор не меняется; обмен закрывается в журнале. Повторный разбор заменяет прежний."""
    row = _row(db, reference_id)
    latest = latest_runs(db, task="reference", target_id=reference_id, limit=1)
    opened = latest[0] if latest and latest[0].status == "prompted" else None

    def journal(status: AnswerStatus, errors: list[BridgeIssue]) -> BridgeRun:
        if opened is not None:
            return close_run(db, opened.id, status, errors)
        return record_answer(
            db,
            task="reference",
            channel=row["channel"],
            prompt=_render(row, paths, formats, prompts),
            status=status,
            errors=errors,
            target_id=reference_id,
        )

    try:
        analysis = review_analysis(extract_json(body.text), row["duration_s"])
    except BridgeAnswerError as exc:
        journal("failed", exc.errors or [BridgeIssue(path="", message=exc.message)])
        raise
    db.execute(
        "UPDATE reference_videos SET analysis = ?, title = ?, author = ?, analyzed_at = ?"
        " WHERE id = ?",
        (
            analysis.model_dump_json(),
            analysis.title.strip(),
            analysis.author.strip(),
            now_iso(),
            reference_id,
        ),
    )
    db.commit()
    journal("applied", [])
    return to_video(_row(db, reference_id), _norm_wpm(paths, formats, row["channel"]))


# --- выпуск по референсу -------------------------------------------------------------------------


@router.post("/references/{reference_id}/episodes", status_code=201)
async def create_reference_episode(
    reference_id: str, body: ReferenceEpisodeCreate, db: DbDep, paths: PathsDep
) -> EpisodeListItem:
    """Выпуск канала референса, `origin: reference`, название «Новый выпуск» — чужое не переносим.
    Заявка: `reference_id`, `reference_mode`; идея — тема разбора для `own_version`, пустая для
    `structure_clone` (тему выбирает пользователь). Разбора нет — 409."""
    row = _row(db, reference_id)
    if row["analysis"] is None:
        raise HTTPException(
            status_code=409,
            detail="Сначала разберите референс: скопируйте промпт разбора и вставьте ответ чата.",
        )
    analysis = ReferenceAnalysis.model_validate(json.loads(row["analysis"]))
    brief = EpisodeBrief(
        idea=analysis.topic if body.mode == "own_version" else "",
        reference_id=reference_id,
        reference_mode=body.mode,
    )
    episode_id = insert_episode(
        db, paths, EpisodeCreate(channel=row["channel"], origin="reference"), brief=brief
    )
    return episode_item(db, paths, episode_id)
