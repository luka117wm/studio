"""Идеи канала (устав M4, решение 9): бэклог, правка и статусы, идеи через мост.

Хранение — таблица `ideas` (миграция 007); разбор ответа чата — `pipeline/research/ideas.py`.
Промпт и ответ — строки журнала `bridge_runs` (`task: ideas`, канал). Ответ без единой принятой
идеи — 422 `BridgeError`, ничего не пишется. Контракт — `docs/research.md`, «Идеи».
"""

import re
import sqlite3

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.channels import read_profile, require_channel
from app.api.deps import DbDep, FormatsDep, PathsDep, PromptsDep
from app.api.episodes import DEFAULT_TITLE
from app.models.director import Channel, StrictModel
from app.models.formats import FormatsConfig
from app.models.idea import (
    STATUS_TEXT,
    TRANSITIONS,
    Idea,
    IdeaCreate,
    IdeaPatch,
    IdeaProposal,
    IdeaSource,
    IdeaStatus,
)
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
from app.pipeline.research.ideas import (
    DEFAULT_COUNT,
    MAX_COUNT,
    PROMPT_IDEAS,
    Skipped,
    avoid_titles,
    ideas_context,
    review_proposals,
    title_key,
)
from app.pipeline.script.plan_bridge import plural
from app.storage.db import now_iso
from app.storage.paths import StudioPaths

router = APIRouter(tags=["ideas"])

# Ответ на шесть идей — несколько килобайт; предел — от вставки не того.
ANSWER_MAX_CHARS = 200_000
_COLUMNS = (
    "id, channel, title, angle, hook_promise, summary, score, score_reason, source, status,"
    " episode_id, created_at, updated_at"
)
_ID = re.compile(r"i(\d+)")
# Чем занято название при приёме ответа: дубль идеи (кроме отброшенных) или выпуска канала.
_TAKEN: dict[str, str] = {
    "backlog": "уже в бэклоге",
    "proposed": "уже предложена",
    "used": "уже взята в выпуск",
}
TAKEN_BY_EPISODE = "уже есть выпуск с таким названием"
HINT_FIX_IDEAS = (
    "Попросите чат исправить идеи из списка ошибок и прислать ответ целиком одним блоком ```json."
)


class IdeasPromptBody(StrictModel):
    channel: Channel
    count: int = Field(default=DEFAULT_COUNT, ge=1, le=MAX_COUNT)


class IdeasPrompt(BaseModel):
    """Промпт идей для кнопки «Скопировать»; обмен открыт (`run_id`)."""

    text: str
    prompt_id: str
    version: int
    run_id: str
    count: int


class IdeasAnswerBody(StrictModel):
    channel: Channel
    text: str = Field(max_length=ANSWER_MAX_CHARS)


class SkippedIdea(BaseModel):
    """Несохранённая идея ответа: номер в ответе с 1, название (если разобралось), причина."""

    index: int
    title: str | None
    reason: str


class IdeasAnswerResult(BaseModel):
    run_id: str
    # Сохранены как `proposed`, `source: bridge`, в порядке ответа.
    created: list[Idea]
    skipped: list[SkippedIdea]


# --- хранение ------------------------------------------------------------------------------------


def find_idea(db: sqlite3.Connection, idea_id: str) -> Idea | None:
    row = db.execute(f"SELECT {_COLUMNS} FROM ideas WHERE id = ?", (idea_id,)).fetchone()
    return None if row is None else Idea.model_validate(dict(row))


def require_idea(db: sqlite3.Connection, idea_id: str) -> Idea:
    idea = find_idea(db, idea_id)
    if idea is None:
        raise HTTPException(status_code=404, detail=f"Идея «{idea_id}» не найдена.")
    return idea


