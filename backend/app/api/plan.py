"""План через мост: промпт части k, приём ответа чата, состояние набора частей.

Части, контекст промптов и подстановка `canon_ref`/`voice` — `pipeline/script/plan_bridge.py`;
импорт — общий с ручным путём `import_plan` (M2.4, `source: bridge`). Каждый промпт и ответ —
строка журнала `bridge_runs`. Неверный ответ — 422 `BridgeError`, на диске ничего не меняется.
Контракт — `docs/bridge.md`, раздел «План».

Здесь же — действующий план для экрана 3 (версия плюс ручные правки, `effective_plan`), проверка
плана из JSON-редактора без записи (`director/validate`), смета плана и «Утвердить план» (M4.6).
"""

import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.api.bridge import PlanSourceDep
from app.api.channels import read_profile
from app.api.deps import DbDep, FormatsDep, GatewayDep, PathsDep, PromptsDep, ReferenceConfigDep
from app.api.director import (
    PartsPending,
    identity_items,
    import_plan,
    read_version,
    removed_shots,
    staged_parts,
)
from app.api.episodes import (
    Episode,
    EpisodeListItem,
    episode_item,
    mark_plan_approved,
    require_episode,
)
from app.api.references import reference_text, structure_for
from app.cost.budget import (
    ANIMATION_STAGE,
    BudgetLevel,
    Committed,
    committed_episode,
    committed_month,
    load_budgets,
)
from app.models.channel import ChannelProfile
from app.models.director import Director, StrictModel
from app.models.formats import FormatPreset, FormatsConfig
from app.models.project import Project
from app.models.reference import ReferenceConfig, SimilarityReport
from app.models.validators import DirectorValidationError, ValidationItem, validate_director
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
from app.pipeline.director_import import EffectivePlan, ImportResult, effective_plan
from app.pipeline.director_import.merge import director_to_json
from app.pipeline.research.similarity import similarity
from app.pipeline.script.approve import (
    ApprovalSubject,
    ReferenceText,
    approval_problems,
    refusal,
)
from app.pipeline.script.estimate import PlanEstimate, plan_estimate
from app.pipeline.script.plan_bridge import (
    PROMPT_FIRST,
    PROMPT_NEXT,
    Expected,
    PartRange,
    build_canon_ref,
    errors_word,
    expected_part,
    first_context,
    issue_path,
    last_shot_number,
    next_context,
    part_range,
    parts_word,
    prepare_part,
    voice_for,
)
from app.storage.atomic import read_json, write_json_atomic
from app.storage.db import now_iso
from app.storage.paths import StudioPaths

router = APIRouter(tags=["plan"])

# Ответ чата на часть из 26 кадров — десятки килобайт; предел — от вставки не того.
ANSWER_MAX_CHARS = 2_000_000


class PlanPrompt(BaseModel):
    """Промпт части для кнопки «Скопировать»; обмен открыт (`run_id`)."""

    text: str
    prompt_id: str
    version: int
    run_id: str
    part: int
    parts_total: int
    # Диапазон кадров части; у последней — до конца плана по пресету.
    first_shot: str
    last_shot: str


class PlanAnswer(StrictModel):
    text: str = Field(max_length=ANSWER_MAX_CHARS)


class PlanAnswerResult(BaseModel):
    """Часть принята: что дальше — следующая часть или итог импорта версии."""

    run_id: str
    part: int
    parts_total: int
    shots_in_part: int
    received: list[int]
    # Следующая недостающая часть; null — план собран и импортирован.
    next_part: int | None
    import_result: ImportResult | None
    # Подменённые блоки, факты без источника — принято, но стоит посмотреть.
    warnings: list[str]


class PlanParts(BaseModel):
    """Состояние набора частей для панели моста на экране 3."""

    parts_total: int
    shots_per_part: int
    received: list[int]
    # null — все части на месте (сборка не прошла — можно прислать исправленную часть).
    next_part: int | None
    last_run: BridgeRun | None


class PlanCheck(BaseModel):
    """Проверка плана без записи: `errors` — строки, как у импорта; `items` — они же по кадрам."""

    ok: bool
    errors: list[str]
    items: list[ValidationItem]


@dataclass(frozen=True)
class _Plan:
    episode: Episode
    profile: ChannelProfile
    preset: FormatPreset
    project: Project
    staged: list[Director]
    preset_total: int
    shots_per_part: int
    # Структура референса для части 1 (без текста реплик, принцип 11); не по референсу — None
    reference: dict[str, object] | None


def _load(
    paths: StudioPaths, db: sqlite3.Connection, formats: FormatsConfig, episode_id: str
) -> _Plan:
    episode = require_episode(db, episode_id)
    profile = read_profile(paths, episode.channel)
    preset = formats.formats[profile.format]
    project = Project.model_validate(read_json(paths.project_path(episode.channel, episode.id)))
    return _Plan(
        episode=episode,
        profile=profile,
        preset=preset,
        project=project,
        staged=staged_parts(paths, episode),
        preset_total=formats.plan.parts_total(preset),
        shots_per_part=formats.plan.shots_per_part,
        reference=structure_for(db, paths, formats, project.brief),
    )


def _render(plan: _Plan, prompts: PromptLibrary, part: int) -> tuple[RenderedPrompt, PartRange]:
    """Промпт части: 1 — по пресету, k — продолжение принятых частей 1…k−1."""
    brief, spp = plan.project.brief, plan.shots_per_part
    if part == 1:
        rng = part_range(1, plan.preset_total, spp, plan.preset.shots, 0)
        context = first_context(
            plan.profile, plan.preset, plan.episode.id, brief, rng, plan.reference
        )
        return prompts.render(PROMPT_FIRST, context), rng
    accepted = [d for d in plan.staged if d.meta.part < part]
    total = plan.staged[0].meta.parts_total
    rng = part_range(part, total, spp, plan.preset.shots, last_shot_number(accepted))
    context = next_context(
        plan.profile, plan.preset, plan.episode.id, brief, rng, accepted, plan.reference
    )
    return prompts.render(PROMPT_NEXT, context), rng


def _latest_run(db: sqlite3.Connection, episode_id: str) -> BridgeRun | None:
    runs = latest_runs(db, episode_id=episode_id, task="plan", limit=1)
    return runs[0] if runs else None


@router.post("/projects/{episode_id}/plan/prompt")
async def plan_prompt(
    episode_id: str,
    paths: PathsDep,
    db: DbDep,
    formats: FormatsDep,
    prompts: PromptsDep,
    part: int = Query(default=1, ge=1),
) -> PlanPrompt:
    """Промпт части `part` и новый обмен `prompted`. Без заявки — 409; части k без 1…k−1 — 409."""
    plan = _load(paths, db, formats, episode_id)
    brief = plan.project.brief
    if brief is None or not brief.idea.strip():
        raise HTTPException(
            status_code=409,
            detail="Сначала заполните заявку: без идеи чату не из чего писать план.",
        )
    if part > 1:
        received = [d.meta.part for d in plan.staged]
        if 1 not in received:
            raise HTTPException(
                status_code=409,
                detail=f"Сначала вставьте ответ на часть 1 — промпт части {part} продолжает её.",
            )
        total = plan.staged[0].meta.parts_total
        if part > total:
            raise HTTPException(
                status_code=422,
                detail=f"В плане {total} {parts_word(total)} — промпта части {part} нет.",
            )
        missing = [n for n in range(1, part) if n not in received]
        if missing:
            raise HTTPException(
                status_code=409,
                detail=f"Сначала вставьте ответ на часть {missing[0]} — промпт части {part}"
                " продолжает её.",
            )
    prompt, rng = _render(plan, prompts, part)
    run = open_run(
        db,
        task="plan",
        channel=plan.episode.channel,
        prompt=prompt,
        episode_id=plan.episode.id,
        part=rng.part,
        parts_total=rng.parts_total,
    )
    return PlanPrompt(
        text=prompt.text,
        prompt_id=prompt.prompt_id,
        version=prompt.version,
        run_id=run.id,
        part=rng.part,
        parts_total=rng.parts_total,
        first_shot=rng.first_shot,
        last_shot=rng.last_shot,
    )


