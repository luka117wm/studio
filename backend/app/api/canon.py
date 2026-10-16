"""Канон канала: сводка слоёв, черновики, публикация версий (`docs/canon_schema.md`, «API»).

Слои — `style` (один на канал), `periods/{id}`, `characters/{id}`. У каждого одинаковый набор:
`GET` (`?version=`; без него — черновик или последняя версия), `PUT …/draft`, `POST …/publish`,
`POST …/draft?from=vNNN`, `DELETE …/draft`. Отказы хранилища (`CanonError`) — 404/409 с
текстом в `detail`; форма тела — 422 с ошибками по полям.

«Нужно каналу» (M5.2) — эпохи и облики из планов выпусков без опубликованной версии и скелеты
черновиков для них (`docs/canon_schema.md`, «Нужно каналу»).

Эпоха через мост (M5.6) — промпт черновика или «Дополнить запреты» и приём ответа чата в черновик
эпохи (`docs/bridge.md`, «Эпоха»): публикует человек, стиль и облики мост не пишет.

Опорные (M5.4) — лист портретов облика и кадры стиля: состояние, цена до клика, сборка джобом с
бюджетом канала до очереди, выбор и отбраковка, копия облика в другую эпоху (`docs/canon_schema.md`,
«Листы опорных портретов»).
"""

import sqlite3
from typing import Annotated, Any, cast

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.api.channels import read_profile, require_channel
from app.api.deps import (
    CanonConfigDep,
    DbDep,
    GatewayDep,
    JobsDep,
    PathsDep,
    PromptsDep,
)
from app.api.episodes import channel_episodes, load_sources
from app.cost.budget import BudgetExceeded
from app.jobs.handlers.anchors import (
    ANGLE_KIND,
    SHEET_KIND,
    STYLE_KIND,
    AnchorsEstimate,
    anchors_estimate,
    enqueue_order,
)
from app.jobs.queue import Job
from app.jobs.worker import JobPool
from app.models.canon import (
    Appearance,
    AppearanceId,
    CanonId,
    CanonSummary,
    Character,
    CharacterDoc,
    Period,
    PeriodDoc,
    Style,
    StyleDoc,
    VersionTag,
)
from app.models.director import Channel, StrictModel
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
from app.pipeline.canon import anchors
from app.pipeline.canon.anchors import AnchorOrder, AnchorSetState
from app.pipeline.canon.episode_canon import (
    CanonNeeded,
    EpisodePlan,
    canon_needed,
    published_canon,
)
from app.pipeline.canon.period_bridge import (
    MODES,
    PROMPT_CANON_PERIOD,
    PeriodConflict,
    PeriodMode,
    draft_message,
    forbidden_message,
    merge_draft,
    merge_forbidden,
    parse_draft,
    parse_forbidden,
    period_context,
    period_episodes,
)
from app.providers.base import RouteError
from app.providers.gateway import Gateway
from app.storage import canon_store
from app.storage.canon_store import (
    CHARACTERS,
    PERIODS,
    STYLE,
    CanonConflict,
    CanonError,
    CanonNotFound,
    Entry,
)
from app.storage.paths import StudioPaths

router = APIRouter(prefix="/canon", tags=["canon"])


class CandidatePick(StrictModel):
    """Тело «Выбрать» и «Отбраковать»: id кандидата из состояния листа."""

    candidate: str = Field(min_length=1, max_length=200)


class AppearanceCopy(StrictModel):
    """Тело «Копировать облик в другую эпоху»: эпоха и id нового облика того же персонажа."""

    period: CanonId
    appearance_id: AppearanceId


# Ответ чата на эпоху — несколько килобайт; предел — от вставки не того.
ANSWER_MAX_CHARS = 200_000


class PeriodPrompt(BaseModel):
    """Промпт эпохи для claude.ai и обмен `prompted` в журнале моста."""

    text: str
    prompt_id: str
    version: int
    run_id: str
    period_id: str
    mode: PeriodMode


class PeriodAnswerBody(StrictModel):
    text: str = Field(min_length=1, max_length=ANSWER_MAX_CHARS)


class PeriodAnswerResult(BaseModel):
    """Ответ чата принят в черновик эпохи. `filled`, `conflicts` — у черновика; `added`,
    `repeats` — у «Дополнить запреты»."""

    run_id: str
    period_id: str
    mode: PeriodMode
    doc: PeriodDoc  # черновик после приёма
    filled: list[str]
    conflicts: list[PeriodConflict]
    added: list[str]
    repeats: list[str]
    message: str


