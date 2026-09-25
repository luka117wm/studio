"""Импорт версии плана и чтение версий: `director/vNNN.json` неизменяемы, мёрдж — в project.json.

`POST /api/projects/{id}/director` принимает одну часть или план целиком. Части копятся в
`cache/director_parts/` (часть 1 начинает новый набор), неполный набор — 409 с перечнем недостающих;
после последней части план собирается, проходит валидацию целиком и импортируется как один файл.
Повторный импорт того же плана (хэш канонического JSON) версию не создаёт.
"""

import logging
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from app.api.deps import DbDep, PathsDep
from app.api.episodes import Episode, require_episode
from app.models.director import Director
from app.models.project import DIRECTOR_VERSION_PATTERN, DirectorVersionInfo, Project
from app.models.validators import DirectorValidationError, validate_director
from app.pipeline.director_import import (
    ImportResult,
    PartsError,
    assemble_parts,
    canonical_hash,
    merge_into_project,
)
from app.pipeline.director_import.merge import director_to_json
from app.storage.atomic import read_json, write_json_atomic
from app.storage.db import now_iso
from app.storage.paths import StudioPaths

log = logging.getLogger(__name__)
router = APIRouter(tags=["director"])

_VERSION_RE = re.compile(DIRECTOR_VERSION_PATTERN)
_PART_FILE_RE = re.compile(r"^part-(\d{2})\.json$")


@router.post("/projects/{episode_id}/director")
async def import_director(
    episode_id: str, body: dict[str, Any], paths: PathsDep, db: DbDep
) -> ImportResult:
    """Одна часть или план целиком → версия на диске → мёрдж по `shot.id` → отчёт расхождений.

    422 — ошибки валидации списком (`detail.errors`); 409 — набор частей неполон или части не
    сходятся (`detail.received`, `detail.missing`). Диск и project.json — без `await`: относительно
    других запросов импорт последователен (L-014).
    """
    episode = require_episode(db, episode_id)
    try:
        part = validate_director(body)
    except DirectorValidationError as exc:
        raise HTTPException(status_code=422, detail={"errors": exc.errors}) from None
    _check_identity(part, episode)

    parts = 1
    director = part
    if part.meta.parts_total > 1:
        parts = part.meta.parts_total
        director = _collect_part(paths, episode, part)

    project_path = paths.project_path(episode.channel, episode.id)
    project = Project.model_validate(read_json(project_path))
    digest = canonical_hash(director)
    known = next((v for v in project.director_versions.values() if v.hash == digest), None)

    if known is not None and known.version == project.director_version:
        return ImportResult(
            version=known.version, created=False, added=0, changed=0, removed=0, changes=[]
        )
    if known is not None:
        version, created = known.version, False
    else:
        version = _next_version(paths, episode, project)
        write_json_atomic(
            paths.director_version_path(episode.channel, episode.id, int(version[1:])),
            director_to_json(director),
        )
        created = True

    previous = _read_version(paths, episode, project.director_version)
    merged, result = merge_into_project(
        project, previous, director, version, parts=parts, created=created, now=now_iso()
    )
    write_json_atomic(project_path, merged.model_dump(mode="json"))
    _clear_parts(paths, episode)
    log.info(
        "director import %s/%s: %s (+%d ~%d -%d)",
        episode.channel,
        episode.id,
        version,
        result.added,
        result.changed,
        result.removed,
    )
    return result


@router.get("/projects/{episode_id}/director/versions")
async def list_director_versions(
    episode_id: str, paths: PathsDep, db: DbDep
) -> list[DirectorVersionInfo]:
    episode = require_episode(db, episode_id)
    project = Project.model_validate(read_json(paths.project_path(episode.channel, episode.id)))
    return [project.director_versions[key] for key in sorted(project.director_versions)]


@router.get("/projects/{episode_id}/director/{version}")
async def get_director_version(
    episode_id: str, version: str, paths: PathsDep, db: DbDep
) -> dict[str, Any]:
    """Файл версии как есть."""
    episode = require_episode(db, episode_id)
    if not _VERSION_RE.fullmatch(version):
        raise HTTPException(status_code=404, detail=f"Версия «{version}» не по формату vNNN.")
    path = paths.director_version_path(episode.channel, episode.id, int(version[1:]))
    if not path.is_file():
        raise HTTPException(
            status_code=404, detail=f"Версия {version} плана выпуска «{episode.id}» не найдена."
        )
    data: dict[str, Any] = read_json(path)
    return data


