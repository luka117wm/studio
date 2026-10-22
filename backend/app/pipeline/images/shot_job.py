"""Джоб кадра `shot_image` (M6.2; устав M6, решения 2, 3, 6): заказ, отрисовка, версия кадра.

Заказ собирается при постановке: план утверждён (принцип 10), кадр — в действующем плане, запрос
собран сборщиком M5.5 без проблем, модель — из каталога `images`, бюджет — до очереди (принцип 6).
Payload — заказ целиком (`ShotOrder`): перезапуск после аварии рисует тот же вариант.

Джоб: тот же хэш уже среди версий кадра — та же версия, без вызова и денег; иначе шлюз отдаёт
`cached` (готовый файл, $0) или `charged`, и файл становится новой версией кадра (L-042). Отказ
модели, ошибка запроса и бюджет в момент вызова — кадр `failed` с причиной, без повтора; сеть и
5xx — кадр `failed`, пока очередь не повторит. Контракт — `docs/generation.md`, «Джоб кадра».
"""

import asyncio
import sqlite3
from typing import Any, Literal, NoReturn

from pydantic import BaseModel, Field

from app.cost.budget import BudgetExceeded
from app.jobs import queue
from app.jobs.queue import Job, NewJob
from app.jobs.worker import JobContext, TransientError
from app.models.canon_config import CanonConfig
from app.models.director import EPISODE_ID_PATTERN, SHOT_ID_PATTERN, Channel, Director, StrictModel
from app.models.project import Project
from app.pipeline.canon.episode_canon import plan_canon_ref
from app.pipeline.director_import import effective_plan
from app.pipeline.images import shot_assets
from app.pipeline.images.prompt_builder import IMAGES_STAGE, PromptProblem, build_shot_request
from app.pipeline.images.shot_assets import Drawing
from app.pipeline.script.plan_bridge import plural
from app.providers.base import Cost, ImageRequest, ProviderError, RouteError
from app.providers.gateway import CallContext, Gateway
from app.storage.atomic import read_json
from app.storage.paths import StudioPaths

SHOT_KIND = "shot_image"
_ON_SCRIPT = " на экране «Сценарий»"

RefusalCode = Literal["plan_not_approved", "shot_problems", "shot_busy"]


class ShotOrder(StrictModel):
    """Заказ кадра — payload джоба: запрос собран при постановке и дальше не меняется."""

    episode_id: str = Field(pattern=EPISODE_ID_PATTERN)
    channel: Channel
    shot_id: str = Field(pattern=SHOT_ID_PATTERN)
    variant: int = Field(ge=1)
    model: str  # ключ каталога `images`
    model_id: str  # ID модели маршрута на момент заказа
    input_hash: str  # ключ кэша кадра, как у предпросмотра
    request: ImageRequest


class ShotRefusal(BaseModel):
    """Тело 409 «кадр не поставлен»: что случилось и что сделать. У `shot_problems` — проблемы
    сборщика с адресатами канона, у `shot_busy` — джоб, который уже рисует кадр."""

    code: RefusalCode
    message: str
    problems: list[PromptProblem] = []
    job_id: str | None = None


class OrderRefused(Exception):
    def __init__(self, refusal: ShotRefusal) -> None:
        self.refusal = refusal
        super().__init__(refusal.message)


class ShotNotInPlan(LookupError):
    """Кадра нет в действующем плане (в API — 404)."""


# --- заказ ---------------------------------------------------------------------------------------


def shot_order(
    paths: StudioPaths,
    gateway: Gateway,
    config: CanonConfig,
    *,
    channel: Channel,
    project: Project,
    director: Director | None,
    shot_id: str,
    variant: int = 1,
    model: str | None = None,
) -> ShotOrder:
    """Заказ кадра действующего плана. Не утверждён план или есть проблемы — `OrderRefused`;
    кадра нет — `ShotNotInPlan`; модель не из каталога — `RouteError`. Ничего не пишет."""
    current = project.director_version
    if director is None or current is None:
        _refuse(
            "plan_not_approved",
            "Плана ещё нет — кадры рисуются по утверждённому плану: импортируйте и утвердите план"
            + _ON_SCRIPT
            + ".",
        )
    if project.approved_version is None:
        _refuse(
            "plan_not_approved",
            f"План не утверждён — утвердите его{_ON_SCRIPT}: кадры рисуются только по"
            " утверждённому плану.",
        )
    if project.approved_version != current:
        _refuse(
            "plan_not_approved",
            f"Утверждена версия {project.approved_version}, а текущая — {current}: утвердите план"
            f" снова{_ON_SCRIPT}.",
        )
    shot = next((s for s in effective_plan(director, project).shots if s.id == shot_id), None)
    if shot is None or shot.status == "removed":
        raise ShotNotInPlan(f"Кадра {shot_id} в действующем плане выпуска нет.")
    built = build_shot_request(
        paths,
        gateway,
        config,
        episode_id=project.episode_id,
        channel=channel,
        canon_ref=plan_canon_ref(director),
        shot=shot,
        variant=variant,
        model=model,
    )
    if built.request is None or built.prompt.input_hash is None:
        n = len(built.prompt.problems)
        raise OrderRefused(
            ShotRefusal(
                code="shot_problems",
                message=f"Кадр {shot_id} нельзя рисовать: {n}"
                f" {plural(n, 'проблема', 'проблемы', 'проблем')} — исправьте и поставьте снова.",
                problems=built.prompt.problems,
            )
        )
    return ShotOrder(
        episode_id=project.episode_id,
        channel=channel,
        shot_id=shot_id,
        variant=variant,
        model=built.route.key,
        model_id=built.route.model,
        input_hash=built.prompt.input_hash,
        request=built.request,
    )