class StyleAnchorsCreate(StrictModel):
    """Тело «Пересобрать кадры стиля»: эпоха, в которой показать стиль."""

    period: CanonId


EntityIdParam = CanonId
VersionQuery = Annotated[VersionTag | None, Query()]
FromQuery = Annotated[VersionTag, Query(alias="from")]


async def canon_error(_: Request, exc: Exception) -> JSONResponse:
    """`CanonError` → его код и фраза в `detail`, как у `HTTPException` (L-032)."""
    assert isinstance(exc, CanonError)
    return JSONResponse(status_code=exc.status, content={"detail": str(exc)})


def _doc[D: (StyleDoc, PeriodDoc, CharacterDoc)](cls: type[D], entry: Entry[Any]) -> D:
    return cls(
        draft=entry.version is None,
        version=entry.version,
        based_on=entry.based_on,
        updated_at=entry.updated_at,
        data=entry.data,
    )


def _same_id(path_id: str, body_id: str) -> None:
    """id в теле черновика — тот же, что в адресе: иначе черновик лёг бы не в ту сущность."""
    if body_id != path_id:
        raise RequestValidationError(
            [
                {
                    "type": "canon_id_mismatch",
                    "loc": ("body", "id"),
                    "msg": f"id «{body_id}» в теле не совпадает с адресом «{path_id}» — "
                    "исправьте одно из двух.",
                    "input": body_id,
                }
            ]
        )


@router.get("/{channel}")
async def get_canon(channel: str, paths: PathsDep, db: DbDep) -> CanonSummary:
    require_channel(db, channel)
    return canon_store.summary(paths, channel)


# --- стиль канала --------------------------------------------------------------------------------


@router.get("/{channel}/style")
async def get_style(
    channel: str, paths: PathsDep, db: DbDep, version: VersionQuery = None
) -> StyleDoc:
    require_channel(db, channel)
    return _doc(StyleDoc, canon_store.read_entry(paths, channel, STYLE, None, version))


@router.put("/{channel}/style/draft")
async def put_style_draft(channel: str, body: Style, paths: PathsDep, db: DbDep) -> StyleDoc:
    require_channel(db, channel)
    return _doc(StyleDoc, canon_store.save_draft(paths, channel, STYLE, None, body))


@router.post("/{channel}/style/draft", status_code=201)
async def style_draft_from(channel: str, from_: FromQuery, paths: PathsDep, db: DbDep) -> StyleDoc:
    require_channel(db, channel)
    return _doc(StyleDoc, canon_store.draft_from(paths, channel, STYLE, None, from_))


@router.delete("/{channel}/style/draft", status_code=204)
async def delete_style_draft(channel: str, paths: PathsDep, db: DbDep) -> Response:
    require_channel(db, channel)
    canon_store.discard_draft(paths, channel, STYLE)
    return Response(status_code=204)


@router.post("/{channel}/style/publish", status_code=201)
async def publish_style(channel: str, paths: PathsDep, db: DbDep) -> StyleDoc:
    require_channel(db, channel)
    return _doc(StyleDoc, canon_store.publish(paths, channel, STYLE))


# --- эпохи ---------------------------------------------------------------------------------------


@router.get("/{channel}/periods/{period_id}")
async def get_period(
    channel: str, period_id: EntityIdParam, paths: PathsDep, db: DbDep, version: VersionQuery = None
) -> PeriodDoc:
    require_channel(db, channel)
    return _doc(PeriodDoc, canon_store.read_entry(paths, channel, PERIODS, period_id, version))


@router.put("/{channel}/periods/{period_id}/draft")
async def put_period_draft(
    channel: str, period_id: EntityIdParam, body: Period, paths: PathsDep, db: DbDep
) -> PeriodDoc:
    require_channel(db, channel)
    _same_id(period_id, body.id)
    return _doc(PeriodDoc, canon_store.save_draft(paths, channel, PERIODS, period_id, body))


@router.post("/{channel}/periods/{period_id}/draft", status_code=201)
async def period_draft_from(
    channel: str, period_id: EntityIdParam, from_: FromQuery, paths: PathsDep, db: DbDep
) -> PeriodDoc:
    require_channel(db, channel)
    return _doc(PeriodDoc, canon_store.draft_from(paths, channel, PERIODS, period_id, from_))