def insert_ideas(
    db: sqlite3.Connection,
    channel: Channel,
    ideas: list[IdeaCreate] | list[IdeaProposal],
    *,
    source: IdeaSource,
    status: IdeaStatus,
) -> list[str]:
    """Номера `i0001…` и вставка — одна транзакция `BEGIN IMMEDIATE`: второй писатель ждёт коммита
    и видит занятые номера (L-021)."""
    db.execute("BEGIN IMMEDIATE")
    try:
        rows = db.execute("SELECT id FROM ideas").fetchall()
        matches = [_ID.fullmatch(row["id"]) for row in rows]
        number = max((int(m.group(1)) for m in matches if m), default=0)
        ids: list[str] = []
        stamp = now_iso()
        for idea in ideas:
            number += 1
            idea_id = f"i{number:04d}"
            db.execute(
                f"INSERT INTO ideas ({_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
                (
                    idea_id,
                    channel,
                    idea.title,
                    idea.angle,
                    idea.hook_promise,
                    idea.summary,
                    idea.score,
                    idea.score_reason,
                    source,
                    status,
                    stamp,
                    stamp,
                ),
            )
            ids.append(idea_id)
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return ids


def _titles(db: sqlite3.Connection, sql: str, params: tuple[str, ...]) -> list[str]:
    return [row[0] for row in db.execute(sql, params)]


def _episode_titles(db: sqlite3.Connection, channel: Channel) -> list[str]:
    """Названия выпусков канала, кроме названия по умолчанию — оно ничего не говорит о теме."""
    return _titles(
        db,
        "SELECT title FROM episodes WHERE channel = ? AND title != ? ORDER BY created_at, rowid",
        (channel, DEFAULT_TITLE),
    )


def _taken(db: sqlite3.Connection, channel: Channel) -> dict[str, str]:
    """Названия, которые чат не должен повторить: идеи канала (кроме отброшенных) и выпуски."""
    taken = {title_key(title): TAKEN_BY_EPISODE for title in _episode_titles(db, channel)}
    rows = db.execute(
        "SELECT title, status FROM ideas WHERE channel = ? AND status != 'dropped'", (channel,)
    )
    for row in rows:
        taken.setdefault(title_key(row["title"]), _TAKEN[row["status"]])
    return taken


# --- бэклог --------------------------------------------------------------------------------------


@router.get("/ideas")
async def list_ideas(
    db: DbDep, channel: Channel | None = None, status: IdeaStatus | None = None
) -> list[Idea]:
    """Новые первыми; без фильтров — все идеи обоих каналов."""
    where: list[str] = []
    params: list[str] = []
    for column, value in (("channel", channel), ("status", status)):
        if value is not None:
            where.append(f"{column} = ?")
            params.append(value)
    sql = f"SELECT {_COLUMNS} FROM ideas"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC, rowid DESC"
    return [Idea.model_validate(dict(row)) for row in db.execute(sql, params)]


@router.post("/ideas", status_code=201)
async def create_idea(body: IdeaCreate, db: DbDep) -> Idea:
    """Идея руками — сразу в бэклог (`source: manual`)."""
    require_channel(db, body.channel)
    (idea_id,) = insert_ideas(db, body.channel, [body], source="manual", status="backlog")
    return require_idea(db, idea_id)


@router.patch("/ideas/{idea_id}")
async def patch_idea(idea_id: str, body: IdeaPatch, db: DbDep) -> Idea:
    """Тексты и оценка — всегда; статус — по `TRANSITIONS`, неверный переход — 409 с текстом."""
    idea = require_idea(db, idea_id)
    changes = {field: getattr(body, field) for field in body.model_fields_set}
    status = changes.pop("status", None)
    if status is not None and status != idea.status:
        _check_transition(idea, status)
        changes["status"] = status
    if changes:
        changes["updated_at"] = now_iso()
        assignments = ", ".join(f"{column} = ?" for column in changes)
        db.execute(f"UPDATE ideas SET {assignments} WHERE id = ?", (*changes.values(), idea.id))
        db.commit()
    return require_idea(db, idea.id)


def _check_transition(idea: Idea, status: IdeaStatus) -> None:
    if status == "used":
        raise HTTPException(
            status_code=409,
            detail="Статус «взята в выпуск» ставит создание выпуска из идеи: «Начать выпуск» "
            "(POST /api/episodes с idea_id).",
        )
    allowed = TRANSITIONS[idea.status]
    if status not in allowed:
        options = ", ".join(f"«{STATUS_TEXT[s]}»" for s in sorted(allowed)) or "никуда"
        raise HTTPException(
            status_code=409,
            detail=f"Идею со статусом «{STATUS_TEXT[idea.status]}» нельзя перевести в "
            f"«{STATUS_TEXT[status]}»: можно {options}.",
        )