def order_cost(gateway: Gateway, order: ShotOrder) -> Cost:
    """Цена кадра по маршруту выбранной модели; кэш не вычитается — оценка сверху."""
    return gateway.estimate(IMAGES_STAGE, order.request, override=order.model)


def active_shot_job(conn: sqlite3.Connection, episode_id: str, shot_id: str) -> Job | None:
    """Ждущий или идущий джоб того же кадра: второй не ставим."""
    rows = conn.execute(
        "SELECT * FROM jobs WHERE status IN ('queued', 'running') AND kind = ? AND episode_id = ?"
        " AND json_extract(payload, '$.shot_id') = ? ORDER BY rowid LIMIT 1",
        (SHOT_KIND, episode_id, shot_id),
    ).fetchall()
    return Job.from_row(rows[0]) if rows else None


def enqueue_shot(
    conn: sqlite3.Connection, gateway: Gateway, paths: StudioPaths, order: ShotOrder
) -> Job:
    """Постановка: кадр не занят, бюджет выпуска и месяца — до очереди (`BudgetExceeded`, джоба
    нет), оценка держит бюджет, пока джоб ждёт. Кадр — `queued`."""
    busy = active_shot_job(conn, order.episode_id, order.shot_id)
    if busy is not None:
        _refuse(
            "shot_busy",
            f"Кадр {order.shot_id} уже рисуется (джоб {busy.id}) — дождитесь окончания или"
            " отмените его.",
            job_id=busy.id,
        )
    cost = order_cost(gateway, order)
    gateway.check_budget(conn, cost, episode_id=order.episode_id)
    job, _ = queue.enqueue(
        conn,
        NewJob(
            kind=SHOT_KIND,
            payload=order.model_dump(mode="json"),
            episode_id=order.episode_id,
            cost_usd_micro=cost.usd_micro,
            cost_stage=cost.stage,
        ),
    )
    shot_assets.set_work_status(paths, order.channel, order.episode_id, order.shot_id, "queued")
    return job


def cancel_shot(paths: StudioPaths, job: Job) -> None:
    """Джоб снят до старта (`HandlerSpec.on_cancel`): кадр возвращается к своему статусу."""
    order = ShotOrder.model_validate(job.payload)
    shot_assets.settle(paths, order.channel, order.episode_id, order.shot_id)


# --- джоб ----------------------------------------------------------------------------------------


async def draw_shot(ctx: JobContext, order: ShotOrder) -> dict[str, Any]:
    """Один кадр, один вариант: готовая версия с тем же хэшем, иначе шлюз и новая версия."""
    gateway = ctx.gateway
    paths = gateway.paths
    where = (paths, order.channel, order.episode_id, order.shot_id)
    if ctx.cancelled():
        shot_assets.settle(*where)
        return _result(order, None, "cancelled", 0)
    shot_assets.set_work_status(*where, "generating")
    ctx.progress(0.0, f"Кадр {order.shot_id} · рисуется")

    project = Project.model_validate(read_json(paths.project_path(order.channel, order.episode_id)))
    known = shot_assets.find_image_by_hash(project, order.shot_id, order.input_hash)
    if known is not None:
        await asyncio.to_thread(shot_assets.bind_existing, *where, known.version)
        ctx.progress(1.0, f"Кадр {order.shot_id} · версия {known.version} уже нарисована")
        return _result(order, known.version, "exists", 0)

    try:
        outcome = await gateway.call(
            CallContext(
                stage=IMAGES_STAGE,
                episode_id=order.episode_id,
                shot_id=order.shot_id,
                job_id=ctx.job_id,
            ),
            order.request,
            override=order.model,
        )
        if outcome.asset_path is None:
            raise ProviderError(f"Модель {order.model_id} не вернула файл — поставьте кадр снова.")
        charged = outcome.cost.usd_micro if outcome.status == "charged" else 0
        drawing = Drawing(
            input_hash=outcome.input_hash,
            model=outcome.route.key,
            model_id=outcome.route.model,
            seed=order.request.seed or 0,
            variant=order.variant,
            usd_micro=charged,
            cached=outcome.status == "cached",
        )
        asset = await asyncio.to_thread(
            shot_assets.add_image_file, *where, outcome.asset_path, drawing
        )
    except Exception as exc:
        shot_assets.set_work_status(*where, "failed", shot_error(exc))
        raise
    ctx.progress(1.0, f"Кадр {order.shot_id} · готово: версия {asset.version}")
    return _result(order, asset.version, outcome.status, charged)


def shot_error(exc: Exception) -> str:
    """Причина `failed` у кадра — одна строка: что случилось и что сделать. Тексты провайдеров,
    шлюза и бюджета уже такие; прочее — сбой бэкенда."""
    if isinstance(exc, ProviderError | RouteError | BudgetExceeded | TransientError):
        return str(exc)
    text = str(exc).strip()
    detail = f": {text}" if text else ""
    return f"Сбой бэкенда ({type(exc).__name__}){detail} — посмотрите лог и поставьте кадр снова."


def _result(order: ShotOrder, version: int | None, status: str, usd_micro: int) -> dict[str, Any]:
    return {"shot_id": order.shot_id, "version": version, "status": status, "usd_micro": usd_micro}


def _refuse(code: RefusalCode, message: str, *, job_id: str | None = None) -> NoReturn:
    raise OrderRefused(ShotRefusal(code=code, message=message, job_id=job_id))