@router.delete("/{channel}/periods/{period_id}/draft", status_code=204)
async def delete_period_draft(
    channel: str, period_id: EntityIdParam, paths: PathsDep, db: DbDep
) -> Response:
    require_channel(db, channel)
    canon_store.discard_draft(paths, channel, PERIODS, period_id)
    return Response(status_code=204)


@router.post("/{channel}/periods/{period_id}/publish", status_code=201)
async def publish_period(
    channel: str, period_id: EntityIdParam, paths: PathsDep, db: DbDep
) -> PeriodDoc:
    require_channel(db, channel)
    return _doc(PeriodDoc, canon_store.publish(paths, channel, PERIODS, period_id))


# --- персонажи -----------------------------------------------------------------------------------


@router.get("/{channel}/characters/{character_id}")
async def get_character(
    channel: str,
    character_id: EntityIdParam,
    paths: PathsDep,
    db: DbDep,
    version: VersionQuery = None,
) -> CharacterDoc:
    require_channel(db, channel)
    entry = canon_store.read_entry(paths, channel, CHARACTERS, character_id, version)
    return _doc(CharacterDoc, entry)


@router.put("/{channel}/characters/{character_id}/draft")
async def put_character_draft(
    channel: str, character_id: EntityIdParam, body: Character, paths: PathsDep, db: DbDep
) -> CharacterDoc:
    require_channel(db, channel)
    _same_id(character_id, body.id)
    entry = canon_store.save_draft(paths, channel, CHARACTERS, character_id, body)
    return _doc(CharacterDoc, entry)


@router.post("/{channel}/characters/{character_id}/draft", status_code=201)
async def character_draft_from(
    channel: str, character_id: EntityIdParam, from_: FromQuery, paths: PathsDep, db: DbDep
) -> CharacterDoc:
    require_channel(db, channel)
    entry = canon_store.draft_from(paths, channel, CHARACTERS, character_id, from_)
    return _doc(CharacterDoc, entry)


@router.delete("/{channel}/characters/{character_id}/draft", status_code=204)
async def delete_character_draft(
    channel: str, character_id: EntityIdParam, paths: PathsDep, db: DbDep
) -> Response:
    require_channel(db, channel)
    canon_store.discard_draft(paths, channel, CHARACTERS, character_id)
    return Response(status_code=204)


@router.post("/{channel}/characters/{character_id}/publish", status_code=201)
async def publish_character(
    channel: str, character_id: EntityIdParam, paths: PathsDep, db: DbDep
) -> CharacterDoc:
    require_channel(db, channel)
    return _doc(CharacterDoc, canon_store.publish(paths, channel, CHARACTERS, character_id))


# --- нужно каналу --------------------------------------------------------------------------------


def _channel_plans(paths: StudioPaths, db: sqlite3.Connection, channel: str) -> list[EpisodePlan]:
    """Текущие версии планов выпусков канала, по порядку доски; выпуски без плана пропускаются."""
    plans: list[EpisodePlan] = []
    for episode in channel_episodes(db, channel):
        _, director = load_sources(paths, episode)
        if director is not None:
            plans.append(EpisodePlan(episode.id, episode.title, director))
    return plans


@router.get("/{channel}/needed")
async def get_needed(channel: str, paths: PathsDep, db: DbDep) -> CanonNeeded:
    """Эпохи и облики из `canon_ref` текущих версий планов канала, у которых нет ни одной
    опубликованной версии: какие выпуски и сколько кадров на них ссылаются."""
    require_channel(db, channel)
    return canon_needed(
        channel, _channel_plans(paths, db, channel), published_canon(paths, channel)
    )


@router.post("/{channel}/needed/periods/{period_id}", status_code=201)
async def create_needed_period(
    channel: str, period_id: EntityIdParam, paths: PathsDep, db: DbDep
) -> PeriodDoc:
    """Скелет-черновик эпохи: только id. Опубликованная эпоха или начатый черновик — 409."""
    require_channel(db, channel)
    versions = canon_store.list_versions(paths, channel, PERIODS, period_id)
    if versions:
        raise CanonConflict(
            f"Эпоха {period_id} уже опубликована ({versions[-1].version}) — создавать её не нужно."
        )
    try:
        canon_store.read_entry(paths, channel, PERIODS, period_id)
    except CanonNotFound:
        entry = canon_store.save_draft(paths, channel, PERIODS, period_id, Period(id=period_id))
        return _doc(PeriodDoc, entry)
    raise CanonConflict(
        f"У эпохи {period_id} уже есть черновик — откройте его на экране «Канон» и опубликуйте."
    )


@router.post("/{channel}/needed/appearances/{appearance_id}", status_code=201)
async def create_needed_appearance(
    channel: str, appearance_id: AppearanceId, paths: PathsDep, db: DbDep
) -> CharacterDoc:
    """Скелет облика в черновике персонажа: черновик есть — облик дописывается в него, нет —
    черновик начинается с последней версии, персонажа нет — создаётся. Облик уже опубликован или
    уже в черновике — 409."""
    require_channel(db, channel)
    return _doc(CharacterDoc, _appearance_skeleton(paths, channel, appearance_id))


def _appearance_skeleton(paths: StudioPaths, channel: str, appearance_id: str) -> Entry[Character]:
    character_id = appearance_id.split("@", 1)[0]
    for info in reversed(canon_store.list_versions(paths, channel, CHARACTERS, character_id)):
        published = canon_store.read_entry(paths, channel, CHARACTERS, character_id, info.version)
        if published.data.appearance(appearance_id) is not None:
            raise CanonConflict(
                f"Облик {appearance_id} уже опубликован в characters/{character_id}/"
                f"{info.version} — создавать его не нужно."
            )
    skeleton = Appearance(id=appearance_id)
    try:
        entry = canon_store.read_entry(paths, channel, CHARACTERS, character_id)
    except CanonNotFound:
        character = Character(id=character_id, appearances=[skeleton])
        return canon_store.save_draft(paths, channel, CHARACTERS, character_id, character)
    if entry.data.appearance(appearance_id) is not None:
        raise CanonConflict(
            f"Облик {appearance_id} уже есть в черновике персонажа {character_id} — откройте его "
            "на экране «Канон» и опубликуйте."
        )
    character = entry.data.model_copy(update={"appearances": [*entry.data.appearances, skeleton]})
    return canon_store.save_draft(paths, channel, CHARACTERS, character_id, character)


# --- эпоха через мост ----------------------------------------------------------------------------


def _mode(value: str) -> PeriodMode:
    if value not in MODES:
        raise RequestValidationError(
            [
                {
                    "type": "period_mode",
                    "loc": ("query", "mode"),
                    "msg": f"Режима «{value}» нет: ожидалось draft (черновик) или forbidden"
                    " (дополнить запреты).",
                    "input": value,
                }
            ]
        )
    return value


def _current_period(paths: StudioPaths, channel: str, period_id: str) -> Entry[Period] | None:
    """Черновик эпохи, без него — последняя версия, без неё — ничего."""
    try:
        return canon_store.read_entry(paths, channel, PERIODS, period_id)
    except CanonNotFound:
        return None


def _render_period(
    paths: StudioPaths,
    db: sqlite3.Connection,
    prompts: PromptLibrary,
    channel: str,
    period_id: str,
    mode: PeriodMode,
    current: Period | None,
) -> RenderedPrompt:
    episodes = period_episodes(period_id, _channel_plans(paths, db, channel))
    context = period_context(read_profile(paths, channel), period_id, mode, episodes, current)
    return prompts.render(PROMPT_CANON_PERIOD, context)


def _need_period_for_forbidden(current: Entry[Period] | None, period_id: str) -> Entry[Period]:
    if current is None:
        raise CanonConflict(
            f"У эпохи {period_id} нет ни черновика, ни версий — дополнять нечего: сначала соберите"
            " черновик через мост или заполните его вручную."
        )
    return current


@router.post("/{channel}/periods/{period_id}/prompt")
async def period_prompt(
    channel: str,
    period_id: EntityIdParam,
    paths: PathsDep,
    db: DbDep,
    prompts: PromptsDep,
    mode: str = "draft",
) -> PeriodPrompt:
    """Промпт эпохи для claude.ai: черновик (`draft`) или «Дополнить запреты» (`forbidden`), обмен
    `prompted` в журнале моста. Мост бесплатен: ни вызовов, ни строк расхода."""
    require_channel(db, channel)
    chosen = _mode(mode)
    current = _current_period(paths, channel, period_id)
    if chosen == "forbidden":
        _need_period_for_forbidden(current, period_id)
    prompt = _render_period(
        paths, db, prompts, channel, period_id, chosen, current.data if current else None
    )
    run = open_run(
        db, task="canon_period", channel=cast(Channel, channel), prompt=prompt, target_id=period_id
    )
    return PeriodPrompt(
        text=prompt.text,
        prompt_id=prompt.prompt_id,
        version=prompt.version,
        run_id=run.id,
        period_id=period_id,
        mode=chosen,
    )


