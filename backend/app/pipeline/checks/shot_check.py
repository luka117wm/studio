"""Перепроверка выбранной версии кадра — джоб `shot_check` (M6.5; устав M6, решение 7).

`POST /api/projects/{id}/shots/{shot_id}/check`: бесплатно, ничего не рисует. Версия — выбранная
на момент постановки, облики — кадра действующего плана. Результат заменяет проверку лица версии,
другие проверки (анахронизмы, M6.6) остаются. Контракт — `docs/generation.md`, «Проверка лица».
"""

import asyncio
import sqlite3
from typing import Any

from pydantic import Field

from app.jobs import queue
from app.jobs.queue import Job, NewJob
from app.jobs.worker import JobContext
from app.models.director import EPISODE_ID_PATTERN, SHOT_ID_PATTERN, Channel, Director, StrictModel
from app.models.project import AssetChecks, FaceStatus, Project
from app.pipeline.checks.face import FaceChecker
from app.pipeline.director_import import effective_plan
from app.pipeline.images import shot_assets
from app.pipeline.images.status import refresh_episode_status
from app.storage.atomic import read_json
from app.storage.paths import StudioPaths

CHECK_KIND = "shot_check"

FACE_LABEL: dict[FaceStatus, str] = {
    "ok": "похож на фас",
    "low": "не похож на фас — посмотрите кадр",
    "no_face": "лиц в кадре нет",
    "skipped": "не проверено",
}


class ShotCheckOrder(StrictModel):
    """Payload джоба `shot_check`: какая версия какого кадра и с чьими фасами сверять."""

    episode_id: str = Field(pattern=EPISODE_ID_PATTERN)
    channel: Channel
    shot_id: str = Field(pattern=SHOT_ID_PATTERN)
    version: int = Field(ge=1)
    appearances: list[str] = Field(min_length=1)


class NoChosenImage(LookupError):
    """Проверять нечего: у кадра нет выбранной картинки (в API — 404)."""


class NothingToCheck(Exception):
    """У кадра нет обликов — сравнивать лицо не с чем (в API — 409)."""


def check_order(
    project: Project, director: Director, *, channel: Channel, shot_id: str
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
    if not shot.image.appearances:
        raise NothingToCheck(f"В кадре {shot_id} нет персонажей — сравнивать лицо не с чем.")
    return ShotCheckOrder(
        episode_id=project.episode_id,
        channel=channel,
        shot_id=shot_id,
        version=version,
        appearances=list(shot.image.appearances),
    )


def enqueue_check(conn: sqlite3.Connection, order: ShotCheckOrder) -> Job:
    """Джоб в очередь; бесплатный — бюджет не проверяется."""
    job, _ = queue.enqueue(
        conn,
        NewJob(kind=CHECK_KIND, payload=order.model_dump(mode="json"), episode_id=order.episode_id),
    )
    return job


async def run_check(ctx: JobContext, order: ShotCheckOrder, checker: FaceChecker) -> dict[str, Any]:
    """Проверка лица версии заново; результат — в `checks.face` версии."""
    paths = ctx.gateway.paths
    where = f"Кадр {order.shot_id} · версия {order.version}"
    ctx.progress(0.0, f"{where} · проверка лица")
    project = Project.model_validate(read_json(paths.project_path(order.channel, order.episode_id)))
    asset = shot_assets.find_version(project, order.shot_id, order.version)
    image = shot_assets.version_file(paths, order.channel, order.episode_id, asset)
    face = await asyncio.to_thread(
        checker.check_shot, paths, order.channel, order.appearances, image
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
    status = None if face is None else face.status
    ctx.progress(1.0, f"{where} · {FACE_LABEL[status] if status else 'обликов нет'}")
    return {"shot_id": order.shot_id, "version": order.version, "face": status}


def finish_check(paths: StudioPaths, job: Job) -> None:
    """Пометка проверки меняет статус выпуска (`warning`) — пересчёт по итогу."""
    if job.episode_id is not None:
        refresh_episode_status(paths, job.episode_id)