# --- мост -----------------------------------------------------------------------------------------


def _render(
    db: sqlite3.Connection,
    paths: StudioPaths,
    formats: FormatsConfig,
    prompts: PromptLibrary,
    channel: Channel,
    count: int,
) -> RenderedPrompt:
    profile = read_profile(paths, channel)
    # Бэклог, затем предложенные: ещё не решены, но повтор чат потратит впустую — приём его отсеет
    backlog = _titles(
        db,
        "SELECT title FROM ideas WHERE channel = ? AND status IN ('backlog', 'proposed')"
        " ORDER BY status = 'proposed', created_at, rowid",
        (channel,),
    )
    avoid = avoid_titles(backlog, _episode_titles(db, channel))
    context = ideas_context(profile, formats.formats[profile.format], avoid, count)
    return prompts.render(PROMPT_IDEAS, context)


@router.post("/ideas/prompt")
async def ideas_prompt(
    body: IdeasPromptBody, db: DbDep, paths: PathsDep, formats: FormatsDep, prompts: PromptsDep
) -> IdeasPrompt:
    """Промпт идей канала и новый обмен `prompted` в журнале моста."""
    require_channel(db, body.channel)
    prompt = _render(db, paths, formats, prompts, body.channel, body.count)
    run = open_run(db, task="ideas", channel=body.channel, prompt=prompt)
    return IdeasPrompt(
        text=prompt.text,
        prompt_id=prompt.prompt_id,
        version=prompt.version,
        run_id=run.id,
        count=body.count,
    )


@router.post("/ideas/answer")
async def ideas_answer(
    body: IdeasAnswerBody, db: DbDep, paths: PathsDep, formats: FormatsDep, prompts: PromptsDep
) -> IdeasAnswerResult:
    """Ответ чата → идеи `proposed`. Битая идея и дубль пропускаются с причиной; ни одной принятой —
    422 `BridgeError`. Обмен закрывается в журнале: открытый — этим ответом, иначе — новой строкой.
    Без `await` между проверкой дублей и записью: относительно других запросов приём последователен.
    """
    require_channel(db, body.channel)
    latest = latest_runs(db, task="ideas", channel=body.channel, limit=1)
    opened = latest[0] if latest and latest[0].status == "prompted" else None

    def journal(status: AnswerStatus, errors: list[BridgeIssue]) -> BridgeRun:
        if opened is not None:
            return close_run(db, opened.id, status, errors)
        prompt = _render(db, paths, formats, prompts, body.channel, DEFAULT_COUNT)
        return record_answer(
            db, task="ideas", channel=body.channel, prompt=prompt, status=status, errors=errors
        )

    try:
        review = review_proposals(extract_json(body.text), _taken(db, body.channel))
        if not review.accepted:
            count = len(review.skipped)
            word = plural(count, "пропущена", "пропущены", "пропущено")
            raise BridgeAnswerError(
                f"Ни одна идея не принята: {count} {word}.",
                HINT_FIX_IDEAS,
                _issues(review.skipped),
            )
    except BridgeAnswerError as exc:
        journal("failed", exc.errors or [BridgeIssue(path="", message=exc.message)])
        raise

    ids = insert_ideas(db, body.channel, review.accepted, source="bridge", status="proposed")
    run = journal("applied", _issues(review.skipped))
    return IdeasAnswerResult(
        run_id=run.id,
        created=[require_idea(db, idea_id) for idea_id in ids],
        skipped=[
            SkippedIdea(index=s.index, title=s.title, reason=s.reason) for s in review.skipped
        ],
    )


def _issues(skipped: list[Skipped]) -> list[BridgeIssue]:
    """Пропуски — в ошибки обмена: путь в JSON ответа и «идея 3: …» для человека."""
    return [
        BridgeIssue(path=f"ideas[{s.index - 1}]", message=f"идея {s.index}: {s.reason}")
        for s in skipped
    ]