@router.post("/{channel}/periods/{period_id}/answer")
async def period_answer(
    channel: str,
    period_id: EntityIdParam,
    body: PeriodAnswerBody,
    paths: PathsDep,
    db: DbDep,
    prompts: PromptsDep,
    mode: str = "draft",
) -> PeriodAnswerResult:
    """Ответ чата → черновик эпохи. `draft`: пустые поля из ответа, заполненные человеком — как
    были, несовпадения — `conflicts`. `forbidden`: новые запреты без повторов. Неверный ответ —
    422 `BridgeError`, на диске ничего не меняется. Публикует человек."""
    require_channel(db, channel)
    chosen = _mode(mode)
    current = _current_period(paths, channel, period_id)
    if chosen == "forbidden":
        _need_period_for_forbidden(current, period_id)
    latest = latest_runs(
        db, task="canon_period", channel=cast(Channel, channel), target_id=period_id, limit=1
    )
    opened = latest[0] if latest and latest[0].status == "prompted" else None

    def journal(status: AnswerStatus, errors: list[BridgeIssue]) -> BridgeRun:
        if opened is not None:
            return close_run(db, opened.id, status, errors)
        prompt = _render_period(
            paths, db, prompts, channel, period_id, chosen, current.data if current else None
        )
        return record_answer(
            db,
            task="canon_period",
            channel=cast(Channel, channel),
            prompt=prompt,
            status=status,
            errors=errors,
            target_id=period_id,
        )

    base = current.data if current is not None else Period(id=period_id)
    filled: list[str] = []
    conflicts: list[PeriodConflict] = []
    added: list[str] = []
    repeats: list[str] = []
    try:
        data = extract_json(body.text)
        if chosen == "draft":
            merged = merge_draft(base, parse_draft(data))
            period, message = merged.period, draft_message(merged)
            filled, conflicts = merged.filled, merged.conflicts
        else:
            more = merge_forbidden(base, parse_forbidden(data))
            period, message = more.period, forbidden_message(more)
            added, repeats = more.added, more.repeats
    except BridgeAnswerError as exc:
        journal("failed", exc.errors or [BridgeIssue(path="", message=exc.message)])
        raise
    entry = canon_store.save_draft(paths, channel, PERIODS, period_id, period)
    run = journal("applied", [])
    return PeriodAnswerResult(
        run_id=run.id,
        period_id=period_id,
        mode=chosen,
        doc=_doc(PeriodDoc, entry),
        filled=filled,
        conflicts=conflicts,
        added=added,
        repeats=repeats,
        message=message,
    )


# --- опорные: лист портретов облика, кадры стиля -------------------------------------------------


def _enqueue(db: DbDep, gateway: Gateway, jobs: JobPool, kind: str, order: AnchorOrder) -> Job:
    """Джоб заказа: бюджет канала до очереди — 409 с телом `BudgetRefusal`, джоб не создаётся."""
    try:
        job = enqueue_order(db, gateway, kind, order)
    except RouteError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except BudgetExceeded as exc:
        raise HTTPException(status_code=409, detail=exc.detail()) from exc
    jobs.kick()
    return job


@router.get("/{channel}/appearances/{appearance_id}/anchors")
async def get_appearance_anchors(
    channel: str, appearance_id: AppearanceId, paths: PathsDep, db: DbDep, config: CanonConfigDep
) -> AnchorSetState:
    """Лист облика: ракурсы с кандидатами и выбором, готовность 6/6, устаревание против последней
    опубликованной версии персонажа с этим обликом, оплаченное."""
    require_channel(db, channel)
    return anchors.appearance_anchors(paths, channel, appearance_id, config)


@router.get("/{channel}/appearances/{appearance_id}/anchors/estimate")
async def get_anchors_estimate(
    channel: str,
    appearance_id: AppearanceId,
    db: DbDep,
    gateway: GatewayDep,
    config: CanonConfigDep,
) -> AnchorsEstimate:
    """Цена до клика: лист, перегенерация ракурса, кадры стиля."""
    require_channel(db, channel)
    return anchors_estimate(gateway, config)


