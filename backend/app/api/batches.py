"""Пачка кадров (M6.3): постановка, смета, сводка, пауза, продолжение, отмена, «Повторить упавшие».
Логика — `pipeline/images/batch.py`; контракт — `docs/generation.md`, «Пачка», и `docs/jobs.md`.
"""

from collections.abc import Callable

from fastapi import APIRouter, HTTPException
from pydantic import Field

from app.api.deps import CanonConfigDep, DbDep, GatewayDep, JobsDep, PathsDep
from app.api.director import read_version
from app.api.episodes import require_episode
from app.cost.budget import BudgetExceeded
from app.jobs.queue import BatchSummary, batch_summary
from app.jobs.worker import JobPool
from app.models.director import StrictModel
from app.models.project import Project
from app.pipeline.images import batch
from app.pipeline.images.batch import BatchEstimate, BatchNotFound, BatchRefused, BatchResult
from app.pipeline.images.shot_job import SHOT_KIND
from app.providers.base import RouteError
from app.storage.atomic import read_json

router = APIRouter(tags=["batches"])


class BatchCreate(StrictModel):
    """Тело `POST …/generate`: кадры (нет — без картинки и `stale`), модель (ключ каталога
    `images` или ID модели; нет — профиль по умолчанию), `redraw` — новый вариант и у готовых."""

    shots: list[str] | None = Field(default=None, min_length=1)
    model: str | None = Field(default=None, min_length=1)
    redraw: bool = False


class RetryFailed(StrictModel):
    """Тело `POST /api/batches/{id}/retry-failed`: кадры явно (так повторяются и отказы модели
    без правки); нет — все упавшие, кроме таких отказов."""

    shots: list[str] | None = Field(default=None, min_length=1)


@router.post("/projects/{episode_id}/generate", status_code=201)
async def generate(
    episode_id: str,
    body: BatchCreate,
    paths: PathsDep,
    db: DbDep,
    gateway: GatewayDep,
    config: CanonConfigDep,
    jobs: JobsDep,
) -> BatchResult:
    """Пачка кадров выпуска: смета и бюджет — суммой до очереди, пачка и джобы — одной
    транзакцией. 409 — план не утверждён, рисовать нечего, кадр занят (`BatchRefusal`) или не
    влезает в бюджет (`BudgetRefusal` с суммой пачки); 422 — модель не из каталога."""
    episode = require_episode(db, episode_id)
    project = Project.model_validate(read_json(paths.project_path(episode.channel, episode.id)))
    director = read_version(paths, episode, project.director_version)
    try:
        selection = batch.select_shots(
            paths,
            gateway,
            config,
            channel=episode.channel,
            project=project,
            director=director,
            shots=body.shots,
            model=body.model,
            redraw=body.redraw,
        )
        result = batch.create_batch(
            db,
            paths,
            gateway,
            selection,
            episode_id=episode.id,
            channel=episode.channel,
            parallel=_parallel(jobs),
        )
    except RouteError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except BatchRefused as exc:
        raise HTTPException(status_code=409, detail=exc.refusal.model_dump(mode="json")) from exc
    except BudgetExceeded as exc:
        raise HTTPException(status_code=409, detail=exc.detail()) from exc
    jobs.kick()
    return result


@router.get("/projects/{episode_id}/generate/estimate")
async def generate_estimate(
    episode_id: str,
    paths: PathsDep,
    db: DbDep,
    gateway: GatewayDep,
    config: CanonConfigDep,
    shots: str | None = None,
    model: str | None = None,
    redraw: bool = False,
) -> BatchEstimate:
    """Смета пачки до клика — те же кадры, что поставит `POST …/generate` с этими полями.
    `shots` — id через запятую. Ничего не пишет."""
    episode = require_episode(db, episode_id)
    project = Project.model_validate(read_json(paths.project_path(episode.channel, episode.id)))
    director = read_version(paths, episode, project.director_version)
    wanted = [s.strip() for s in shots.split(",") if s.strip()] if shots else None
    try:
        selection = batch.select_shots(
            paths,
            gateway,
            config,
            channel=episode.channel,
            project=project,
            director=director,
            shots=wanted,
            model=model,
            redraw=redraw,
        )
    except RouteError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except BatchRefused as exc:
        raise HTTPException(status_code=409, detail=exc.refusal.model_dump(mode="json")) from exc
    return batch.estimate(gateway, selection)


@router.get("/batches/{batch_id}")
async def get_batch(batch_id: str, db: DbDep) -> BatchSummary:
    summary = batch_summary(db, batch_id)
    if summary is None:
        raise HTTPException(status_code=404, detail=str(BatchNotFound(batch_id)))
    return summary


@router.post("/batches/{batch_id}/pause")
async def pause_batch(batch_id: str, db: DbDep) -> BatchSummary:
    """Пул не берёт `queued` пачки, идущие доделывают; пауза переживает перезапуск."""
    return _found(lambda: batch.set_paused(db, batch_id, True))


@router.post("/batches/{batch_id}/resume")
async def resume_batch(batch_id: str, db: DbDep, jobs: JobsDep) -> BatchSummary:
    summary = _found(lambda: batch.set_paused(db, batch_id, False))
    jobs.kick()
    return summary


@router.post("/batches/{batch_id}/cancel")
async def cancel_batch(batch_id: str, db: DbDep, paths: PathsDep, jobs: JobsDep) -> BatchSummary:
    """`queued` пачки — `cancelled`, начатые дорисуются; отменённые джобы остаются в истории."""
    summary = _found(lambda: batch.cancel(db, paths, batch_id))
    jobs.kick()
    return summary


@router.post("/batches/{batch_id}/retry-failed", status_code=201)
async def retry_failed(
    batch_id: str,
    body: RetryFailed,
    paths: PathsDep,
    db: DbDep,
    gateway: GatewayDep,
    config: CanonConfigDep,
    jobs: JobsDep,
) -> BatchResult:
    """Новая пачка из упавших кадров этой: тот же вариант и модель, запрос — по действующему плану.
    Отказ модели без правки запроса — только явно, иначе в `warnings`."""
    summary = batch_summary(db, batch_id)
    if summary is None:
        raise HTTPException(status_code=404, detail=str(BatchNotFound(batch_id)))
    episode = require_episode(db, summary.episode_id)
    project = Project.model_validate(read_json(paths.project_path(episode.channel, episode.id)))
    director = read_version(paths, episode, project.director_version)
    try:
        result = batch.retry_failed(
            db,
            paths,
            gateway,
            config,
            batch_id,
            channel=episode.channel,
            project=project,
            director=director,
            parallel=_parallel(jobs),
            shots=body.shots,
        )
    except BatchRefused as exc:
        raise HTTPException(status_code=409, detail=exc.refusal.model_dump(mode="json")) from exc
    except BudgetExceeded as exc:
        raise HTTPException(status_code=409, detail=exc.detail()) from exc
    jobs.kick()
    return result


def _found(action: Callable[[], BatchSummary]) -> BatchSummary:
    try:
        return action()
    except BatchNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _parallel(jobs: JobPool) -> int:
    """Сколько кадров рисуется одновременно — для оценки времени пачки."""
    spec = jobs.handlers.get(SHOT_KIND)
    return max(1, spec.max_parallel if spec is not None and spec.max_parallel else 1)
