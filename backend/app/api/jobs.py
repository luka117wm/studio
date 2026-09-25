"""Джобы: постановка, список со сводкой пачки, отмена, поток событий SSE.

Контракт — `docs/jobs.md`.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Header, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ValidationError

from app.api.deps import DbDep, GatewayDep, JobsDep, PathsDep
from app.api.episodes import require_episode
from app.cost.budget import BudgetExceeded
from app.jobs import queue
from app.jobs.events import SSE_HEADERS, stream_events
from app.jobs.queue import Job, JobStatus, JobSummary, NewJob
from app.models.director import StrictModel
from app.providers.base import RouteError
from app.settings import Settings

router = APIRouter(tags=["jobs"])


class JobCreate(StrictModel):
    kind: str
    payload: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=256)
    episode_id: str | None = None
    batch_id: str | None = Field(default=None, min_length=1, max_length=128)


class JobList(BaseModel):
    items: list[Job]
    summary: JobSummary
    # Курсор журнала на момент снимка: подписка `GET /api/events?last_event_id=` без пропусков.
    last_event_id: int


def _require_job(db: DbDep, job_id: str) -> Job:
    job = queue.get_job(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Джоб «{job_id}» не найден.")
    return job


@router.post("/jobs", status_code=201)
async def create_job(
    body: JobCreate, response: Response, db: DbDep, jobs: JobsDep, gateway: GatewayDep
) -> Job:
    """201 — поставлен новый; 200 — джоб с этим `idempotency_key` уже есть, возвращается он.
    Платный вид — бюджет до постановки: 409 с текстом, джоб не создаётся (`docs/providers.md`)."""
    spec = jobs.handlers.get(body.kind)
    if spec is None:
        known = ", ".join(sorted(jobs.handlers)) or "нет"
        raise HTTPException(
            status_code=422, detail=f"Неизвестный тип джоба «{body.kind}». Доступны: {known}."
        )
    try:
        payload = spec.payload_model.model_validate(body.payload)
    except ValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Payload для «{body.kind}» не прошёл проверку: {exc.errors(include_url=False)}",
        ) from exc
    if body.episode_id is not None:
        require_episode(db, body.episode_id)
    cost_usd_micro: int | None = None
    cost_stage: str | None = None
    # Повтор с тем же ключом вернёт существующий джоб — бюджет за него уже проверен.
    repeat = (
        body.idempotency_key is not None
        and queue.get_job_by_key(db, body.idempotency_key) is not None
    )
    if spec.estimate is not None and not repeat:
        if body.episode_id is None:
            raise HTTPException(
                status_code=422,
                detail=f"Платный джоб «{body.kind}» ставится только с episode_id: бюджет"
                " считается по выпуску и его каналу.",
            )
        try:
            cost = spec.estimate(gateway, payload)
            gateway.check_budget(db, cost, episode_id=body.episode_id)
        except RouteError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except BudgetExceeded as exc:
            raise HTTPException(status_code=409, detail=exc.detail()) from exc
        cost_usd_micro, cost_stage = cost.usd_micro, cost.stage
    job, created = queue.enqueue(
        db,
        NewJob(
            kind=body.kind,
            payload=payload.model_dump(mode="json"),
            idempotency_key=body.idempotency_key,
            episode_id=body.episode_id,
            batch_id=body.batch_id,
            cost_usd_micro=cost_usd_micro,
            cost_stage=cost_stage,
        ),
    )
    if created:
        jobs.kick()
    else:
        response.status_code = 200
    return job


@router.get("/jobs")
async def list_jobs(
    db: DbDep,
    batch: str | None = None,
    episode: str | None = None,
    status: JobStatus | None = None,
    kind: str | None = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 200,
) -> JobList:
    items, summary, cursor = queue.list_jobs(
        db, status=status, episode_id=episode, batch_id=batch, kind=kind, limit=limit
    )
    return JobList(items=items, summary=summary, last_event_id=cursor)


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, db: DbDep) -> Job:
    return _require_job(db, job_id)


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str, db: DbDep, jobs: JobsDep) -> Job:
    """`queued` → `cancelled` сразу; у `running` — флаг, джоб остановится на следующем шаге."""
    job = queue.request_cancel(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Джоб «{job_id}» не найден.")
    if job.status in ("done", "failed"):
        raise HTTPException(
            status_code=409,
            detail=f"Джоб «{job_id}» уже завершён со статусом «{job.status}», отменять нечего.",
        )
    jobs.kick()
    return job


@router.get("/events", response_class=StreamingResponse)
async def events(
    request: Request,
    paths: PathsDep,
    jobs: JobsDep,
    last_event_id: Annotated[int | None, Header(ge=0)] = None,
    since: Annotated[int | None, Query(alias="last_event_id", ge=0)] = None,
) -> StreamingResponse:
    """Один поток SSE на клиента: все события джобов и heartbeat.

    Курсор — заголовок `Last-Event-ID` (EventSource шлёт его сам при переподключении) или
    `?last_event_id=` (первое подключение после снимка `GET /api/jobs`); заголовок новее.
    """
    settings: Settings = request.app.state.settings
    after_id = last_event_id if last_event_id is not None else since
    return StreamingResponse(
        stream_events(
            paths.db_path, jobs.bus, after_id, settings.sse_heartbeat_s, request.is_disconnected
        ),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )
