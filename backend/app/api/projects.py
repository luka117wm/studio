"""project.json выпуска: чтение и частичное обновление с атомарной записью."""

import json
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from app.api.deps import DbDep, PathsDep
from app.api.episodes import require_episode
from app.models.project import Project, merge_patch
from app.storage.atomic import read_json, write_json_atomic
from app.storage.db import now_iso

router = APIRouter(tags=["projects"])

# Идентичность файла задаётся при создании выпуска; PATCH её не меняет.
IMMUTABLE_KEYS = ("schema", "episode_id", "channel")


@router.get("/projects/{episode_id}")
async def get_project(episode_id: str, paths: PathsDep, db: DbDep) -> Project:
    episode = require_episode(db, episode_id)
    return Project.model_validate(read_json(paths.project_path(episode.channel, episode.id)))


@router.patch("/projects/{episode_id}")
async def patch_project(
    episode_id: str, patch: dict[str, Any], paths: PathsDep, db: DbDep
) -> Project:
    """Словари сливаются рекурсивно, остальное заменяется; `updated_at` ставит сервер.

    Чтение и запись идут без `await` — относительно других запросов операция последовательна.
    """
    episode = require_episode(db, episode_id)
    path = paths.project_path(episode.channel, episode.id)
    current = read_json(path)

    changed = [k for k in IMMUTABLE_KEYS if k in patch and patch[k] != current.get(k)]
    if changed:
        raise HTTPException(
            status_code=422,
            detail=f"Поля {', '.join(changed)} менять нельзя — уберите их из запроса.",
        )

    merged = merge_patch(current, patch)
    merged["updated_at"] = now_iso()
    try:
        project = Project.model_validate(merged)
    except ValidationError as exc:
        raise HTTPException(
            status_code=422, detail=json.loads(exc.json(include_url=False))
        ) from exc

    write_json_atomic(path, project.model_dump(mode="json"))
    return project
