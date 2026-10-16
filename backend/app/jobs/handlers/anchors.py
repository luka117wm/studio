"""Джобы опорных (M5.4): `anchor_sheet` — лист облика, `anchor_angle` — новые кандидаты одного
ракурса, `style_anchors` — кадры стиля. Заказ (`AnchorOrder`) собирает API канона
(`pipeline/canon/anchors.py`), джоб рисует кандидатов по порядку через шлюз: этап `anchors`,
вызов уровня канала без выпуска. Контракт — `docs/jobs.md`, «Джобы опорных».

Сбой одного кандидата — `failed` у кандидата, остальные идут (принцип 7): отказ модели и ошибка
запроса (`ProviderError`, `RouteError`). Сеть и 5xx (`TransientError`) повторяют джоб целиком —
нарисованное берётся из кэша за $0. Бюджет в момент вызова (`BudgetExceeded`) останавливает джоб.
Ни одного удачного кандидата — джоб `failed` с причиной первого сбоя.
"""

import sqlite3
from typing import Any

from pydantic import BaseModel

from app.cost.pricing import money
from app.jobs import queue
from app.jobs.queue import Job, NewJob
from app.jobs.worker import HandlerSpec, JobContext
from app.models.canon_config import CanonConfig
from app.pipeline.canon import anchors
from app.pipeline.canon.anchors import AnchorItem, AnchorOrder, CandidateRecord, SetDir
from app.pipeline.script.estimate import EstimateLine, StageCost, stage_cost
from app.pipeline.script.plan_bridge import plural
from app.providers.base import ImageRef, ImageRequest, ProviderError, RouteError
from app.providers.gateway import CallContext, Gateway, input_hash
from app.storage.canon_store import CanonConflict
from app.storage.db import now_iso

SHEET_KIND = "anchor_sheet"
ANGLE_KIND = "anchor_angle"
STYLE_KIND = "style_anchors"
KINDS = (SHEET_KIND, ANGLE_KIND, STYLE_KIND)
NO_FRONT = "нет фаса для референса — оба кандидата фаса не получились, перегенерируйте фас"


def _record(
    order: AnchorOrder,
    item: AnchorItem,
    candidate: str,
    *,
    job_id: str,
    status: str,
    file: str | None = None,
    error: str | None = None,
    ref: str | None = None,
    usd_micro: int = 0,
    cached: bool = False,
) -> CandidateRecord:
    return CandidateRecord.model_validate(
        {
            "id": candidate,
            "slot": item.slot,
            "n": item.n,
            "status": status,
            "file": file,
            "error": error,
            "seed": item.seed,
            "version": order.version,
            "canon": order.canon,
            "ref": ref,
            "usd_micro": usd_micro,
            "cached": cached,
            "job_id": job_id,
            "created_at": now_iso(),
        }
    )


async def draw_order(ctx: JobContext, order: AnchorOrder) -> dict[str, Any]:
    """Кандидаты заказа по порядку: прогресс по кандидатам, отмена — между ними."""
    gateway = ctx.gateway
    paths = gateway.paths
    s: SetDir = anchors.set_of(paths, order.channel, order.target)
    style = order.target == anchors.STYLE_TARGET
    route = gateway.resolve(anchors.ANCHORS_STAGE)
    total = len(order.items)
    counts = {"charged": 0, "cached": 0, "failed": 0}
    spent = 0
    first_error: Exception | None = None
    done = 0
    for index, item in enumerate(order.items):
        if ctx.cancelled():
            break
        ctx.progress(index / total, f"Кандидат {index + 1} из {total} · {item.label}, {item.n}")
        refs: list[ImageRef] = []
        front = None
        if item.with_front:
            front = anchors.front_reference(paths, order.channel, order.target, order.version)
        request = order.request(item)
        candidate = anchors.candidate_id(item, input_hash(route, request))
        try:
            if item.with_front:
                if front is None or front.file is None:
                    raise ProviderError(NO_FRONT)
                refs = [gateway.image_ref(s.root / front.file)]
                request = order.request(item, refs)
                candidate = anchors.candidate_id(item, input_hash(route, request))
            outcome = await gateway.call(
                CallContext(
                    stage=anchors.ANCHORS_STAGE,
                    channel=order.channel,
                    shot_id=item.key,
                    job_id=ctx.job_id,
                    asset_dir=s.files,
                ),
                request,
            )
        except (ProviderError, RouteError) as exc:
            first_error = first_error or exc
            counts["failed"] += 1
            anchors.record_candidate(
                s,
                _record(order, item, candidate, job_id=ctx.job_id, status="failed", error=str(exc)),
            )
        else:
            assert outcome.asset_path is not None, "image call without a file"
            counts[outcome.status] += 1
            charged = outcome.cost.usd_micro if outcome.status == "charged" else 0
            spent += charged
            anchors.record_candidate(
                s,
                _record(
                    order,
                    item,
                    candidate,
                    job_id=ctx.job_id,
                    status="ready",
                    file=outcome.asset_path.relative_to(s.root).as_posix(),
                    ref=front.id if front is not None else None,
                    usd_micro=charged,
                    cached=outcome.status == "cached",
                ),
                auto_choose=style,
            )
        done = index + 1
    ctx.progress(done / total, f"Готово {done} из {total}: сбоев {counts['failed']}")
    if done == total and first_error is not None and counts["failed"] == total:
        raise first_error
    return {"target": order.target, "done": done, **counts, "spent_usd_micro": spent}


