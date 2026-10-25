"""Проверки готовой версии кадра в джобах (устав M6, решение 7): связка проверок, вопрос об
анахронизмах после записи версии и перепроверка выбранной версии — джоб `shot_check` (M6.5–M6.6).

`POST /api/projects/{id}/shots/{shot_id}/check`: версия — выбранная на момент постановки, облики и
эпоха — кадра действующего плана. Лицо — локально и бесплатно, если в кадре есть персонажи;
анахронизмы — вопрос к VLM, если проверка включена в профиле: тогда джоб платный, цена и бюджет —
до очереди. Результат заменяет проверенные виды у версии, остальные остаются. Контракт —
`docs/generation.md`, «Проверка лица» и «Проверка анахронизмов».
"""

import asyncio
import logging
import sqlite3
from dataclasses import dataclass
from typing import Any

from pydantic import Field

from app.jobs import queue
from app.jobs.queue import Job, NewJob
from app.jobs.worker import JobContext
from app.models.director import EPISODE_ID_PATTERN, SHOT_ID_PATTERN, Channel, Director, StrictModel
from app.models.project import (
    AnachronismCheck,
    AnachronismStatus,
    Asset,
    AssetChecks,
    FaceStatus,
    Project,
)
from app.pipeline.canon.episode_canon import plan_canon_ref
from app.pipeline.checks import anachronism
from app.pipeline.checks.anachronism import AnachronismChecker, AnachronismOrder
from app.pipeline.checks.face import FaceChecker
from app.pipeline.director_import import effective_plan
from app.pipeline.images import shot_assets
from app.pipeline.images.status import refresh_episode_status
from app.providers.base import Cost
from app.providers.gateway import CallContext, Gateway
from app.storage.atomic import read_json
from app.storage.paths import StudioPaths

log = logging.getLogger(__name__)

CHECK_KIND = "shot_check"

FACE_LABEL: dict[FaceStatus, str] = {
    "ok": "похож на фас",
    "low": "не похож на фас — посмотрите кадр",
    "no_face": "лиц в кадре нет",
    "skipped": "лицо не проверено",
}
ANACHRONISM_LABEL: dict[AnachronismStatus, str] = {
    "ok": "анахронизмов не видно",
    "suspect": "похоже на анахронизм — посмотрите кадр",
    "failed": "анахронизмы не проверены",
    "off": "проверка анахронизмов выключена",
}


@dataclass(frozen=True)
class ShotChecks:
    """Проверки версии кадра для джобов: лицо (M6.5) и анахронизмы (M6.6), одни на процесс."""

    face: FaceChecker
    anachronism: AnachronismChecker


async def check_anachronism(
    checks: ShotChecks,
    ctx: JobContext,
    *,
    channel: Channel,
    episode_id: str,
    shot_id: str,
    asset: Asset,
    order: AnachronismOrder | None,
) -> AnachronismCheck | None:
    """Вопрос об анахронизмах по миниатюре 320 записанной версии; результат — в
    `checks.anachronism` версии. `off` (проверка выключена) не затирает прежний результат версии:
    оплаченная пометка остаётся. Сам вопрос не бросает; сбой миниатюры или записи — в журнал,
    None: версия и джоб не страдают."""
    gateway = ctx.gateway
    paths = gateway.paths
    try:
        thumb = await asyncio.to_thread(
            shot_assets.version_thumb, paths, channel, episode_id, asset, 320
        )
        result = await checks.anachronism.check(
            gateway,
            CallContext(
                stage=anachronism.CHECK_STAGE,
                episode_id=episode_id,
                shot_id=shot_id,
                job_id=ctx.job_id,
            ),
            channel,
            order,
            thumb,
        )
        known = None if asset.checks is None else asset.checks.anachronism
        if result.status == "off" and known is not None:
            return result
        await asyncio.to_thread(
            shot_assets.set_checks,
            paths,
            channel,
            episode_id,
            shot_id,
            asset.version,
            AssetChecks(anachronism=result),
        )
    except Exception:
        log.exception(
            "anachronism check of %s/%s v%d not written", episode_id, shot_id, asset.version
        )
        return None
    return result


# --- перепроверка --------------------------------------------------------------------------------


class ShotCheckOrder(StrictModel):
    """Payload джоба `shot_check`: какая версия какого кадра, с чьими фасами сверять лицо и что
    спросить об анахронизмах (нет — проверка выключена в профиле)."""

    episode_id: str = Field(pattern=EPISODE_ID_PATTERN)
    channel: Channel
    shot_id: str = Field(pattern=SHOT_ID_PATTERN)
    version: int = Field(ge=1)
    appearances: list[str] = []
    check: AnachronismOrder | None = None