@router.post("/projects/{episode_id}/plan/answer")
async def plan_answer(
    episode_id: str,
    body: PlanAnswer,
    paths: PathsDep,
    db: DbDep,
    formats: FormatsDep,
    prompts: PromptsDep,
    gateway: GatewayDep,
) -> PlanAnswerResult:
    """Ответ чата → часть в набор или, после последней, версия плана `source: bridge`.

    Ошибка — 422 `BridgeError`, обмен закрывается `failed` с ошибками; диск не меняется. Без
    `await` между чтением набора и импортом: относительно других запросов приём последователен.
    """
    plan = _load(paths, db, formats, episode_id)
    latest = _latest_run(db, episode_id)
    opened = latest if latest is not None and latest.status == "prompted" else None
    expected = expected_part(
        None if opened is None else (opened.part, opened.parts_total),
        plan.staged,
        plan.preset_total,
    )
    voice = voice_for(plan.profile, plan.preset, gateway.registry.resolve("voice"))
    first = next((d for d in plan.staged if d.meta.part == 1), None)

    journal_part = expected.part
    # Ответ без открытого обмена пишется в журнал с промптом, который выдало бы приложение, — его
    # надо собрать до импорта: после него набор частей очищен.
    orphan_prompt: RenderedPrompt | None = None
    try:
        data = extract_json(body.text)
        journal_part = _claimed_part(data, expected)
        if opened is None:
            orphan_prompt, _ = _render(plan, prompts, journal_part)
        prepared = prepare_part(
            data,
            episode_id=plan.episode.id,
            channel=plan.episode.channel,
            expected=expected,
            voice=voice,
            first_part=first,
        )
        director = prepared.director
        if director.meta.part > 1:
            _extend_first_part_canon(paths, plan, director)
        try:
            outcome = import_plan(paths, db, plan.episode, director, "bridge")
        except HTTPException as exc:
            raise _import_error(exc, director.meta.part) from None
    except BridgeAnswerError as exc:
        issues = exc.errors or [BridgeIssue(path="", message=exc.message)]
        if opened is None and orphan_prompt is None:
            orphan_prompt, _ = _render(plan, prompts, journal_part)
        _journal(db, plan, opened, orphan_prompt, journal_part, expected, "failed", issues)
        raise

    run = _journal(db, plan, opened, orphan_prompt, journal_part, expected, "applied", [])
    total = director.meta.parts_total
    if isinstance(outcome, PartsPending):
        received, next_part, result = outcome.received, outcome.missing[0], None
    else:
        received, next_part, result = list(range(1, total + 1)), None, outcome
    return PlanAnswerResult(
        run_id=run.id,
        part=director.meta.part,
        parts_total=total,
        shots_in_part=len(director.shots),
        received=received,
        next_part=next_part,
        import_result=result,
        warnings=prepared.warnings,
    )


@router.get("/projects/{episode_id}/plan/parts")
async def plan_parts(episode_id: str, paths: PathsDep, db: DbDep, formats: FormatsDep) -> PlanParts:
    plan = _load(paths, db, formats, episode_id)
    latest = _latest_run(db, episode_id)
    received = [d.meta.part for d in plan.staged]
    if 1 in received:
        total = plan.staged[0].meta.parts_total
    elif latest is not None and latest.status == "prompted":
        total = latest.parts_total
    else:
        total = plan.preset_total
    missing = [n for n in range(1, total + 1) if n not in received]
    return PlanParts(
        parts_total=total,
        shots_per_part=plan.shots_per_part,
        received=received,
        next_part=missing[0] if missing else None,
        last_run=latest,
    )


@router.get("/projects/{episode_id}/plan")
async def get_plan(episode_id: str, paths: PathsDep, db: DbDep) -> EffectivePlan | None:
    """Действующий план: текущая версия с ручными правками; `null` — план ещё не импортирован."""
    episode = require_episode(db, episode_id)
    project = Project.model_validate(read_json(paths.project_path(episode.channel, episode.id)))
    director = read_version(paths, episode, project.director_version)
    if director is None:
        return None
    return effective_plan(director, project, removed_shots(paths, episode, project, director))