def order_cost(gateway: Gateway, order: AnchorOrder) -> StageCost:
    """Цена заказа сверху: каждый кандидат — вызов этапа `anchors`, кэш не вычитается."""
    one = gateway.estimate(anchors.ANCHORS_STAGE, order.request(order.items[0]))
    return stage_cost(one, len(order.items))


class AnchorsEstimate(BaseModel):
    """Цена до клика (`GET …/anchors/estimate`): лист, ракурс, кадры стиля."""

    sheet: EstimateLine
    angle: EstimateLine
    style: EstimateLine


def anchors_estimate(gateway: Gateway, config: CanonConfig) -> AnchorsEstimate:
    """«Собрать лист (6 ракурсов × 2 кандидата, ~$1.61)», «Перегенерировать ракурс (~$0.27)»,
    «Пересобрать (6, ~$0.80)» — сверху, кэш не вычитается."""
    one = gateway.estimate(anchors.ANCHORS_STAGE, ImageRequest(prompt="anchor"))
    k = config.anchors.candidates
    angles = len(config.anchors.angles)
    frames = len(config.style_frames.frames)

    def line(title: str, label: str, calls: int) -> EstimateLine:
        cost = stage_cost(one, calls)
        return EstimateLine(title=title, label=label, usd=money(cost.usd_micro), cost=cost)

    candidates = plural(k, "кандидат", "кандидата", "кандидатов")
    return AnchorsEstimate(
        sheet=line(
            "Собрать лист",
            f"{angles} {plural(angles, 'ракурс', 'ракурса', 'ракурсов')} × {k} {candidates}",
            angles * k,
        ),
        angle=line("Перегенерировать ракурс", f"{k} {candidates}", k),
        style=line(
            "Пересобрать кадры стиля",
            f"{frames} {plural(frames, 'кадр', 'кадра', 'кадров')}",
            frames,
        ),
    )


def active_job(conn: sqlite3.Connection, channel: str, target: str) -> Job | None:
    """Идущий или ждущий джоб опорных того же набора: второй не ставим — они бы делили фас."""
    rows = conn.execute(
        "SELECT * FROM jobs WHERE status IN ('queued', 'running') AND channel = ?"
        f" AND kind IN ({', '.join('?' * len(KINDS))}) AND json_extract(payload, '$.target') = ?"
        " ORDER BY rowid LIMIT 1",
        (channel, *KINDS, target),
    ).fetchall()
    return Job.from_row(rows[0]) if rows else None


def enqueue_order(conn: sqlite3.Connection, gateway: Gateway, kind: str, order: AnchorOrder) -> Job:
    """Постановка заказа: один джоб на набор, бюджет канала до очереди (принцип 6) — превышение
    `BudgetExceeded` (в API — 409), джоб не создаётся. Оценка держит месячный бюджет, пока джоб
    в очереди (`jobs.channel`)."""
    busy = active_job(conn, order.channel, order.target)
    if busy is not None:
        what = "Кадры стиля" if order.target == anchors.STYLE_TARGET else f"Лист {order.target}"
        raise CanonConflict(
            f"{what} уже собирается (джоб {busy.id}) — дождитесь окончания или отмените его."
        )
    cost = order_cost(gateway, order)
    gateway.check_budget(conn, cost, channel=order.channel)
    job, _ = queue.enqueue(
        conn,
        NewJob(
            kind=kind,
            payload=order.model_dump(mode="json"),
            channel=order.channel,
            cost_usd_micro=cost.usd_micro,
            cost_stage=cost.stage,
        ),
    )
    return job


SHEET = HandlerSpec(SHEET_KIND, draw_order, AnchorOrder, estimate=order_cost)
ANGLE = HandlerSpec(ANGLE_KIND, draw_order, AnchorOrder, estimate=order_cost)
STYLE = HandlerSpec(STYLE_KIND, draw_order, AnchorOrder, estimate=order_cost)
SPECS = (SHEET, ANGLE, STYLE)
