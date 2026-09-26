"""Выпуски: строка в `episodes` + дерево `data/projects/<channel>/<episode>/` с `project.json`.

Ответы несут сводку для карточки доски (`models/episode_summary.py`): она считается при чтении из
файлов выпуска, журнала расходов и очереди, в БД не хранится. Контракт — `docs/episodes.md`.
"""

import logging
import re
import sqlite3
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import AfterValidator, Field, model_validator
from pydantic.json_schema import SkipJsonSchema
from pydantic_core import PydanticCustomError

from app.api.deps import DbDep, PathsDep
from app.cost.ledger import spent_by_episode
from app.jobs.queue import active_jobs
from app.models.director import EPISODE_ID_PATTERN, Channel, Director, StrictModel
from app.models.episode_summary import EpisodeSummary, current_jobs, summarize
from app.models.project import Project, empty_project
from app.storage.atomic import read_json, write_json_atomic
from app.storage.db import now_iso
from app.storage.paths import StudioPaths

log = logging.getLogger(__name__)
router = APIRouter(tags=["episodes"])

# Где выпуск в пайплайне: те же шесть этапов, что на рельсе. Меняют действия пайплайна
# («Утвердить план» → `generate` …); в M3 стадию ставит только создание выпуска.
EpisodeStage = Literal["idea", "script", "generate", "edit", "export", "publish"]
# Здоровье выпуска на его стадии. Колонку доски из стадии и статуса вычисляет фронт.
EpisodeStatus = Literal["queued", "generating", "warning", "ready", "failed", "published"]
# Откуда выпуск: из бэклога идей, по референсу, с нуля. Факт создания, не меняется.
EpisodeOrigin = Literal["backlog", "reference", "blank"]

DEFAULT_TITLE = "Новый выпуск"
TITLE_MAX = 200
SHORT_TITLE_MAX = 40
_START_STAGE: dict[EpisodeOrigin, EpisodeStage] = {
    "backlog": "idea",
    "reference": "script",
    "blank": "script",
}
# PATCH их не меняет: id и канал — имя каталога, происхождение — факт создания, стадия и
# статус — дело пайплайна.
FROZEN_FIELDS = ("id", "channel", "origin", "stage", "status")
_ORDER = " ORDER BY slot_date IS NULL, slot_date, created_at, rowid"


def _clean_title(value: str | None) -> str:
    """Название после `strip`: непустое, до `TITLE_MAX` знаков; явный null — как пустое."""
    title = (value or "").strip()
    if not title:
        raise PydanticCustomError("title_empty", "Название не может быть пустым — введите текст.")
    if len(title) > TITLE_MAX:
        raise PydanticCustomError(
            "title_too_long", "Название длиннее {max} знаков — сократите его.", {"max": TITLE_MAX}
        )
    return title


def _clean_short_title(value: str | None) -> str | None:
    """Короткое имя для ячейки слота после `strip`; пустое — то же, что null (сброс)."""
    short = (value or "").strip()
    if len(short) > SHORT_TITLE_MAX:
        raise PydanticCustomError(
            "short_title_too_long",
            "Короткое имя длиннее {max} знаков — сократите его.",
            {"max": SHORT_TITLE_MAX},
        )
    return short or None


# Проверка — одной функцией после разбора типа, с русским текстом. Ограничения на ветке
# `str | None` дали бы по ошибке на каждую ветку объединения, в том числе «Input should be None».
Title = Annotated[str, AfterValidator(_clean_title)]
ShortTitle = Annotated[str | None, AfterValidator(_clean_short_title)]


class EpisodeCreate(StrictModel):
    channel: Channel
    # Без id сервер выдаёт следующий номер: `c01`, `o05`.
    id: str | None = Field(default=None, pattern=EPISODE_ID_PATTERN)
    title: Title = DEFAULT_TITLE
    short_title: ShortTitle = None
    origin: EpisodeOrigin = "blank"