@router.post("/projects/{episode_id}/director/validate")
async def validate_plan(episode_id: str, body: dict[str, Any], db: DbDep) -> PlanCheck:
    """План или часть — те же проверки, что у импорта (`POST …/director`), но без записи.

    `canon_ref` и `voice` проверяются как есть: редактор присылает их из текущей версии.
    """
    episode = require_episode(db, episode_id)
    try:
        director = validate_director(body)
    except DirectorValidationError as exc:
        return PlanCheck(ok=False, errors=exc.errors, items=exc.items)
    items = identity_items(director, episode)
    return PlanCheck(ok=not items, errors=[item.message for item in items], items=items)


@router.get("/projects/{episode_id}/estimate")
async def get_estimate(
    episode_id: str,
    paths: PathsDep,
    db: DbDep,
    gateway: GatewayDep,
    formats: FormatsDep,
    plan_source: PlanSourceDep,
) -> PlanEstimate:
    """Смета действующего плана и остаток бюджетов канала после выпуска. Без плана — 409."""
    episode = require_episode(db, episode_id)
    project = Project.model_validate(read_json(paths.project_path(episode.channel, episode.id)))
    director = read_version(paths, episode, project.director_version)
    if director is None:
        raise HTTPException(
            status_code=409,
            detail="Плана ещё нет — смета появится, когда план будет собран: вставьте ответ чата"
            " или импортируйте JSON.",
        )
    now = datetime.now(UTC)
    committed: dict[BudgetLevel, Committed] = {
        "month": committed_month(db, episode.channel, now),
        "episode": committed_episode(db, episode.id),
        "animation": committed_episode(db, episode.id, ANIMATION_STAGE),
    }
    return plan_estimate(
        effective_plan(director, project),
        gateway,
        plan_source,
        load_budgets(paths, episode.channel),
        committed,
        formats.estimate,
    )


def _reference_check(
    db: sqlite3.Connection, project: Project, config: ReferenceConfig
) -> ReferenceText | None:
    """Текст референса выпуска и правило сходства; выпуск не по референсу — None."""
    reference_id = project.brief.reference_id if project.brief else None
    text = None if reference_id is None else reference_text(db, reference_id)
    if text is None:
        return None
    return ReferenceText(text=text, ngram=config.ngram, threshold=config.max_similarity)


@router.get("/projects/{episode_id}/similarity")
async def get_similarity(
    episode_id: str, paths: PathsDep, db: DbDep, config: ReferenceConfigDep
) -> SimilarityReport:
    """Сходство VO действующего плана с текстом референса (принцип 11). Нет плана или выпуск не по
    референсу — `similarity: null` с причиной."""
    episode = require_episode(db, episode_id)
    project = Project.model_validate(read_json(paths.project_path(episode.channel, episode.id)))
    reference = _reference_check(db, project, config)
    if reference is None:
        return SimilarityReport(
            similarity=None, reason="Выпуск не по референсу — сравнивать не с чем."
        )
    director = read_version(paths, episode, project.director_version)
    if director is None:
        return SimilarityReport(similarity=None, reason="Плана ещё нет — сравнивать нечего.")
    plan = effective_plan(director, project)
    vo = [shot.vo for shot in plan.shots if shot.status != "removed"]
    found = similarity(vo, reference.text, reference.ngram, reference.threshold)
    return SimilarityReport(similarity=found, reason=None)


