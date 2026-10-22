"""Картинка кадра: версии (M6.1) — список, выбор, миниатюра и файл; отрисовка одного кадра
джобом `shot_image` (M6.2); перерисовка новым вариантом и «С правкой…» (M6.4). Контракт —
`docs/generation.md`.

Кадр — из текущего плана: в project.json у каждого кадра плана есть состояние, убранные —
`removed` (M2.4). Версия — только своего кадра. Файлы версий неизменяемы, поэтому отдаются с
долгим кэшем.
"""

import sqlite3
from typing import cast, get_args

from fastapi import APIRouter, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.api.deps import CanonConfigDep, DbDep, GatewayDep, JobsDep, PathsDep
from app.api.director import read_version
from app.api.episodes import Episode, require_episode
from app.api.projects import patched_project
from app.cost.budget import BudgetExceeded
from app.cost.money import Money, format_unit_usd
from app.jobs.queue import Job
from app.models.director import StrictModel
from app.models.project import Asset, Project
from app.pipeline.images import shot_assets, shot_job
from app.pipeline.images.shot_assets import ShotImages, VersionNotFound
from app.pipeline.images.shot_job import OrderRefused, ShotNotInPlan
from app.providers.base import RouteError
from app.storage.atomic import read_json, update_lock, write_json_atomic
from app.storage.paths import StudioPaths
from app.storage.thumbs import ThumbWidth

router = APIRouter(prefix="/projects/{episode_id}/shots/{shot_id}", tags=["shots"])

IMMUTABLE = "public, max-age=31536000, immutable"  # файл версии пишется один раз
THUMB_WIDTHS: tuple[int, ...] = get_args(ThumbWidth)


class ShotGenerate(StrictModel):
    """Тело `POST …/generate`: модель — ключ каталога `images` или ID модели из него; нет —
    профиль качества по умолчанию."""

    model: str | None = Field(default=None, min_length=1)


class RedrawBody(StrictModel):
    """Тело `POST …/redraw`: модель (как у заказа кадра) и, у «С правкой…», новое действие кадра —
    оно пишется в `user_override.image.prompt` и проверяется стоп-листом, как правка на листе."""

    model: str | None = Field(default=None, min_length=1)
    prompt: str | None = None


class RedrawEstimate(BaseModel):
    """Цена перерисовки до клика: «Перерисовать (~$0.07)», «Добавить версию (~$0.07)»."""

    shot_id: str
    variant: int  # какой вариант нарисуется
    model: str  # ключ каталога `images`
    model_id: str
    usd: Money  # цена кадра, кэш не вычтен


@router.post("/redraw", status_code=201)
async def redraw_shot(
    episode_id: str,
    shot_id: str,
    body: RedrawBody,
    paths: PathsDep,
    db: DbDep,
    gateway: GatewayDep,
    config: CanonConfigDep,
    jobs: JobsDep,
) -> Job:
    """«Перерисовать», «Добавить версию», «С правкой…»: джоб `shot_image` следующим свободным
    вариантом, в том числе при незаконченном джобе того же кадра. Новая версия выбирается сама,
    только если картинки нет или выбранная устарела. С `prompt` — сначала правка действия; отказ
    (стилевой токен, пустое действие — 422; проблемы — 409; бюджет — 409) правку не пишет."""
    episode = require_episode(db, episode_id)
    path = paths.project_path(episode.channel, episode.id)
    try:
        with update_lock(path):
            current = read_json(path)
            project = Project.model_validate(current)
            director = read_version(paths, episode, project.director_version)
            if body.prompt is not None:
                shot_job.plan_shot(project, director, shot_id)  # кадра нет — 404, не 422 правки
                edit = {"user_override": {"image": {"prompt": body.prompt}}}
                project = patched_project(paths, episode, current, {"shots": {shot_id: edit}})
            order = shot_job.redraw_order(
                db,
                paths,
                gateway,
                config,
                channel=episode.channel,
                project=project,
                director=director,
                shot_id=shot_id,
                model=body.model,
            )
            # Бюджет — до записи правки: отказ не оставляет на диске ничего.
            gateway.check_budget(db, shot_job.order_cost(gateway, order), episode_id=episode.id)
            if body.prompt is not None:
                write_json_atomic(path, project.model_dump(mode="json"))
        job = shot_job.enqueue_shot(db, gateway, paths, order, allow_busy=True)
    except ShotNotInPlan as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RouteError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except OrderRefused as exc:
        raise HTTPException(status_code=409, detail=exc.refusal.model_dump(mode="json")) from exc
    except BudgetExceeded as exc:
        raise HTTPException(status_code=409, detail=exc.detail()) from exc
    jobs.kick()
    return job


@router.get("/redraw/estimate")
async def redraw_estimate(
    episode_id: str,
    shot_id: str,
    paths: PathsDep,
    db: DbDep,
    gateway: GatewayDep,
    config: CanonConfigDep,
    model: str | None = None,
) -> RedrawEstimate:
    """Какой вариант и почём нарисует `POST …/redraw` с этой моделью. Ничего не пишет."""
    episode = require_episode(db, episode_id)
    project = Project.model_validate(read_json(paths.project_path(episode.channel, episode.id)))
    director = read_version(paths, episode, project.director_version)
    try:
        order = shot_job.redraw_order(
            db,
            paths,
            gateway,
            config,
            channel=episode.channel,
            project=project,
            director=director,
            shot_id=shot_id,
            model=model,
        )
    except ShotNotInPlan as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RouteError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except OrderRefused as exc:
        raise HTTPException(status_code=409, detail=exc.refusal.model_dump(mode="json")) from exc
    cost = shot_job.order_cost(gateway, order)
    return RedrawEstimate(
        shot_id=shot_id,
        variant=order.variant,
        model=order.model,
        model_id=order.model_id,
        usd=Money(usd_micro=cost.usd_micro, usd=format_unit_usd(cost.usd_micro)),
    )