class EpisodePatch(StrictModel):
    """Переименование. Поля нет в теле — не меняется; `short_title: null` — сбросить."""

    # Явный null отклоняет `_clean_title`, поэтому в схеме (и в TS) его нет.
    title: Annotated[str | SkipJsonSchema[None], AfterValidator(_clean_title)] = None
    short_title: ShortTitle = None

    @model_validator(mode="before")
    @classmethod
    def _no_frozen_fields(cls, data: Any) -> Any:
        frozen = [key for key in FROZEN_FIELDS if isinstance(data, dict) and key in data]
        if frozen:
            raise PydanticCustomError(
                "frozen_fields",
                "Поля {fields} через PATCH не меняются — уберите их из запроса. Id, канал и "
                "происхождение задаются при создании, стадию и статус меняет пайплайн.",
                {"fields": ", ".join(frozen)},
            )
        return data


class Episode(StrictModel):
    id: str
    channel: Channel
    title: str
    short_title: str | None = None
    origin: EpisodeOrigin
    stage: EpisodeStage
    status: EpisodeStatus
    slot_date: str | None = None
    created_at: str
    updated_at: str


class EpisodeListItem(Episode):
    summary: EpisodeSummary


def find_episode(db: sqlite3.Connection, episode_id: str) -> Episode | None:
    row = db.execute("SELECT * FROM episodes WHERE id = ?", (episode_id,)).fetchone()
    return None if row is None else Episode.model_validate(dict(row))


def require_episode(db: sqlite3.Connection, episode_id: str) -> Episode:
    episode = find_episode(db, episode_id)
    if episode is None:
        raise HTTPException(status_code=404, detail=f"Выпуск «{episode_id}» не найден.")
    return episode


# --- создание ----------------------------------------------------------------------------------


def next_episode_id(db: sqlite3.Connection, paths: StudioPaths, channel: Channel) -> str:
    """`{инициал канала}{NN}`: наибольший номер среди id вида `c\\d+` плюс один. Id выпуска
    глобален, поэтому номер ищется по всей таблице; номер, занятый каталогом без строки в БД
    (след аварии), пропускается."""
    prefix = channel[0]
    numbered = re.compile(rf"{prefix}(\d+)")
    rows = db.execute("SELECT id FROM episodes WHERE id LIKE ?", (f"{prefix}%",)).fetchall()
    matches = [numbered.fullmatch(row["id"]) for row in rows]
    number = max((int(m.group(1)) for m in matches if m), default=0) + 1
    while paths.episode_dir(channel, f"{prefix}{number:02d}").exists():
        number += 1
    return f"{prefix}{number:02d}"


def _require_free(
    db: sqlite3.Connection, paths: StudioPaths, channel: Channel, episode_id: str
) -> None:
    if find_episode(db, episode_id) is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Выпуск «{episode_id}» уже существует. Выберите другой id или не указывайте "
            "его — сервер выдаст следующий номер.",
        )
    episode_dir = paths.episode_dir(channel, episode_id)
    if episode_dir.exists():
        raise HTTPException(
            status_code=409,
            detail=f"Каталог {episode_dir} уже есть на диске. Уберите его или выберите другой id.",
        )


def insert_episode(db: sqlite3.Connection, paths: StudioPaths, body: EpisodeCreate) -> str:
    """Выбор id, дерево выпуска и строка в БД — одна транзакция `BEGIN IMMEDIATE`: второй
    писатель (другое соединение или процесс) ждёт коммита первого и видит занятый номер."""
    db.execute("BEGIN IMMEDIATE")
    try:
        if body.id is None:
            episode_id = next_episode_id(db, paths, body.channel)
        else:
            episode_id = body.id
            _require_free(db, paths, body.channel, episode_id)

        for directory in paths.episode_tree(body.channel, episode_id):
            directory.mkdir(parents=True, exist_ok=True)
        project = empty_project(body.channel, episode_id)
        write_json_atomic(
            paths.project_path(body.channel, episode_id), project.model_dump(mode="json")
        )

        now = now_iso()
        db.execute(
            "INSERT INTO episodes (id, channel, title, short_title, origin, stage,"
            " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                episode_id,
                body.channel,
                body.title,
                body.short_title,
                body.origin,
                _START_STAGE[body.origin],
                now,
                now,
            ),
        )
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return episode_id


