"""Контракт project.json (`studio.project/1`) — реализация эпизода.

Замысел лежит в director.json, здесь — что с ним сделали: текущая версия плана, ассеты и их
версии, тайминги кадров по выравниванию голоса, ручные правки (`*_locked`, `user_override`),
статусы кадров, стоимость по этапам. Описание — `docs/project_schema.md`.

Коллекции — объекты с ключом-идентификатором, а не массивы: тогда частичное обновление
(`PATCH /api/projects/{id}`) и мёрдж импорта плана по `shot.id` (M2.4) — одно правило
`merge_patch`. Время — float секунды; деньги — микродоллары.
"""

import re
from typing import Annotated, Any, Literal

from pydantic import ConfigDict, Field, model_validator

from app.models.director import EPISODE_ID_PATTERN, SHOT_ID_PATTERN, Channel, StrictModel
from app.storage.db import now_iso

PROJECT_SCHEMA_VERSION = "studio.project/1"
DIRECTOR_VERSION_PATTERN = r"^v\d{3}$"

ShotStatus = Literal["todo", "queued", "generating", "done", "failed", "stale"]
AssetKind = Literal["image", "voice", "animation", "sfx", "music", "thumbnail", "render"]
AssetStatus = Literal["ok", "stale", "failed"]
TimingSource = Literal["voice", "locked", "estimate"]

_SHOT_ID_RE = re.compile(SHOT_ID_PATTERN)


class ShotState(StrictModel):
    status: ShotStatus = "todo"
    duration_locked: bool = False
    prompt_locked: bool = False
    # Ручные правки полей кадра поверх плана; импорт новой версии их не затирает.
    user_override: dict[str, Any] | None = None


class Asset(StrictModel):
    id: str
    shot_id: str | None = Field(default=None, pattern=SHOT_ID_PATTERN)
    kind: AssetKind
    version: int = Field(ge=1)
    # Относительно каталога выпуска: `media/s001/v002.png`.
    path: str
    # Хэш входов (принцип 8): по нему ищется готовый ассет.
    hash: str
    status: AssetStatus = "ok"


class Timing(StrictModel):
    shot_id: str = Field(pattern=SHOT_ID_PATTERN)
    start: float = Field(ge=0.0)
    duration: float = Field(gt=0.0)
    source: TimingSource


class Project(StrictModel):
    model_config = ConfigDict(
        extra="forbid", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True
    )

    schema_version: Literal["studio.project/1"] = Field(alias="schema")
    episode_id: str = Field(pattern=EPISODE_ID_PATTERN)
    channel: Channel
    director_version: str | None = Field(default=None, pattern=DIRECTOR_VERSION_PATTERN)
    shots: dict[str, ShotState] = {}
    assets: dict[str, Asset] = {}
    timings: dict[str, Timing] = {}
    # Этап → потрачено, микродоллары.
    cost: dict[str, Annotated[int, Field(ge=0)]] = {}
    updated_at: str

    @model_validator(mode="after")
    def _keys_match_ids(self) -> "Project":
        problems = [
            f"shots: key {k!r} is not a shot id" for k in self.shots if not _SHOT_ID_RE.fullmatch(k)
        ]
        problems += [
            f"assets: key {k!r} != asset.id {a.id!r}" for k, a in self.assets.items() if k != a.id
        ]
        problems += [
            f"timings: key {k!r} != shot_id {t.shot_id!r}"
            for k, t in self.timings.items()
            if k != t.shot_id
        ]
        if problems:
            raise ValueError("; ".join(problems))
        return self


def empty_project(channel: Channel, episode_id: str) -> Project:
    return Project.model_validate(
        {
            "schema": PROJECT_SCHEMA_VERSION,
            "episode_id": episode_id,
            "channel": channel,
            "updated_at": now_iso(),
        }
    )


def merge_patch(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """Словари сливаются рекурсивно, всё остальное (скаляры, списки, null) заменяется.

    Возвращает новый словарь, аргументы не меняет.
    """
    merged = dict(base)
    for key, value in patch.items():
        current = merged.get(key)
        if isinstance(current, dict) and isinstance(value, dict):
            merged[key] = merge_patch(current, value)
        else:
            merged[key] = value
    return merged
