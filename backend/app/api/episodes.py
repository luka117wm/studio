"""Выпуски: строка в `episodes` + дерево `data/projects/<channel>/<episode>/` с `project.json`."""

import sqlite3
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import Field

from app.api.deps import DbDep, PathsDep
from app.models.director import EPISODE_ID_PATTERN, Channel, StrictModel
from app.models.project import empty_project
from app.storage.atomic import write_json_atomic
from app.storage.db import now_iso

router = APIRouter(tags=["episodes"])

# Этап доски и состояние — как в оболочке (`frontend/src/mocks/fixtures.ts`); уточняются в M3.
EpisodeStage = Literal["idea", "script", "generate", "edit", "export", "publish"]
EpisodeStatus = Literal["queued", "generating", "warning", "ready", "failed", "published"]


class EpisodeCreate(StrictModel):
    id: str = Field(pattern=EPISODE_ID_PATTERN)
    channel: Channel
    title: str = Field(min_length=1)
    short_title: str | None = None


class Episode(StrictModel):
    id: str
    channel: Channel
    title: str
    short_title: str | None = None
    stage: EpisodeStage
    status: EpisodeStatus
    slot_date: str | None = None
    created_at: str
    updated_at: str


def find_episode(db: sqlite3.Connection, episode_id: str) -> Episode | None:
    row = db.execute("SELECT * FROM episodes WHERE id = ?", (episode_id,)).fetchone()
    return None if row is None else Episode.model_validate(dict(row))


def require_episode(db: sqlite3.Connection, episode_id: str) -> Episode:
    episode = find_episode(db, episode_id)
    if episode is None:
        raise HTTPException(status_code=404, detail=f"Выпуск «{episode_id}» не найден.")
    return episode


@router.get("/episodes")
async def list_episodes(db: DbDep, channel: Channel | None = None) -> list[Episode]:
    if channel is None:
        rows = db.execute("SELECT * FROM episodes ORDER BY rowid").fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM episodes WHERE channel = ? ORDER BY rowid", (channel,)
        ).fetchall()
    return [Episode.model_validate(dict(row)) for row in rows]


@router.post("/episodes", status_code=201)
async def create_episode(body: EpisodeCreate, paths: PathsDep, db: DbDep) -> Episode:
    if db.execute("SELECT 1 FROM channels WHERE id = ?", (body.channel,)).fetchone() is None:
        raise HTTPException(
            status_code=404,
            detail=f"Канал «{body.channel}» не найден. Создайте каналы: python -m app.tools.seed",
        )
    if find_episode(db, body.id) is not None:
        raise HTTPException(status_code=409, detail=f"Выпуск «{body.id}» уже существует.")
    episode_dir = paths.episode_dir(body.channel, body.id)
    if episode_dir.exists():
        raise HTTPException(
            status_code=409,
            detail=f"Каталог {episode_dir} уже есть на диске. Уберите его или выберите другой id.",
        )

    for directory in paths.episode_tree(body.channel, body.id):
        directory.mkdir(parents=True, exist_ok=True)
    project = empty_project(body.channel, body.id)
    write_json_atomic(paths.project_path(body.channel, body.id), project.model_dump(mode="json"))

    now = now_iso()
    db.execute(
        "INSERT INTO episodes (id, channel, title, short_title, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (body.id, body.channel, body.title, body.short_title, now, now),
    )
    db.commit()
    return require_episode(db, body.id)


@router.get("/episodes/{episode_id}")
async def get_episode(episode_id: str, db: DbDep) -> Episode:
    return require_episode(db, episode_id)
