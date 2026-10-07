"""project.json выпуска: чтение и правка человеком с атомарной записью.

PATCH принимает только `ProjectPatch` — заявку и правки кадров (`*_locked`, `user_override`).
Остальное в project.json пишет пайплайн: импорт плана, генерация, выравнивание, учёт расходов.
Правка кадра проверяется так же, как кадр плана: план плюс правка должны пройти `Shot` и
`check_shot`. Правка промпта или крупности у нарисованного кадра делает его `stale`.
"""

import json
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from app.api.deps import DbDep, PathsDep
from app.api.director import read_version
from app.api.episodes import require_episode
from app.models.director import Director
from app.models.project import Project, ProjectPatch, ShotPatch, ShotState, merge_patch
from app.models.validators import (
    ShotContext,
    ValidationItem,
    check_shot,
    describe_error,
    describe_shot_errors,
)
from app.pipeline.director_import import apply_override, edit_stale, prune_override
from app.pipeline.director_import.effective import OVERRIDE_FIELDS, overridden_fields
from app.storage.atomic import read_json, write_json_atomic
from app.storage.db import now_iso

router = APIRouter(tags=["projects"])

# Идентичность файла задаётся при создании выпуска; PATCH её не меняет.
IMMUTABLE_KEYS = ("schema", "episode_id", "channel")
# Поля project.json, которые пишет пайплайн, а не PATCH.
PIPELINE_KEYS = tuple(
    key
    for name, info in Project.model_fields.items()
    if name not in ProjectPatch.model_fields and (key := info.alias or name) not in IMMUTABLE_KEYS
)
# Поля состояния кадра, которые пишет пайплайн: статус и причины `stale` (импорт, генерация).
PIPELINE_SHOT_KEYS = tuple(
    name for name in ShotState.model_fields if name not in ShotPatch.model_fields
)
# Эпоху и облики кадра задаёт версия плана — правкой они не меняются.
CANON_SHOT_FIELDS = ("image.period", "image.appearances")


def readable_errors(exc: ValidationError) -> list[dict[str, Any]]:
    """Ошибки pydantic с `msg` по-русски для частых случаев правки; форма списка — как у FastAPI."""
    errors: list[dict[str, Any]] = json.loads(exc.json(include_url=False))
    for error in errors:
        _readable(error)
    return errors


def patch_errors(exc: ValidationError) -> list[dict[str, Any]]:
    """Ошибки тела PATCH: поля пайплайна, правки кадров (`кадр s003: …`), остальное — как обычно."""
    errors: list[dict[str, Any]] = json.loads(exc.json(include_url=False))
    for error in errors:
        loc = error["loc"]
        extra = error["type"] == "extra_forbidden"
        if len(loc) >= 2 and loc[0] == "shots":
            error["msg"] = _shot_error(str(loc[1]), loc[2:], error)
        elif len(loc) == 1 and extra and loc[0] in IMMUTABLE_KEYS:
            error["msg"] = (
                f"Поле {loc[0]} задаётся при создании выпуска и не меняется — "
                "уберите его из запроса."
            )
        elif len(loc) == 1 and extra and loc[0] in PIPELINE_KEYS:
            error["msg"] = (
                f"Поле {loc[0]} меняется пайплайном, не через PATCH — уберите его из запроса."
            )
        else:
            _readable(error)
    return errors


def _readable(error: dict[str, Any]) -> None:
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