class NoChosenImage(LookupError):
    """Проверять нечего: у кадра нет выбранной картинки (в API — 404)."""


class NothingToCheck(Exception):
    """Персонажей нет и проверка анахронизмов выключена (в API — 409)."""


def check_order(
    paths: StudioPaths,
    project: Project,
    director: Director,
    *,
    channel: Channel,
    shot_id: str,
) -> ShotCheckOrder:
    """Заказ перепроверки выбранной версии кадра действующего плана. Кадр в плане проверяет
    вызывающий. Ничего не пишет."""
    state = project.shots.get(shot_id)
    version = None if state is None else state.image_version
    if version is None:
        if shot_assets.image_versions(project, shot_id):
            raise NoChosenImage(
                f"У кадра {shot_id} не выбрана картинка — выберите версию, потом проверяйте."
            )
        raise NoChosenImage(f"У кадра {shot_id} ещё нет картинок — сначала сгенерируйте кадр.")
    shot = next(s for s in effective_plan(director, project).shots if s.id == shot_id)
    check = anachronism.order_for(paths, channel, plan_canon_ref(director), shot.image.period)
    if not shot.image.appearances and check is None:
        raise NothingToCheck(
            f"В кадре {shot_id} нет персонажей, а проверка анахронизмов выключена в профиле"
            " канала — проверять нечего."
        )
    return ShotCheckOrder(
        episode_id=project.episode_id,
        channel=channel,
        shot_id=shot_id,
        version=version,
        appearances=list(shot.image.appearances),
        check=check,
    )


def check_cost(gateway: Gateway, order: ShotCheckOrder) -> Cost | None:
    """Цена перепроверки: вопрос об анахронизмах, если он в заказе; лицо бесплатно — None."""
    return None if order.check is None else anachronism.estimate(gateway, order.check)


def enqueue_check(conn: sqlite3.Connection, gateway: Gateway, order: ShotCheckOrder) -> Job:
    """Джоб в очередь; с вопросом к VLM — бюджет выпуска и месяца до очереди (`BudgetExceeded`,
    джоба нет), оценка держит бюджет, пока джоб ждёт."""
    cost = check_cost(gateway, order)
    if cost is not None:
        gateway.check_budget(conn, cost, episode_id=order.episode_id)
    job, _ = queue.enqueue(
        conn,
        NewJob(
            kind=CHECK_KIND,
            payload=order.model_dump(mode="json"),
            episode_id=order.episode_id,
            cost_usd_micro=None if cost is None else cost.usd_micro,
            cost_stage=None if cost is None else cost.stage,
        ),
    )
    return job


async def run_check(ctx: JobContext, order: ShotCheckOrder, checks: ShotChecks) -> dict[str, Any]:
    """Лицо (если есть персонажи) и анахронизмы версии заново; результат — в `checks` версии."""
    paths = ctx.gateway.paths
    where = f"Кадр {order.shot_id} · версия {order.version}"
    ctx.progress(0.0, f"{where} · проверка")
    project = Project.model_validate(read_json(paths.project_path(order.channel, order.episode_id)))
    asset = shot_assets.find_version(project, order.shot_id, order.version)
    face = None
    if order.appearances:
        image = shot_assets.version_file(paths, order.channel, order.episode_id, asset)
        face = await asyncio.to_thread(
            checks.face.check_shot, paths, order.channel, order.appearances, image
        )
        await asyncio.to_thread(
            shot_assets.set_checks,
            paths,
            order.channel,
            order.episode_id,
            order.shot_id,
            order.version,
            AssetChecks(face=face),
        )
    found = await check_anachronism(
        checks,
        ctx,
        channel=order.channel,
        episode_id=order.episode_id,
        shot_id=order.shot_id,
        asset=asset,
        order=order.check,
    )
    labels = [
        *([] if face is None else [FACE_LABEL[face.status]]),
        *([] if found is None else [ANACHRONISM_LABEL[found.status]]),
    ]
    ctx.progress(1.0, f"{where} · {'; '.join(labels) or 'не проверено'}")
    return {
        "shot_id": order.shot_id,
        "version": order.version,
        "face": None if face is None else face.status,
        "anachronism": None if found is None else found.status,
    }


def finish_check(paths: StudioPaths, job: Job) -> None:
    """Пометка проверки меняет статус выпуска (`warning`) — пересчёт по итогу."""
    if job.episode_id is not None:
        refresh_episode_status(paths, job.episode_id)
