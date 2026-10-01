"""Расписание публикаций и состояния слота.

Одно расписание на оба канала (решение 3 устава M3): `data/schedule.json` —
`{anchor, every_days, risk_days}`. Слот — дата `anchor + k × every_days` для любого целого k.
Правится руками до экрана настроек (M11) и читается на каждый запрос — перезапуск не нужен.

Всё, кроме `load_schedule`, — чистые функции: «сегодня» и выпуск в слоте приходят аргументами.
«Сегодня» — локальная дата машины (`today()`): бэкенд и браузер на одном ноутбуке.
"""

import datetime as dt
import logging
from dataclasses import dataclass
from typing import Literal

from pydantic import Field

from app.models.director import StrictModel
from app.storage.atomic import read_json, write_json_atomic
from app.storage.paths import StudioPaths

log = logging.getLogger(__name__)

SlotState = Literal["published", "missed", "today", "filled", "empty"]
RiskLevel = Literal["warning", "failed"]
# Код причины риска; текст по нему пишет фронт.
RiskReason = Literal["script_not_ready", "shots_incomplete", "shots_failed", "not_exported"]

# Окно полосы по умолчанию: столько слотов до сегодняшнего, остальные — с сегодняшнего (артборд 1).
PAST_SLOTS = 3
WINDOW_SLOTS = 11
# Стадии, на которых выпуск ещё не готов к слоту: до экспорта.
_NOT_READY = frozenset({"idea", "script", "generate", "edit"})
_REASON_BY_STAGE: dict[str, RiskReason] = {
    "idea": "script_not_ready",
    "script": "script_not_ready",
    "generate": "shots_incomplete",
    "edit": "not_exported",
    "export": "not_exported",
}


class Schedule(StrictModel):
    anchor: dt.date
    every_days: int = Field(default=2, ge=1)
    # Будущий слот ближе стольких дней с неготовым выпуском — риск.
    risk_days: int = Field(default=2, ge=0)


class ScheduleError(Exception):
    """`data/schedule.json` не читается: текст — что случилось и что сделать."""


@dataclass(frozen=True)
class SlotEpisode:
    """Выпуск в слоте — ровно то, что нужно состоянию и риску."""

    id: str
    channel: str
    stage: str
    status: str


class SlotRisk(StrictModel):
    level: RiskLevel
    reason: RiskReason


def today() -> dt.date:
    """Локальная дата машины. Тесты подменяют эту функцию."""
    return dt.date.today()


def load_schedule(paths: StudioPaths, now: dt.date) -> Schedule:
    """Нет файла — расписание с якорем «сегодня», файл пишется сразу (атомарно)."""
    path = paths.schedule_path
    if not path.exists():
        schedule = Schedule(anchor=now)
        write_json_atomic(path, schedule.model_dump(mode="json"))
        log.info("schedule created: %s (anchor %s)", path, now)
        return schedule
    try:
        return Schedule.model_validate(read_json(path))
    except (OSError, ValueError) as exc:
        raise ScheduleError(
            f"Расписание {path} не читается: {exc}. Исправьте файл по docs/slots.md или "
            "удалите его — создастся заново с якорем на сегодня."
        ) from exc


# --- даты --------------------------------------------------------------------------------------


def is_slot(schedule: Schedule, day: dt.date) -> bool:
    return (day - schedule.anchor).days % schedule.every_days == 0


def slot_on_or_after(schedule: Schedule, day: dt.date) -> dt.date:
    """Первый слот не раньше `day`; `%` в Python не отрицателен — работает и до якоря."""
    offset = (day - schedule.anchor).days % schedule.every_days
    return day if offset == 0 else day + dt.timedelta(days=schedule.every_days - offset)


def slot_dates(schedule: Schedule, start: dt.date, count: int) -> list[dt.date]:
    """`count` слотов подряд, начиная с первого не раньше `start`."""
    first = slot_on_or_after(schedule, start)
    step = dt.timedelta(days=schedule.every_days)
    return [first + step * i for i in range(count)]


def window_start(schedule: Schedule, now: dt.date) -> dt.date:
    """Первый слот окна по умолчанию: `PAST_SLOTS` слотов строго до сегодняшнего дня."""
    first_current = slot_on_or_after(schedule, now)
    return first_current - dt.timedelta(days=schedule.every_days * PAST_SLOTS)


def nearest_slots(schedule: Schedule, day: dt.date, each_side: int = 2) -> list[dt.date]:
    """Ближайшие слоты вокруг даты не из расписания — подсказка в ответе 422."""
    after = slot_on_or_after(schedule, day)
    step = dt.timedelta(days=schedule.every_days)
    return [after + step * i for i in range(-each_side, each_side)]


# --- состояние и риск --------------------------------------------------------------------------


def slot_state(day: dt.date, now: dt.date, episode: SlotEpisode | None) -> SlotState:
    """Опубликованный выпуск — `published` при любой дате; дальше — сегодня, прошлое, будущее.
    Прошлый слот без опубликованного выпуска — `missed`, даже если он пуст."""
    if episode is not None and episode.status == "published":
        return "published"
    if day == now:
        return "today"
    if day < now:
        return "missed"
    return "empty" if episode is None else "filled"


def slot_risk(
    schedule: Schedule, day: dt.date, now: dt.date, episode: SlotEpisode | None
) -> SlotRisk | None:
    """Риск — у сегодняшнего и будущих слотов с неопубликованным выпуском:
    - статус `failed` → `failed`, `warning` → `warning` — на любом расстоянии;
    - стадия до экспорта и до слота не больше `risk_days` дней → `warning`, в день слота — `failed`.
    Стадия `publish` — выпуск экспортирован, свой риск публикации добавит M10."""
    if episode is None or day < now or episode.status == "published":
        return None
    reason = _REASON_BY_STAGE.get(episode.stage)
    if reason is None:
        return None
    if episode.stage == "generate" and episode.status == "failed":
        reason = "shots_failed"
    days_left = (day - now).days
    level: RiskLevel
    if episode.status == "failed":
        level = "failed"
    elif episode.status == "warning":
        level = "warning"
    elif episode.stage in _NOT_READY and days_left <= schedule.risk_days:
        level = "failed" if days_left == 0 else "warning"
    else:
        return None
    return SlotRisk(level=level, reason=reason)