@router.post("/episodes/{episode_id}/approve")
async def approve_plan(
    episode_id: str, paths: PathsDep, db: DbDep, config: ReferenceConfigDep
) -> EpisodeListItem:
    """«Утвердить план»: проверки → `approved_version` и `approved_at` в project.json → стадия
    `generate`. Отказ — 409, `detail` — `ApprovalRefusal`. Повтор для утверждённой версии — 200
    без записи. Джобов не ставит, бюджет не резервирует (M6).

    Без `await` между чтением и записью: относительно импорта и правок утверждение
    последовательно (L-014). Сначала project.json, потом стадия: после сбоя между ними повтор
    доводит дело до конца.
    """
    episode = require_episode(db, episode_id)
    path = paths.project_path(episode.channel, episode.id)
    project = Project.model_validate(read_json(path))
    director = read_version(paths, episode, project.director_version)
    staged = [] if director is not None else staged_parts(paths, episode)
    subject = ApprovalSubject(
        stage=episode.stage,
        plan=None if director is None else effective_plan(director, project),
        staged_parts=[part.meta.part for part in staged],
        parts_total=staged[0].meta.parts_total if staged else 0,
        reference=_reference_check(db, project, config),
    )
    problems = approval_problems(subject)
    if problems:
        raise HTTPException(status_code=409, detail=refusal(problems).model_dump(mode="json"))
    if project.approved_version == project.director_version and episode.stage == "generate":
        return episode_item(db, paths, episode.id)

    now = now_iso()
    approved = project.model_copy(
        update={"approved_version": project.director_version, "approved_at": now, "updated_at": now}
    )
    write_json_atomic(path, approved.model_dump(mode="json"))
    mark_plan_approved(db, episode.id)
    return episode_item(db, paths, episode.id)


# --- вспомогательное ------------------------------------------------------------------------------


def _claimed_part(data: dict[str, object], expected: Expected) -> int:
    """Часть, которой назвался ответ, если она допустима; иначе — ожидаемая (для журнала)."""
    meta = data.get("meta")
    part = meta.get("part", 1) if isinstance(meta, dict) else None
    return part if isinstance(part, int) and part in expected.allowed else expected.part


def _extend_first_part_canon(paths: StudioPaths, plan: _Plan, director: Director) -> None:
    """`canon_ref` набора — по кадрам всех частей: облик, впервые появившийся в части 3, иначе не
    прошёл бы проверку собранного плана. Сборка M2.4 берёт `canon_ref` из части 1 — её и
    дополняем. Части 1 нет (набор сброшен) — нечего дополнять: импорт ответит, что её не хватает."""
    others = [d for d in plan.staged if d.meta.part != director.meta.part]
    first = next((d for d in others if d.meta.part == 1), None)
    if first is None:
        return
    shots = [s.model_dump(mode="json") for d in [*others, director] for s in d.shots]
    canon = build_canon_ref(shots)
    if first.canon_ref != canon:
        write_json_atomic(
            paths.director_part_path(plan.episode.channel, plan.episode.id, 1),
            director_to_json(first.model_copy(update={"canon_ref": canon})),
        )


def _import_error(exc: HTTPException, part: int) -> BridgeAnswerError:
    """Ошибка сборки набора (M2.4) → ошибка ответа: части остаются, исправленную можно прислать."""
    detail = exc.detail
    if isinstance(detail, dict) and isinstance(detail.get("errors"), list):
        errors = [str(e) for e in detail["errors"]]
        return BridgeAnswerError(
            f"План не собрался из частей: {len(errors)} {errors_word(len(errors))}.",
            "Попросите чат исправить часть, о которой ошибка, и вставьте её — остальные части"
            " уже приняты.",
            [BridgeIssue(path=issue_path(e), message=e) for e in errors],
        )
    message = detail.get("message") if isinstance(detail, dict) else str(detail)
    return BridgeAnswerError(
        str(message), f"Скопируйте промпт части 1 и начните набор заново (ответ на часть {part})."
    )


def _journal(
    db: sqlite3.Connection,
    plan: _Plan,
    opened: BridgeRun | None,
    orphan_prompt: RenderedPrompt | None,
    part: int,
    expected: Expected,
    status: AnswerStatus,
    errors: list[BridgeIssue],
) -> BridgeRun:
    if opened is not None:
        return close_run(db, opened.id, status, errors)
    assert orphan_prompt is not None
    return record_answer(
        db,
        task="plan",
        channel=plan.episode.channel,
        prompt=orphan_prompt,
        status=status,
        errors=errors,
        episode_id=plan.episode.id,
        part=part,
        parts_total=expected.parts_total.get(part, plan.preset_total),
    )