@router.post("/{channel}/appearances/{appearance_id}/anchors", status_code=201)
async def collect_sheet(
    channel: str,
    appearance_id: AppearanceId,
    paths: PathsDep,
    db: DbDep,
    gateway: GatewayDep,
    jobs: JobsDep,
    prompts: PromptsDep,
    config: CanonConfigDep,
) -> Job:
    """«Собрать лист»: джоб `anchor_sheet` — фасы, затем остальные ракурсы с фасом-референсом."""
    require_channel(db, channel)
    order = anchors.sheet_order(paths, channel, appearance_id, config, prompts)
    return _enqueue(db, gateway, jobs, SHEET_KIND, order)


@router.post("/{channel}/appearances/{appearance_id}/anchors/{angle}/regenerate", status_code=201)
async def regenerate_angle(
    channel: str,
    appearance_id: AppearanceId,
    angle: str,
    paths: PathsDep,
    db: DbDep,
    gateway: GatewayDep,
    jobs: JobsDep,
    prompts: PromptsDep,
    config: CanonConfigDep,
) -> Job:
    """«Перегенерировать ракурс»: джоб `anchor_angle` — новые кандидаты одного ракурса."""
    require_channel(db, channel)
    order = anchors.angle_order(paths, channel, appearance_id, angle, config, prompts)
    return _enqueue(db, gateway, jobs, ANGLE_KIND, order)


@router.post("/{channel}/appearances/{appearance_id}/anchors/{angle}/choose")
async def choose_candidate(
    channel: str,
    appearance_id: AppearanceId,
    angle: str,
    body: CandidatePick,
    paths: PathsDep,
    db: DbDep,
    config: CanonConfigDep,
) -> AnchorSetState:
    require_channel(db, channel)
    anchors.choose(paths, channel, appearance_id, angle, body.candidate, config)
    return anchors.appearance_anchors(paths, channel, appearance_id, config)


@router.post("/{channel}/appearances/{appearance_id}/anchors/{angle}/reject")
async def reject_candidate(
    channel: str,
    appearance_id: AppearanceId,
    angle: str,
    body: CandidatePick,
    paths: PathsDep,
    db: DbDep,
    config: CanonConfigDep,
) -> AnchorSetState:
    require_channel(db, channel)
    anchors.reject(paths, db, channel, appearance_id, angle, body.candidate, config)
    return anchors.appearance_anchors(paths, channel, appearance_id, config)


@router.post("/{channel}/appearances/{appearance_id}/copy", status_code=201)
async def copy_appearance(
    channel: str, appearance_id: AppearanceId, body: AppearanceCopy, paths: PathsDep, db: DbDep
) -> CharacterDoc:
    """Копия облика в другую эпоху — в черновик персонажа; лист у копии свой, пустой."""
    require_channel(db, channel)
    character_id = appearance_id.split("@", 1)[0]
    if not body.appearance_id.startswith(f"{character_id}@"):
        raise RequestValidationError(
            [
                {
                    "type": "canon_appearance_owner",
                    "loc": ("body", "appearance_id"),
                    "msg": f"Облик {body.appearance_id} не принадлежит персонажу {character_id} — "
                    f"id облика начинается с «{character_id}@».",
                    "input": body.appearance_id,
                }
            ]
        )
    entry = canon_store.copy_appearance(
        paths, channel, appearance_id, body.appearance_id, body.period
    )
    return _doc(CharacterDoc, entry)


@router.get("/{channel}/style/anchors")
async def get_style_anchors(
    channel: str, paths: PathsDep, db: DbDep, config: CanonConfigDep
) -> AnchorSetState:
    """Кадры стиля: по шаблону, устаревание против последней версии стиля."""
    require_channel(db, channel)
    return anchors.style_anchors(paths, channel, config)


@router.post("/{channel}/style/anchors", status_code=201)
async def collect_style_anchors(
    channel: str,
    body: StyleAnchorsCreate,
    paths: PathsDep,
    db: DbDep,
    gateway: GatewayDep,
    jobs: JobsDep,
    prompts: PromptsDep,
    config: CanonConfigDep,
) -> Job:
    """«Пересобрать кадры стиля»: джоб `style_anchors` — по кадру на шаблон в эпохе `period`."""
    require_channel(db, channel)
    order = anchors.style_order(paths, channel, body.period, config, prompts)
    return _enqueue(db, gateway, jobs, STYLE_KIND, order)
