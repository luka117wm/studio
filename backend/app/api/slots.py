"""Полоса слотов публикации и назначение выпуска в слот. Правила — `docs/slots.md`."""

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import DbDep, PathsDep
from app.api.episodes import (
    EpisodeListItem,
    episode_item,
    load_schedule,
    require_episode,
    require_free_slot,
)
from app.models.director import Channel, StrictModel
from app.slots import schedule
from app.slots.schedule import SlotRisk, SlotState
from app.storage.db import now_iso

router = APIRouter(tags=["slots"])


class Slot(StrictModel):
    date: dt.date
    # ISO: 1 — понедельник … 7 — воскресенье; подпись пишет фронт.
    weekday: int
    episode_id: str | None
    channel: Channel | None
    state: SlotState
    risk: SlotRisk | None


class SlotAssign(StrictModel):
    """Тело `PUT /api/episodes/{id}/slot`: дата слота или null — снять со слота."""

    date: dt.date | None


@router.get("/slots")
async def list_slots(
    db: DbDep,
    paths: PathsDep,
    start: Annotated[dt.date | None, Query(alias="from")] = None,
    count: Annotated[int, Query(ge=1, le=366)] = schedule.WINDOW_SLOTS,
) -> list[Slot]:
    """Без `from` — `PAST_SLOTS` слотов до сегодняшнего дня и остальные с сегодняшнего.
    `from` округляется вверх до слота. Выпуски окна — одним запросом."""
    sched, now = load_schedule(paths)
    days = schedule.slot_dates(sched, start or schedule.window_start(sched, now), count)
    rows = db.execute(
        "SELECT id, channel, stage, status, slot_date FROM episodes"
        " WHERE slot_date BETWEEN ? AND ?",
        (days[0].isoformat(), days[-1].isoformat()),
    ).fetchall()
    by_date = {
        row["slot_date"]: schedule.SlotEpisode(
            id=row["id"], channel=row["channel"], stage=row["stage"], status=row["status"]
        )
        for row in rows
    }
    slots: list[Slot] = []
    for day in days:
        episode = by_date.get(day.isoformat())
        slots.append(
            Slot.model_validate(
                {
                    "date": day,
                    "weekday": day.isoweekday(),
                    "episode_id": None if episode is None else episode.id,
                    "channel": None if episode is None else episode.channel,
                    "state": schedule.slot_state(day, now, episode),
                    "risk": schedule.slot_risk(sched, day, now, episode),
                }
            )
        )
    return slots


@router.put("/episodes/{episode_id}/slot")
async def assign_slot(
    episode_id: str, body: SlotAssign, paths: PathsDep, db: DbDep
) -> EpisodeListItem:
    """Проверка и запись — в `BEGIN IMMEDIATE`: два назначения в один слот не пройдут оба.
    Повтор той же даты — 200 без изменений; прошлые слоты разрешены (опубликованный выпуск)."""
    episode = require_episode(db, episode_id)
    sched, _ = load_schedule(paths)
    db.execute("BEGIN IMMEDIATE")
    try:
        if body.date is not None:
            require_free_slot(db, sched, body.date, episode.id)
        slot_date = None if body.date is None else body.date.isoformat()
        if slot_date != episode.slot_date:
            db.execute(
                "UPDATE episodes SET slot_date = ?, updated_at = ? WHERE id = ?",
                (slot_date, now_iso(), episode.id),
            )
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return episode_item(db, paths, episode.id)