@router.post("/generate", status_code=201)
async def generate_shot(
    episode_id: str,
    shot_id: str,
    body: ShotGenerate,
    paths: PathsDep,
    db: DbDep,
    gateway: GatewayDep,
    config: CanonConfigDep,
    jobs: JobsDep,
) -> Job:
    """Один кадр — джоб `shot_image`, вариант 1 (пачка — M6.3, перерисовка — M6.4). Отказы до
    очереди: план не утверждён, проблемы сборщика, кадр уже рисуется, бюджет — 409; кадра нет в
    действующем плане — 404; модель не из каталога — 422."""
    episode = require_episode(db, episode_id)
    project = Project.model_validate(read_json(paths.project_path(episode.channel, episode.id)))
    director = read_version(paths, episode, project.director_version)
    try:
        order = shot_job.shot_order(
            paths,
            gateway,
            config,
            channel=episode.channel,
            project=project,
            director=director,
            shot_id=shot_id,
            model=body.model,
        )
        job = shot_job.enqueue_shot(db, gateway, paths, order)
    except ShotNotInPlan as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RouteError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except OrderRefused as exc:
        raise HTTPException(status_code=409, detail=exc.refusal.model_dump(mode="json")) from exc
    except BudgetExceeded as exc:
        raise HTTPException(status_code=409, detail=exc.detail()) from exc
    jobs.kick()
    return job


@router.get("/images")
async def get_shot_images(episode_id: str, shot_id: str, paths: PathsDep, db: DbDep) -> ShotImages:
    """Версии картинки кадра с метаданными, новые сверху, и выбранная версия."""
    _, project = _shot_of_plan(paths, db, episode_id, shot_id)
    return shot_assets.shot_images(project, shot_id)


@router.post("/images/{version}/choose")
async def choose_shot_image(
    episode_id: str, shot_id: str, version: int, paths: PathsDep, db: DbDep
) -> ShotImages:
    """Выбранная версия идёт в монтаж; кадр — `done`."""
    episode, _ = _shot_of_plan(paths, db, episode_id, shot_id)
    try:
        project = shot_assets.choose_image_version(
            paths, episode.channel, episode.id, shot_id, version
        )
    except VersionNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return shot_assets.shot_images(project, shot_id)


@router.get("/images/{version}/thumb")
async def get_shot_image_thumb(
    episode_id: str, shot_id: str, version: int, paths: PathsDep, db: DbDep, w: int = 320
) -> FileResponse:
    """Миниатюра webp версии (принцип 12), `w` — 160 или 320; нет файла — строится сейчас."""
    if w not in THUMB_WIDTHS:
        raise RequestValidationError(
            [
                {
                    "type": "thumb_width",
                    "loc": ("query", "w"),
                    "msg": f"Ширины миниатюры {w} нет — есть 160 и 320.",
                    "input": w,
                }
            ]
        )
    episode, asset = _version(paths, db, episode_id, shot_id, version)
    path = shot_assets.version_thumb(paths, episode.channel, episode.id, asset, cast(ThumbWidth, w))
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": IMMUTABLE})


@router.get("/images/{version}/file")
async def get_shot_image_file(
    episode_id: str, shot_id: str, version: int, paths: PathsDep, db: DbDep
) -> FileResponse:
    """Картинка версии как есть; тип — по расширению файла."""
    episode, asset = _version(paths, db, episode_id, shot_id, version)
    path = shot_assets.version_file(paths, episode.channel, episode.id, asset)
    media_type = shot_assets.MEDIA_TYPES.get(path.suffix.removeprefix("."))
    return FileResponse(path, media_type=media_type, headers={"Cache-Control": IMMUTABLE})


def _shot_of_plan(
    paths: StudioPaths, db: sqlite3.Connection, episode_id: str, shot_id: str
) -> tuple[Episode, Project]:
    """Выпуск и его project.json, если кадр есть в текущем плане; иначе 404 по-русски."""
    episode = require_episode(db, episode_id)
    project = Project.model_validate(read_json(paths.project_path(episode.channel, episode.id)))
    state = project.shots.get(shot_id)
    if project.director_version is None:
        detail = "План ещё не импортирован — кадров нет. Импортируйте план на экране «Сценарий»."
    elif state is None:
        detail = f"Кадра {shot_id} нет в плане {project.director_version} — проверьте id кадра."
    elif state.status == "removed":
        detail = f"Кадр {shot_id} убран из плана {project.director_version} — картинок у него нет."
    else:
        return episode, project
    raise HTTPException(status_code=404, detail=detail)


def _version(
    paths: StudioPaths, db: sqlite3.Connection, episode_id: str, shot_id: str, version: int
) -> tuple[Episode, Asset]:
    episode, project = _shot_of_plan(paths, db, episode_id, shot_id)
    try:
        return episode, shot_assets.find_version(project, shot_id, version)
    except VersionNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