# --- сводка ------------------------------------------------------------------------------------


def _load_sources(paths: StudioPaths, episode: Episode) -> tuple[Project | None, Director | None]:
    """project.json и текущая версия плана. Битый или пропавший файл одного выпуска не роняет
    доску: предупреждение в лог, сводка — без него."""
    try:
        project = Project.model_validate(read_json(paths.project_path(episode.channel, episode.id)))
    except (OSError, ValueError) as exc:
        log.warning("episode %s: project.json unreadable: %s", episode.id, exc)
        return None, None
    if project.director_version is None:
        return project, None
    version = int(project.director_version[1:])
    try:
        path = paths.director_version_path(episode.channel, episode.id, version)
        return project, Director.model_validate(read_json(path))
    except (OSError, ValueError) as exc:
        log.warning("episode %s: director %s unreadable: %s", episode.id, version, exc)
        return project, None


def with_summaries(
    db: sqlite3.Connection,
    paths: StudioPaths,
    episodes: list[Episode],
    episode_id: str | None = None,
) -> list[EpisodeListItem]:
    """Журнал и джобы — запросом на весь список (или на один выпуск), файлы — по разу на выпуск."""
    spent = spent_by_episode(db, episode_id)
    jobs = current_jobs(active_jobs(db, episode_id))
    items: list[EpisodeListItem] = []
    for episode in episodes:
        project, director = _load_sources(paths, episode)
        summary = summarize(project, director, spent.get(episode.id, 0), jobs.get(episode.id))
        items.append(EpisodeListItem.model_validate({**episode.model_dump(), "summary": summary}))
    return items


def episode_item(db: sqlite3.Connection, paths: StudioPaths, episode_id: str) -> EpisodeListItem:
    episode = require_episode(db, episode_id)
    return with_summaries(db, paths, [episode], episode.id)[0]


# --- роутер ------------------------------------------------------------------------------------


@router.get("/episodes")
async def list_episodes(
    db: DbDep, paths: PathsDep, channel: Channel | None = None
) -> list[EpisodeListItem]:
    """Без `channel` — оба канала. Порядок: по дате слота, без слота — в конце по созданию."""
    if channel is None:
        rows = db.execute("SELECT * FROM episodes" + _ORDER).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM episodes WHERE channel = ?" + _ORDER, (channel,)
        ).fetchall()
    return with_summaries(db, paths, [Episode.model_validate(dict(row)) for row in rows])


@router.post("/episodes", status_code=201)
async def create_episode(body: EpisodeCreate, paths: PathsDep, db: DbDep) -> EpisodeListItem:
    if db.execute("SELECT 1 FROM channels WHERE id = ?", (body.channel,)).fetchone() is None:
        raise HTTPException(
            status_code=404,
            detail=f"Канал «{body.channel}» не найден. Создайте каналы: python -m app.tools.seed",
        )
    episode_id = insert_episode(db, paths, body)
    return episode_item(db, paths, episode_id)


@router.get("/episodes/{episode_id}")
async def get_episode(episode_id: str, paths: PathsDep, db: DbDep) -> EpisodeListItem:
    return episode_item(db, paths, episode_id)


@router.patch("/episodes/{episode_id}")
async def patch_episode(
    episode_id: str, body: EpisodePatch, paths: PathsDep, db: DbDep
) -> EpisodeListItem:
    episode = require_episode(db, episode_id)
    changes: dict[str, Any] = {field: getattr(body, field) for field in body.model_fields_set}
    changes["updated_at"] = now_iso()
    assignments = ", ".join(f"{column} = ?" for column in changes)
    db.execute(f"UPDATE episodes SET {assignments} WHERE id = ?", (*changes.values(), episode.id))
    db.commit()
    return episode_item(db, paths, episode.id)
