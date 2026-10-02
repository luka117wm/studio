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


def readable_errors(exc: ValidationError) -> list[dict[str, Any]]:
    """Ошибки pydantic с `msg` по-русски для частых случаев правки; форма списка — как у FastAPI."""
    errors: list[dict[str, Any]] = json.loads(exc.json(include_url=False))
    for error in errors:
        field = _field_path(error["loc"])
        kind = error["type"]
        if kind == "extra_forbidden":
            error["msg"] = f"Лишнее поле {field} — уберите его из запроса."
        elif kind == "missing":
            error["msg"] = f"Нет обязательного поля {field}."
        elif kind == "literal_error":
            # ctx pydantic: "'none', 'structure_clone' or 'own_version'".
            expected = error.get("ctx", {}).get("expected", "")
            allowed = expected.replace(" or ", ", ").replace("'", "")
            value = error["input"]
            error["msg"] = f"Поле {field}: недопустимое значение «{value}», допустимо: {allowed}."
        elif kind == "string_type":
            error["msg"] = f"Поле {field} должно быть строкой."
    return errors


def _field_path(loc: list[str | int]) -> str:
    """`["brief", "sources", 0, "url"]` → `brief.sources[0].url`."""
    path = ""
    for part in loc:
        path += f"[{part}]" if isinstance(part, int) else (f".{part}" if path else part)
    return path or "тело запроса"


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
        raise HTTPException(status_code=422, detail=readable_errors(exc)) from exc

    write_json_atomic(path, project.model_dump(mode="json"))
    return project
