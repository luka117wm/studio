"""Пачка кадров (M6.3; устав M6, решения 4, 5): выбор кадров, смета суммой, постановка одной
транзакцией, пауза, отмена, «Повторить упавшие». Контракт — `docs/generation.md`, «Пачка».

Деньги — до очереди и суммой (принцип 6): вся пачка проверяется против лимитов выпуска и месяца,
и в той же транзакции `BEGIN IMMEDIATE` (L-021) пишутся пачка и все её джобы. Не влезает — 409 с
суммой и ни одного джоба: вторая пачка, поставленная одновременно, видит оценки первой в очереди.
Кадр — не больше чем в одной незаконченной работе: занят — 409 с id пачки.
"""

import sqlite3
import uuid
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel

from app.cost.pricing import Money, format_unit_usd, money
from app.jobs import queue
from app.jobs.queue import BatchSummary, Job, NewBatch, NewJob
from app.models.canon_config import CanonConfig
from app.models.director import Channel, Director
from app.models.project import Project, ShotState
from app.pipeline.director_import import effective_plan
from app.pipeline.images import shot_assets
from app.pipeline.images.prompt_builder import IMAGES_STAGE, PromptProblem
from app.pipeline.images.shot_job import (
    SHOT_KIND,
    OrderRefused,
    ShotOrder,
    check_approved,
    order_cost,
    order_for,
)
from app.pipeline.images.status import refresh_episode_status
from app.pipeline.script.estimate import stage_cost
from app.providers.base import ImageRequest, Route, RouteError
from app.providers.gateway import Gateway
from app.storage.paths import StudioPaths

BatchCode = Literal["plan_not_approved", "nothing_to_draw", "shots_busy"]


class SkippedShot(BaseModel):
    """Кадр, который пачка не ставит, и почему; у проблем сборщика — список с адресатами."""

    shot_id: str
    reason: str
    problems: list[PromptProblem] = []


class EstimateShot(BaseModel):
    shot_id: str
    variant: int
    usd: Money  # цена кадра, кэш не вычтен


class BatchEstimate(BaseModel):
    """Смета пачки до клика: «Сгенерировать N кадров (~$X)» — `GET …/generate/estimate`."""

    model: str  # ключ каталога `images`
    model_id: str
    count: int
    unit: Money  # цена одного кадра выбранной модели, до десятых цента
    total: Money  # сумма сверху: кэш не вычитается
    shots: list[EstimateShot]
    skipped: list[SkippedShot]


class BatchResult(BaseModel):
    """Ответ постановки: сводка новой пачки, пропущенные кадры и предупреждения."""

    batch: BatchSummary
    skipped: list[SkippedShot]
    warnings: list[str]


class BatchRefusal(BaseModel):
    """Тело 409 «пачка не поставлена» (кроме бюджета — у него `BudgetRefusal`)."""

    code: BatchCode
    message: str
    skipped: list[SkippedShot] = []
    shots: list[str] = []  # у `shots_busy` — занятые кадры
    batch_id: str | None = None  # у `shots_busy` — пачка, где они заняты; null — отдельный джоб


class BatchRefused(Exception):
    def __init__(self, refusal: BatchRefusal) -> None:
        self.refusal = refusal
        super().__init__(refusal.message)


class BatchNotFound(LookupError):
    def __init__(self, batch_id: str) -> None:
        super().__init__(f"Пачка «{batch_id}» не найдена.")


@dataclass(frozen=True)
class Selection:
    route: Route
    orders: list[ShotOrder]
    skipped: list[SkippedShot]


# --- выбор ---------------------------------------------------------------------------------------


def select_shots(
    paths: StudioPaths,
    gateway: Gateway,
    config: CanonConfig,
    *,
    channel: Channel,
    project: Project,
    director: Director | None,
    shots: Sequence[str] | None = None,
    model: str | None = None,
    redraw: bool = False,
) -> Selection:
    """Кадры пачки и их заказы. Без `shots` — кадры без выбранной картинки и `stale`; с `shots`
    — названные. `redraw` — следующий свободный вариант и у готовых. Убранные, неизвестные и с
    проблемами сборщика — в `skipped`. Модель не из каталога — `RouteError`."""
    route = gateway.resolve(IMAGES_STAGE, override=model)
    approved = _approved(project, director)
    plan = effective_plan(approved, project).shots
    skipped: list[SkippedShot] = []
    if shots is None:
        targets = [s for s in plan if redraw or _needs_image(project.shots.get(s.id))]
    else:
        by_id = {s.id: s for s in plan}
        targets = []
        for shot_id in dict.fromkeys(shots):
            shot = by_id.get(shot_id)
            if shot is None:
                skipped.append(SkippedShot(shot_id=shot_id, reason=_absent(project, shot_id)))
            else:
                targets.append(shot)
    orders: list[ShotOrder] = []
    for shot in targets:
        variant = next_variant(project, shot.id) if redraw else 1
        try:
            orders.append(
                order_for(
                    paths,
                    gateway,
                    config,
                    channel=channel,
                    project=project,
                    director=approved,
                    shot=shot,
                    variant=variant,
                    model=route.key,
                )
            )
        except OrderRefused as exc:
            skipped.append(
                SkippedShot(
                    shot_id=shot.id, reason=exc.refusal.message, problems=exc.refusal.problems
                )
            )
    return Selection(route, orders, skipped)


def next_variant(project: Project, shot_id: str) -> int:
    """Следующий свободный вариант кадра: после последнего среди его версий."""
    variants = [a.variant or 1 for a in shot_assets.image_versions(project, shot_id)]
    return max(variants, default=0) + 1


def estimate(gateway: Gateway, selection: Selection) -> BatchEstimate:
    unit = gateway.estimate(IMAGES_STAGE, _probe(selection), override=selection.route.key)
    costs = [order_cost(gateway, order) for order in selection.orders]
    return BatchEstimate(
        model=selection.route.key,
        model_id=selection.route.model,
        count=len(costs),
        unit=Money(usd_micro=unit.usd_micro, usd=format_unit_usd(unit.usd_micro)),
        total=money(sum(cost.usd_micro for cost in costs)),
        shots=[
            EstimateShot(
                shot_id=order.shot_id,
                variant=order.variant,
                usd=Money(usd_micro=cost.usd_micro, usd=format_unit_usd(cost.usd_micro)),
            )
            for order, cost in zip(selection.orders, costs, strict=True)
        ],
        skipped=selection.skipped,
    )


# --- постановка ----------------------------------------------------------------------------------


def create_batch(
    conn: sqlite3.Connection,
    paths: StudioPaths,
    gateway: Gateway,
    selection: Selection,
    *,
    episode_id: str,
    channel: Channel,
    parallel: int,
    retry_of: str | None = None,
    warnings: Sequence[str] = (),
) -> BatchResult:
    """Пачка и все её джобы — одной транзакцией после проверки занятости и бюджета суммой.
    Занят кадр — `BatchRefused`; не влезает — `BudgetExceeded` (строка `refused` в журнале),
    джобов нет. Затем кадры — `queued` одной записью project.json, выпуск — `generating`."""
    if not selection.orders:
        message = (
            " ".join(warnings)
            if warnings
            else "Рисовать нечего: у кадров плана картинки в силе, остальные пропущены — причины"
            " в списке."
        )
        raise BatchRefused(
            BatchRefusal(code="nothing_to_draw", message=message, skipped=selection.skipped)
        )
    costs = [order_cost(gateway, order) for order in selection.orders]
    # У картинки цена от запроса не зависит: сумма — цена кадра × число кадров.
    total = stage_cost(costs[0], len(costs))
    batch_id = uuid.uuid4().hex
    jobs = [
        NewJob(
            kind=SHOT_KIND,
            payload=order.model_dump(mode="json"),
            episode_id=episode_id,
            cost_usd_micro=cost.usd_micro,
            cost_stage=cost.stage,
        )
        for order, cost in zip(selection.orders, costs, strict=True)
    ]
    conn.execute("BEGIN IMMEDIATE")
    try:
        _require_free(conn, episode_id, [order.shot_id for order in selection.orders])
        # Отказ пишет строку `refused` и коммитит её сам — транзакция на этом кончается.
        gateway.check_budget(conn, total, episode_id=episode_id)
        summary, _ = queue.insert_batch(
            conn,
            NewBatch(
                id=batch_id,
                episode_id=episode_id,
                kind=SHOT_KIND,
                model=selection.route.key,
                estimate_usd_micro=total.usd_micro,
                parallel=parallel,
                retry_of=retry_of,
            ),
            jobs,
        )
        conn.commit()
    except BaseException:
        if conn.in_transaction:
            conn.rollback()
        raise
    shot_assets.set_work_statuses(
        paths, channel, episode_id, [order.shot_id for order in selection.orders], "queued"
    )
    refresh_episode_status(paths, episode_id)
    return BatchResult(batch=summary, skipped=selection.skipped, warnings=list(warnings))


def retry_failed(
    conn: sqlite3.Connection,
    paths: StudioPaths,
    gateway: Gateway,
    config: CanonConfig,
    batch_id: str,
    *,
    channel: Channel,
    project: Project,
    director: Director | None,
    parallel: int,
    shots: Sequence[str] | None = None,
) -> BatchResult:
    """«Повторить упавшие»: новая пачка из кадров с упавшим джобом в этой, тот же вариант и
    модель; запрос собирается заново по действующему плану («С правкой…» в него попадёт). Отказ
    модели при том же запросе повторится — такие кадры ставятся только явно (`shots`)."""
    summary = queue.batch_summary(conn, batch_id)
    if summary is None:
        raise BatchNotFound(batch_id)
    failed: dict[str, tuple[ShotOrder, Job]] = {}
    for job in queue.batch_jobs(conn, batch_id):
        if job.status == "failed":
            order = ShotOrder.model_validate(job.payload)
            failed[order.shot_id] = (order, job)
    approved = _approved(project, director)
    plan = {s.id: s for s in effective_plan(approved, project).shots}
    explicit = shots is not None
    orders: list[ShotOrder] = []
    skipped: list[SkippedShot] = []
    refused_same: list[str] = []
    for shot_id in dict.fromkeys(shots if shots is not None else failed):
        if shot_id not in failed:
            skipped.append(
                SkippedShot(shot_id=shot_id, reason=f"кадр {shot_id} не упал в пачке {batch_id}")
            )
            continue
        previous, job = failed[shot_id]
        shot = plan.get(shot_id)
        if shot is None:
            skipped.append(SkippedShot(shot_id=shot_id, reason=_absent(project, shot_id)))
            continue
        try:
            order = order_for(
                paths,
                gateway,
                config,
                channel=channel,
                project=project,
                director=approved,
                shot=shot,
                variant=previous.variant,
                model=previous.model,
            )
        except OrderRefused as exc:
            skipped.append(
                SkippedShot(
                    shot_id=shot_id, reason=exc.refusal.message, problems=exc.refusal.problems
                )
            )
            continue
        except RouteError as exc:
            skipped.append(SkippedShot(shot_id=shot_id, reason=str(exc)))
            continue
        if not explicit and order.input_hash == previous.input_hash and _refused(job):
            refused_same.append(shot_id)
            skipped.append(
                SkippedShot(
                    shot_id=shot_id,
                    reason=f"кадр {shot_id}: модель отказала, а запрос не менялся — поправьте"
                    " действие кадра или повторите кадр явно",
                )
            )
            continue
        orders.append(order)
    warnings = []
    if refused_same:
        warnings.append(
            f"Не повторены {', '.join(refused_same)}: модель отказала, а запрос не менялся —"
            " повтор даст тот же отказ и потратит деньги. Поправьте действие кадра («С"
            " правкой…») или повторите эти кадры явно."
        )
    selection = Selection(gateway.resolve(IMAGES_STAGE, override=summary.model), orders, skipped)
    return create_batch(
        conn,
        paths,
        gateway,
        selection,
        episode_id=summary.episode_id,
        channel=channel,
        parallel=parallel,
        retry_of=batch_id,
        warnings=warnings,
    )


# --- пауза и отмена ------------------------------------------------------------------------------


def set_paused(conn: sqlite3.Connection, batch_id: str, paused: bool) -> BatchSummary:
    summary = queue.set_batch_paused(conn, batch_id, paused)
    if summary is None:
        raise BatchNotFound(batch_id)
    return summary


def cancel(conn: sqlite3.Connection, paths: StudioPaths, batch_id: str) -> BatchSummary:
    """`queued` пачки — `cancelled`, их кадры — к своему статусу; начатые дорисуются. Оценка
    отменённых освобождает бюджет сама: в очереди их больше нет."""
    if queue.batch_summary(conn, batch_id) is None:
        raise BatchNotFound(batch_id)
    _settle(paths, queue.cancel_batch(conn, batch_id))
    summary = queue.batch_summary(conn, batch_id)
    assert summary is not None
    refresh_episode_status(paths, summary.episode_id)
    return summary


def cancel_for_new_plan(conn: sqlite3.Connection, paths: StudioPaths, episode_id: str) -> int:
    """Новая текущая версия плана снимает его с утверждения (принцип 10): `queued` джобы кадров
    выпуска отменяются, пачки — отменёнными; начатые доделывают, но их версии сами не выберутся
    (`ShotOrder.plan_version`). Возвращает, сколько отменено."""
    cancelled = queue.cancel_episode_jobs(conn, episode_id, SHOT_KIND)
    _settle(paths, cancelled)
    return len(cancelled)


def _settle(paths: StudioPaths, jobs: Sequence[Job]) -> None:
    by_episode: dict[tuple[Channel, str], list[str]] = defaultdict(list)
    for job in jobs:
        order = ShotOrder.model_validate(job.payload)
        by_episode[(order.channel, order.episode_id)].append(order.shot_id)
    for (channel, episode_id), shot_ids in by_episode.items():
        shot_assets.settle(paths, channel, episode_id, shot_ids)


# --- вспомогательное -----------------------------------------------------------------------------


def _approved(project: Project, director: Director | None) -> Director:
    try:
        return check_approved(project, director)
    except OrderRefused as exc:
        raise BatchRefused(
            BatchRefusal(code="plan_not_approved", message=exc.refusal.message)
        ) from exc


def _needs_image(state: ShotState | None) -> bool:
    """Без выбранной картинки или выбранная устарела (`stale`: у кадра с картинкой есть причины)."""
    return state is None or not state.has_image or bool(state.stale_reasons)


def _absent(project: Project, shot_id: str) -> str:
    state = project.shots.get(shot_id)
    if state is not None and state.status == "removed":
        return f"кадр {shot_id} убран из плана {project.director_version}"
    return f"кадра {shot_id} нет в действующем плане"


def _refused(job: Job) -> bool:
    """Джоб упал отказом модели (фильтр, 4xx): `error` пула — «ProviderError: …»."""
    return (job.error or "").startswith("ProviderError:")


def _require_free(conn: sqlite3.Connection, episode_id: str, shot_ids: Sequence[str]) -> None:
    """Кадры не заняты незаконченным джобом кадра (в пачке или отдельно); иначе `BatchRefused`.
    Внутри транзакции постановки: две пачки одних кадров не пройдут вдвоём."""
    wanted = set(shot_ids)
    rows = conn.execute(
        "SELECT id, batch_id, json_extract(payload, '$.shot_id') AS shot FROM jobs"
        " WHERE episode_id = ? AND kind = ? AND status IN ('queued', 'running') ORDER BY rowid",
        (episode_id, SHOT_KIND),
    ).fetchall()
    busy = [row for row in rows if row["shot"] in wanted]
    if not busy:
        return
    shots = [shot for shot in shot_ids if shot in {row["shot"] for row in busy}]
    batch_id = next((row["batch_id"] for row in busy if row["batch_id"]), None)
    where = f"в пачке {batch_id}" if batch_id else f"отдельным джобом {busy[0]['id']}"
    noun = "Кадр" if len(shots) == 1 else "Кадры"
    verb = "уже рисуется" if len(shots) == 1 else "уже рисуются"
    raise BatchRefused(
        BatchRefusal(
            code="shots_busy",
            message=f"{noun} {', '.join(shots)} {verb} {where} — дождитесь окончания или отмените.",
            shots=shots,
            batch_id=batch_id,
        )
    )


def _probe(selection: Selection) -> ImageRequest:
    """Запрос для цены одного кадра: первый заказ или пустой — у картинки цена от него не
    зависит."""
    return selection.orders[0].request if selection.orders else ImageRequest(prompt="shot")
