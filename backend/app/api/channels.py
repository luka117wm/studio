"""Каналы: реестр — таблица `channels`, содержимое — `profile.json` канала."""

import sqlite3

from fastapi import APIRouter, HTTPException

from app.api.deps import DbDep, PathsDep
from app.models.channel import ChannelPatch, ChannelProfile
from app.storage.atomic import read_json, write_json_atomic
from app.storage.paths import StudioPaths
from app.tools.seed import SEED_COMMAND

router = APIRouter(tags=["channels"])


def read_profile(paths: StudioPaths, channel_id: str) -> ChannelProfile:
    return ChannelProfile.model_validate(read_json(paths.profile_path(channel_id)))


@router.get("/channels")
async def list_channels(paths: PathsDep, db: DbDep) -> list[ChannelProfile]:
    rows = db.execute("SELECT id FROM channels ORDER BY rowid").fetchall()
    return [read_profile(paths, row["id"]) for row in rows]


def require_channel(db: sqlite3.Connection, channel_id: str) -> None:
    row = db.execute("SELECT id FROM channels WHERE id = ?", (channel_id,)).fetchone()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail=f"Канал «{channel_id}» не найден. Создайте каналы: {SEED_COMMAND}",
        )


@router.get("/channels/{channel_id}")
async def get_channel(channel_id: str, paths: PathsDep, db: DbDep) -> ChannelProfile:
    require_channel(db, channel_id)
    return read_profile(paths, channel_id)


@router.patch("/channels/{channel_id}")
async def patch_channel(
    channel_id: str, body: ChannelPatch, paths: PathsDep, db: DbDep
) -> ChannelProfile:
    """Семена ниши (M4.8) и проверки кадров (M6.6): присланные поля, остальной профиль не
    меняется; запись — temp → rename (L-003)."""
    require_channel(db, channel_id)
    update = body.model_dump(exclude_none=True, exclude_unset=True)
    profile = read_profile(paths, channel_id)
    profile = ChannelProfile.model_validate({**profile.model_dump(), **update})
    write_json_atomic(paths.profile_path(channel_id), profile.model_dump(mode="json"))
    return profile
