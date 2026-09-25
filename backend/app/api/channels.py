"""Каналы: реестр — таблица `channels`, содержимое — `profile.json` канала."""

from fastapi import APIRouter, HTTPException

from app.api.deps import DbDep, PathsDep
from app.models.channel import ChannelProfile
from app.storage.atomic import read_json
from app.storage.paths import StudioPaths

router = APIRouter(tags=["channels"])


def read_profile(paths: StudioPaths, channel_id: str) -> ChannelProfile:
    return ChannelProfile.model_validate(read_json(paths.profile_path(channel_id)))


@router.get("/channels")
async def list_channels(paths: PathsDep, db: DbDep) -> list[ChannelProfile]:
    rows = db.execute("SELECT id FROM channels ORDER BY rowid").fetchall()
    return [read_profile(paths, row["id"]) for row in rows]


@router.get("/channels/{channel_id}")
async def get_channel(channel_id: str, paths: PathsDep, db: DbDep) -> ChannelProfile:
    row = db.execute("SELECT id FROM channels WHERE id = ?", (channel_id,)).fetchone()
    if row is None:
        raise HTTPException(
            status_code=404,
            detail=f"Канал «{channel_id}» не найден. Создайте каналы: python -m app.tools.seed",
        )
    return read_profile(paths, channel_id)