def _shot_error(shot_id: str, rest: list[str | int], error: dict[str, Any]) -> str:
    """Ошибка внутри `shots.<id>` — в виде ошибок плана: «кадр s003: …»."""
    prefix = f"кадр {shot_id}"
    extra = error["type"] == "extra_forbidden"
    if rest and rest[0] == "user_override":
        path = ".".join(str(p) for p in rest[1:])
        if extra and path in CANON_SHOT_FIELDS:
            return f"{prefix}: {path} правкой не меняется — его задаёт новая версия плана"
        if extra and len(rest) == 2:
            return (
                f"{prefix}: лишнее поле {path} в правке, "
                f"ожидалось одно из: {', '.join(OVERRIDE_FIELDS)}"
            )
        return f"{prefix}: {describe_error(error, path)}"
    path = ".".join(str(p) for p in rest)
    if extra and path in PIPELINE_SHOT_KEYS:
        return (
            f"{prefix}: поле {path} меняется пайплайном, не через PATCH — уберите его из запроса."
        )
    if extra:
        return (
            f"{prefix}: лишнее поле {path}, "
            "ожидалось duration_locked, prompt_locked или user_override"
        )
    return f"{prefix}: {describe_error(error, path)}"


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
    episode_id: str, body: dict[str, Any], paths: PathsDep, db: DbDep
) -> Project:
    """Тело — `ProjectPatch`. Словари сливаются рекурсивно, остальное заменяется; `null` у поля
    правки кадра — сброс этой правки. `updated_at` ставит сервер. При любой ошибке — 422, файл
    не меняется.

    Чтение и запись идут без `await` — относительно других запросов операция последовательна.
    """
    episode = require_episode(db, episode_id)
    path = paths.project_path(episode.channel, episode.id)
    current = read_json(path)
    try:
        ProjectPatch.model_validate(body)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=patch_errors(exc)) from exc

    before = Project.model_validate(current)
    shot_patches: dict[str, dict[str, Any]] = body.get("shots", {})
    director = read_version(paths, episode, before.director_version)
    _check_shot_ids(shot_patches, before, director)

    merged = merge_patch(current, body)
    edited = [shot_id for shot_id, patch in shot_patches.items() if "user_override" in patch]
    for shot_id in edited:
        state = merged["shots"][shot_id]
        override = state.get("user_override")
        merged["shots"][shot_id] = {
            **state,
            "user_override": prune_override(override) if isinstance(override, dict) else None,
        }
    merged["updated_at"] = now_iso()
    try:
        project = Project.model_validate(merged)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=readable_errors(exc)) from exc

    if edited:
        assert director is not None  # `_check_shot_ids` не пропускает правки без плана
        project = _apply_edits(project, before, director, edited)
    write_json_atomic(path, project.model_dump(mode="json"))
    return project


def _check_shot_ids(
    shot_patches: dict[str, dict[str, Any]], project: Project, director: Director | None
) -> None:
    """Править можно только кадры текущей версии плана."""
    if not shot_patches:
        return
    in_plan = {s.id for s in director.shots} if director else set()
    errors = []
    for shot_id in shot_patches:
        if director is None:
            msg = f"кадр {shot_id}: плана ещё нет — сначала импортируйте план, потом правьте кадры"
        elif shot_id in in_plan:
            continue
        elif project.shots.get(shot_id, ShotState()).status == "removed":
            msg = f"кадр {shot_id}: убран из плана {project.director_version}, править нечего"
        else:
            msg = (
                f"кадр {shot_id}: нет в плане {project.director_version}, "
                "ожидалось id кадра текущей версии"
            )
        errors.append({"type": "shot_not_in_plan", "loc": ["shots", shot_id], "msg": msg})
    if errors:
        raise HTTPException(status_code=422, detail=errors)


def _apply_edits(
    project: Project, before: Project, director: Director, shot_ids: list[str]
) -> Project:
    """Действующий кадр (план + правка) проходит проверки плана; затем — `stale` от правки.

    Ошибки — только по поправленным полям: старый кадр плана, не прошедший бы сегодняшний
    стоп-лист, не мешает править его VO.
    """
    plan = {s.id: s for s in director.shots}
    context = ShotContext.of(director)
    items: list[ValidationItem] = []
    shots = dict(project.shots)
    for shot_id in shot_ids:
        state = project.shots[shot_id]
        try:
            after = apply_override(plan[shot_id], state.user_override)
        except ValidationError as exc:
            items.extend(describe_shot_errors(exc, shot_id))
            continue
        fields = overridden_fields(state.user_override)
        problems = [
            item
            for item in check_shot(after, context)
            if any(item.path == f or item.path.startswith(f + ".") for f in fields)
        ]
        if problems:
            items.extend(problems)
            continue
        previous = before.shots.get(shot_id, ShotState()).user_override
        shots[shot_id] = edit_stale(state, apply_override(plan[shot_id], previous), after)
    if items:
        raise HTTPException(
            status_code=422,
            detail=[
                {
                    "type": "shot_override",
                    "loc": ["shots", item.shot_id, "user_override", *item.path.split(".")],
                    "msg": item.message,
                }
                for item in items
            ],
        )
    return project.model_copy(update={"shots": shots})