# --- вспомогательное ------------------------------------------------------------------------------


def _check_identity(director: Director, episode: Episode) -> None:
    problems = []
    if director.meta.episode_id != episode.id:
        problems.append(
            f"meta: episode_id «{director.meta.episode_id}» — план для другого выпуска, "
            f"ожидалось «{episode.id}»"
        )
    if director.meta.channel != episode.channel:
        problems.append(
            f"meta: channel «{director.meta.channel}» — план для другого канала, "
            f"ожидалось «{episode.channel}»"
        )
    if problems:
        raise HTTPException(status_code=422, detail={"errors": problems})


def _collect_part(paths: StudioPaths, episode: Episode, part: Director) -> Director:
    """Кладёт часть в набор; возвращает собранный план, когда набор полон, иначе поднимает 409."""
    parts_dir = paths.director_parts_dir(episode.channel, episode.id)
    number, total = part.meta.part, part.meta.parts_total

    if number == 1:
        _clear_parts(paths, episode)
    else:
        first_path = paths.director_part_path(episode.channel, episode.id, 1)
        if not first_path.is_file():
            raise HTTPException(
                status_code=409,
                detail={
                    "received": [],
                    "missing": [n for n in range(1, total + 1) if n != number],
                    "message": f"Получена часть {number} из {total}, но части 1 ещё не было. "
                    "Сначала отправьте часть 1.",
                },
            )
        first = Director.model_validate(read_json(first_path))
        if first.meta.parts_total != total:
            raise HTTPException(
                status_code=409,
                detail={
                    "received": _received(parts_dir),
                    "missing": [],
                    "message": f"Часть {number}: parts_total = {total}, а в части 1 — "
                    f"{first.meta.parts_total}. Отправьте набор заново, начиная с части 1.",
                },
            )
    write_json_atomic(
        paths.director_part_path(episode.channel, episode.id, number), director_to_json(part)
    )

    received = _received(parts_dir)
    missing = [n for n in range(1, total + 1) if n not in received]
    if missing:
        raise HTTPException(
            status_code=409,
            detail={
                "received": received,
                "missing": missing,
                "message": f"Получена часть {number} из {total}, не хватает: "
                + ", ".join(str(n) for n in missing),
            },
        )
    loaded = [
        Director.model_validate(read_json(paths.director_part_path(episode.channel, episode.id, n)))
        for n in received
    ]
    try:
        return assemble_parts(loaded)
    except (PartsError, DirectorValidationError) as exc:
        # Части остаются на месте: исправленную часть можно прислать одну, без остальных.
        raise HTTPException(status_code=422, detail={"errors": exc.errors}) from None


def _received(parts_dir: Path) -> list[int]:
    if not parts_dir.is_dir():
        return []
    numbers = []
    for entry in parts_dir.iterdir():
        match = _PART_FILE_RE.fullmatch(entry.name)
        if match:
            numbers.append(int(match.group(1)))
    return sorted(numbers)


def _clear_parts(paths: StudioPaths, episode: Episode) -> None:
    parts_dir = paths.director_parts_dir(episode.channel, episode.id)
    if not parts_dir.is_dir():
        return
    for entry in parts_dir.iterdir():
        if _PART_FILE_RE.fullmatch(entry.name):
            entry.unlink()


def _next_version(paths: StudioPaths, episode: Episode, project: Project) -> str:
    """Следующий номер по индексу project.json; файл с таким номером на диске — не перезапись."""
    numbers = [int(v[1:]) for v in project.director_versions]
    version = f"v{(max(numbers) + 1 if numbers else 1):03d}"
    path = paths.director_version_path(episode.channel, episode.id, int(version[1:]))
    if path.exists():
        raise HTTPException(
            status_code=409,
            detail=f"Файл {path} уже есть, но в project.json версии {version} нет. "
            "Уберите файл или восстановите индекс director_versions.",
        )
    return version


def _read_version(paths: StudioPaths, episode: Episode, version: str | None) -> Director | None:
    if version is None:
        return None
    path = paths.director_version_path(episode.channel, episode.id, int(version[1:]))
    return Director.model_validate(read_json(path))
