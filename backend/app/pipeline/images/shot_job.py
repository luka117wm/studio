"""Джоб кадра `shot_image` (M6.2; устав M6, решения 2, 3, 6): заказ, отрисовка, версия кадра.

Заказ собирается при постановке: план утверждён (принцип 10), кадр — в действующем плане, запрос
собран сборщиком M5.5 без проблем, модель — из каталога `images`, бюджет — до очереди (принцип 6).
Payload — заказ целиком (`ShotOrder`): перезапуск после аварии рисует тот же вариант.

Джоб: тот же хэш уже среди версий кадра — та же версия, без вызова и денег; иначе шлюз отдаёт
`cached` (готовый файл, $0) или `charged`, и файл становится новой версией кадра (L-042) — вместе
с проверкой лица против фасов обликов кадра (M6.5); затем вопрос к VLM об анахронизмах по
миниатюре версии (M6.6), если он в заказе и включён в профиле. Проверки ничего не блокируют, их
сбой джоб не роняет. Отказ модели, ошибка запроса и бюджет в момент вызова картинки — кадр
`failed` с причиной, без повтора; сеть и 5xx — кадр `failed`, пока очередь не повторит. Контракт —
`docs/generation.md`, «Джоб кадра».
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
from app.models.project import AnachronismCheck, AssetChecks, FaceCheck, Project
from app.pipeline.canon.episode_canon import plan_canon_ref
from app.pipeline.checks import anachronism
from app.pipeline.checks.anachronism import AnachronismOrder
from app.pipeline.checks.shot_check import ShotChecks, check_anachronism
from app.pipeline.director_import import PlanShot, effective_plan
from app.pipeline.images import shot_assets
from app.pipeline.images.prompt_builder import IMAGES_STAGE, PromptProblem, build_shot_request
from app.pipeline.images.shot_assets import Drawing
from app.pipeline.images.status import refresh_episode_status
from app.pipeline.script.plan_bridge import plural
from app.providers.base import Cost, ImageRequest, ProviderError, RouteError
from app.providers.gateway import CallContext, Gateway
from app.storage.atomic import read_json
from app.storage.db import now_iso
from app.storage.paths import StudioPaths

SHOT_KIND = "shot_image"  # = `status.SHOT_KIND`
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
    # Версия плана заказа (M6.3): сменилась, пока джоб ждал или рисовал, — версия кадра сама не
    # выбирается. У заказов до M6.3 поля нет — без проверки.
    plan_version: str | None = None
    # Облики кадра (M6.5): с чьими фасами сверять лицо новой версии. Нет — проверки лица нет.
    appearances: list[str] = []
    # Вопрос об анахронизмах (M6.6): эпоха кадра по прибитой версии и её `forbidden`; нет —
    # проверка выключена в профиле при постановке, версия получит `off`. Цена — в оценке кадра.
    check: AnachronismOrder | None = None


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
    approved, shot = plan_shot(project, director, shot_id)
    return order_for(
        paths,
        gateway,
        config,
        channel=channel,
        project=project,
        director=approved,
        shot=shot,
        variant=variant,
        model=model,
    )


def redraw_order(
    conn: sqlite3.Connection,
    paths: StudioPaths,
    gateway: Gateway,
    config: CanonConfig,
    *,
    channel: Channel,
    project: Project,
    director: Director | None,
    shot_id: str,
    model: str | None = None,
) -> ShotOrder:
    """«Перерисовать», «Добавить версию», «С правкой…» (M6.4): заказ кадра следующим свободным
    вариантом — после вариантов его версий и незаконченных джобов. Проверки — как у заказа."""
    approved, shot = plan_shot(project, director, shot_id)
    return order_for(
        paths,
        gateway,
        config,
        channel=channel,
        project=project,
        director=approved,
        shot=shot,
        variant=next_variant(conn, project, shot_id),
        model=model,
    )


def next_variant(conn: sqlite3.Connection, project: Project, shot_id: str) -> int:
    """Следующий свободный вариант кадра: после последнего среди его версий и его `queued` и
    `running` джобов — два «Перерисовать» подряд дают 2 и 3, а не дважды 2."""
    drawn = [a.variant or 1 for a in shot_assets.image_versions(project, shot_id)]
    pending = [
        int(row[0])
        for row in conn.execute(
            "SELECT json_extract(payload, '$.variant') FROM jobs WHERE episode_id = ? AND kind = ?"
            " AND status IN ('queued', 'running') AND json_extract(payload, '$.shot_id') = ?",
            (project.episode_id, SHOT_KIND, shot_id),
        ).fetchall()
        if row[0] is not None
    ]
    return max([*drawn, *pending], default=0) + 1


def plan_shot(
    project: Project, director: Director | None, shot_id: str
) -> tuple[Director, PlanShot]:
    """Утверждённый план и кадр его действующей версии; иначе `OrderRefused` или `ShotNotInPlan`."""
    approved = check_approved(project, director)
    shot = next((s for s in effective_plan(approved, project).shots if s.id == shot_id), None)
    if shot is None or shot.status == "removed":
        raise ShotNotInPlan(f"Кадра {shot_id} в действующем плане выпуска нет.")
    return approved, shot


def check_approved(project: Project, director: Director | None) -> Director:
    """План есть и утверждена текущая версия (принцип 10); иначе `OrderRefused`."""
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
    return director


def order_for(
    paths: StudioPaths,
    gateway: Gateway,
    config: CanonConfig,
    *,
    channel: Channel,
    project: Project,
    director: Director,
    shot: PlanShot,
    variant: int = 1,
    model: str | None = None,
) -> ShotOrder:
    """Заказ по кадру действующего плана (утверждение проверено вызывающим): проблемы сборщика —
    `OrderRefused` со списком, модель не из каталога — `RouteError`."""
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
                message=f"Кадр {shot.id} нельзя рисовать: {n}"
                f" {plural(n, 'проблема', 'проблемы', 'проблем')} — исправьте и поставьте снова.",
                problems=built.prompt.problems,
            )
        )
    return ShotOrder(
        episode_id=project.episode_id,
        channel=channel,
        shot_id=shot.id,
        variant=variant,
        model=built.route.key,
        model_id=built.route.model,
        input_hash=built.prompt.input_hash,
        request=built.request,
        plan_version=project.director_version,
        appearances=list(shot.image.appearances),
        check=anachronism.order_for(paths, channel, plan_canon_ref(director), shot.image.period),
    )


def order_cost(gateway: Gateway, order: ShotOrder) -> Cost:
    """Цена кадра по маршруту выбранной модели и, если в заказе, вопроса об анахронизмах (M6.6)
    — одной суммой на кадр: бюджет до очереди держит обе. Кэш не вычитается — оценка сверху."""
    image = gateway.estimate(IMAGES_STAGE, order.request, override=order.model)
    if order.check is None:
        return image
    check = anachronism.estimate(gateway, order.check)
    return image.model_copy(
        update={
            "lines": [*image.lines, *check.lines],
            "usd_micro": image.usd_micro + check.usd_micro,
            "stale_pricing": image.stale_pricing or check.stale_pricing,
        }
    )


def active_shot_job(conn: sqlite3.Connection, episode_id: str, shot_id: str) -> Job | None:
    """Ждущий или идущий джоб того же кадра: второй не ставим."""
    rows = conn.execute(
        "SELECT * FROM jobs WHERE status IN ('queued', 'running') AND kind = ? AND episode_id = ?"
        " AND json_extract(payload, '$.shot_id') = ? ORDER BY rowid LIMIT 1",
        (SHOT_KIND, episode_id, shot_id),
    ).fetchall()
    return Job.from_row(rows[0]) if rows else None


def enqueue_shot(
    conn: sqlite3.Connection,
    gateway: Gateway,
    paths: StudioPaths,
    order: ShotOrder,
    *,
    allow_busy: bool = False,
) -> Job:
    """Постановка: кадр не занят, бюджет выпуска и месяца — до очереди (`BudgetExceeded`, джоба
    нет), оценка держит бюджет, пока джоб ждёт. Кадр — `queued`. Перерисовка (`allow_busy`, M6.4)
    ставит новый вариант и при незаконченном джобе того же кадра: варианты разные."""
    busy = None if allow_busy else active_shot_job(conn, order.episode_id, order.shot_id)
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
    """Джоб снят до старта (`HandlerSpec.on_cancel`): кадр возвращается к своему статусу, статус
    выпуска пересчитывается."""
    order = ShotOrder.model_validate(job.payload)
    shot_assets.settle(paths, order.channel, order.episode_id, [order.shot_id])
    refresh_episode_status(paths, order.episode_id)


def finish_shot(paths: StudioPaths, job: Job) -> None:
    """Конечный переход джоба (`HandlerSpec.on_finish`): статус выпуска по итогу (M6.3)."""
    if job.episode_id is not None:
        refresh_episode_status(paths, job.episode_id)


# --- джоб ----------------------------------------------------------------------------------------


async def draw_shot(
    ctx: JobContext, order: ShotOrder, checks: ShotChecks | None = None
) -> dict[str, Any]:
    """Один кадр, один вариант: готовая версия с тем же хэшем, иначе шлюз и новая версия с
    проверками (`checks`; None — без проверок): лицо — вместе с версией, анахронизмы — после
    неё, по её миниатюре. Проверки не бросают: сбой — `skipped` / `failed` у проверки."""
    gateway = ctx.gateway
    paths = gateway.paths
    where = (paths, order.channel, order.episode_id, order.shot_id)
    if ctx.cancelled():
        shot_assets.settle(paths, order.channel, order.episode_id, [order.shot_id])
        return _result(order, None, "cancelled", 0)
    shot_assets.set_work_status(*where, "generating")
    ctx.progress(0.0, f"Кадр {order.shot_id} · рисуется")

    project = Project.model_validate(read_json(paths.project_path(order.channel, order.episode_id)))
    known = shot_assets.find_image_by_hash(project, order.shot_id, order.input_hash)
    if known is not None:
        await asyncio.to_thread(
            shot_assets.bind_existing, *where, known.version, order.plan_version
        )
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
        face = None
        if checks is not None and order.appearances:
            ctx.progress(0.9, f"Кадр {order.shot_id} · проверка лица")
            face = await asyncio.to_thread(
                checks.face.check_shot, paths, order.channel, order.appearances, outcome.asset_path
            )
        drawing = Drawing(
            input_hash=outcome.input_hash,
            model=outcome.route.key,
            model_id=outcome.route.model,
            seed=order.request.seed or 0,
            variant=order.variant,
            usd_micro=charged,
            cached=outcome.status == "cached",
            plan_version=order.plan_version,
            checks=_first_checks(checks, order, face),
        )
        asset = await asyncio.to_thread(
            shot_assets.add_image_file, *where, outcome.asset_path, drawing
        )
    except Exception as exc:
        shot_assets.set_work_status(*where, "failed", shot_error(exc))
        raise
    if checks is not None and order.check is not None:
        ctx.progress(0.95, f"Кадр {order.shot_id} · проверка анахронизмов")
        await check_anachronism(
            checks,
            ctx,
            channel=order.channel,
            episode_id=order.episode_id,
            shot_id=order.shot_id,
            asset=asset,
            order=order.check,
        )
    ctx.progress(1.0, f"Кадр {order.shot_id} · готово: версия {asset.version}")
    return _result(order, asset.version, outcome.status, charged)


def _first_checks(
    checks: ShotChecks | None, order: ShotOrder, face: FaceCheck | None
) -> AssetChecks | None:
    """Проверки, которые пишутся вместе с версией: лицо и, если вопроса об анахронизмах в заказе
    нет (выключено при постановке), сразу `off` — без миниатюры и второй записи."""
    off = None
    if checks is not None and order.check is None:
        off = AnachronismCheck(status="off", checked_at=now_iso())
    if face is None and off is None:
        return None
    return AssetChecks(face=face, anachronism=off)


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
