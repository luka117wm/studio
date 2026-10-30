"""Выпуски: строка в `episodes` + дерево `data/projects/<channel>/<episode>/` с `project.json`.

Ответы несут сводку для карточки доски (`models/episode_summary.py`): она считается при чтении из
файлов выпуска, журнала расходов и очереди, в БД не хранится. Контракт — `docs/episodes.md`.
"""

import datetime as dt
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
from app.models.idea import STATUS_TEXT, Idea
from app.models.project import EpisodeBrief, Project, empty_project
from app.slots import schedule
from app.storage.atomic import read_json, write_json_atomic
from app.storage.db import now_iso
from app.storage.paths import StudioPaths
from app.tools.seed import SEED_COMMAND

log = logging.getLogger(__name__)
router = APIRouter(tags=["episodes"])

# Где выпуск в пайплайне: те же шесть этапов, что на рельсе. Меняют действия пайплайна: создание,
# импорт плана (`idea` → `script`, M4.2), «Утвердить план» → `generate` (M4.6) и так далее.
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
NEXT_FREE = "next_free"
_MONTHS = (
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
)


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


def _clean_slot(value: str | None) -> str | None:
    """`next_free`, дата `ГГГГ-ММ-ДД` (приводится к ISO) или null — без слота."""
    if value is None or value == NEXT_FREE:
        return value
    try:
        return dt.date.fromisoformat(value).isoformat()
    except ValueError:
        raise PydanticCustomError(
            "slot_invalid",
            "Слот «{value}» не понят: пришлите next_free, дату ГГГГ-ММ-ДД или null.",
            {"value": value},
        ) from None


# Проверка — одной функцией после разбора типа, с русским текстом. Ограничения на ветке
# `str | None` дали бы по ошибке на каждую ветку объединения, в том числе «Input should be None».
Title = Annotated[str, AfterValidator(_clean_title)]
ShortTitle = Annotated[str | None, AfterValidator(_clean_short_title)]
SlotChoice = Annotated[str | None, AfterValidator(_clean_slot)]


class EpisodeCreate(StrictModel):
    channel: Channel
    # Без id сервер выдаёт следующий номер: `c01`, `o05`.
    id: str | None = Field(default=None, pattern=EPISODE_ID_PATTERN)
    title: Title = DEFAULT_TITLE
    short_title: ShortTitle = None
    origin: EpisodeOrigin = "blank"
    # Слот публикации: ближайший свободный после сегодняшнего, конкретная дата или без слота.
    slot: SlotChoice = NEXT_FREE
    # Идея бэклога этого канала (M4.8): заявка и название — из неё, идея — `used`. Только с
    # `origin: backlog`.
    idea_id: str | None = None

    @model_validator(mode="after")
    def _idea_only_from_backlog(self) -> "EpisodeCreate":
        if self.idea_id is not None and self.origin != "backlog":
            raise PydanticCustomError(
                "idea_origin",
                "Выпуск из идеи создаётся с origin «backlog» — поправьте origin или уберите"
                " idea_id.",
            )
        return self


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


def mark_plan_imported(db: sqlite3.Connection, episode_id: str, *, new_version: bool) -> None:
    """Импорт плана (устав M4, решение 7): стадия `idea` → `script`. Новая текущая версия плана
    возвращает в `script` и утверждённый выпуск (`generate`) — утвердить нужно снова; статус
    генерации (`generating`, `ready`, `warning`, M6.3) к сценарию не относится — `queued`. Поздние
    стадии не трогаются: что делать с планом после начала генерации, решит M6.
    """
    stages = ("idea", "generate") if new_version else ("idea",)
    db.execute(
        "UPDATE episodes SET stage = 'script',"
        " status = CASE WHEN stage = 'generate' THEN 'queued' ELSE status END, updated_at = ?"
        f" WHERE id = ? AND stage IN ({', '.join('?' * len(stages))})",
        (now_iso(), episode_id, *stages),
    )
    db.commit()


def mark_plan_approved(db: sqlite3.Connection, episode_id: str) -> None:
    """«Утвердить план» (устав M4, решение 7): стадия → `generate`."""
    db.execute(
        "UPDATE episodes SET stage = 'generate', updated_at = ? WHERE id = ?",
        (now_iso(), episode_id),
    )
    db.commit()


def channel_episodes(db: sqlite3.Connection, channel: str) -> list[Episode]:
    """Выпуски канала по дате слота, без слота — в конце по созданию."""
    rows = db.execute("SELECT * FROM episodes WHERE channel = ?" + _ORDER, (channel,)).fetchall()
    return [Episode.model_validate(dict(row)) for row in rows]


def require_episode(db: sqlite3.Connection, episode_id: str) -> Episode:
    episode = find_episode(db, episode_id)
    if episode is None:
        raise HTTPException(status_code=404, detail=f"Выпуск «{episode_id}» не найден.")
    return episode


# --- слоты -------------------------------------------------------------------------------------


def human_date(day: dt.date) -> str:
    """«23 сентября» — дата в тексте ошибки."""
    return f"{day.day} {_MONTHS[day.month - 1]}"


def load_schedule(paths: StudioPaths) -> tuple[schedule.Schedule, dt.date]:
    """Расписание и «сегодня»; битый `schedule.json` — 500 с тем, что исправить."""
    now = schedule.today()
    try:
        return schedule.load_schedule(paths, now), now
    except schedule.ScheduleError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def require_free_slot(
    db: sqlite3.Connection, sched: schedule.Schedule, day: dt.date, episode_id: str | None
) -> None:
    """Дата — из расписания (иначе 422 с ближайшими слотами) и не занята другим выпуском (409)."""
    if not schedule.is_slot(sched, day):
        nearest = schedule.nearest_slots(sched, day)
        raise HTTPException(
            status_code=422,
            detail={
                "message": f"{human_date(day)} — не день публикации. Ближайшие слоты: "
                + ", ".join(human_date(d) for d in nearest)
                + ".",
                "nearest": [d.isoformat() for d in nearest],
            },
        )
    row = db.execute(
        "SELECT id, title FROM episodes WHERE slot_date = ?", (day.isoformat(),)
    ).fetchone()
    if row is not None and row["id"] != episode_id:
        raise HTTPException(
            status_code=409,
            detail=f"Слот {human_date(day)} занят выпуском «{row['title']}» ({row['id']}); снимите "
            "его со слота или выберите другой.",
        )


def next_free_slot(db: sqlite3.Connection, sched: schedule.Schedule, now: dt.date) -> dt.date:
    """Первый слот строго после сегодняшнего, в котором нет выпуска.

    Сегодняшний не берётся: новый выпуск в нём сразу получил бы риск `failed`. Вручную
    (`PUT …/slot`) его назначить можно.
    """
    tomorrow = now + dt.timedelta(days=1)
    rows = db.execute(
        "SELECT slot_date FROM episodes WHERE slot_date >= ?", (tomorrow.isoformat(),)
    ).fetchall()
    taken = {row["slot_date"] for row in rows}
    day = schedule.slot_on_or_after(sched, tomorrow)
    while day.isoformat() in taken:
        day += dt.timedelta(days=sched.every_days)
    return day


def _choose_slot(db: sqlite3.Connection, paths: StudioPaths, choice: str | None) -> str | None:
    if choice is None:
        return None
    sched, now = load_schedule(paths)
    if choice == NEXT_FREE:
        return next_free_slot(db, sched, now).isoformat()
    require_free_slot(db, sched, dt.date.fromisoformat(choice), None)
    return choice


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


def _idea_for(db: sqlite3.Connection, body: EpisodeCreate) -> Idea | None:
    """Идея для выпуска: есть, этого канала и в бэклоге — иначе 404 / 422 / 409 с текстом."""
    if body.idea_id is None:
        return None
    row = db.execute("SELECT * FROM ideas WHERE id = ?", (body.idea_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Идея «{body.idea_id}» не найдена.")
    idea = Idea.model_validate(dict(row))
    if idea.channel != body.channel:
        raise HTTPException(
            status_code=422,
            detail=f"Идея «{idea.title}» ({idea.id}) — из канала {idea.channel}, а выпуск "
            f"создаётся в {body.channel}. Выберите идею этого канала.",
        )
    if idea.status != "backlog":
        where = f" {idea.episode_id}" if idea.status == "used" and idea.episode_id else ""
        raise HTTPException(
            status_code=409,
            detail=f"Идея «{idea.title}» {STATUS_TEXT[idea.status]}{where} — выпуск создаётся "
            "только из идеи в бэклоге.",
        )
    return idea


def _brief_of(idea: Idea) -> EpisodeBrief:
    """Заявка из идеи (устав M4, решение 5): идея — название, о чём видео — в заметках."""
    return EpisodeBrief(
        idea=idea.title,
        angle=idea.angle,
        hook_promise=idea.hook_promise,
        notes=idea.summary,
        idea_id=idea.id,
    )


def insert_episode(
    db: sqlite3.Connection,
    paths: StudioPaths,
    body: EpisodeCreate,
    brief: EpisodeBrief | None = None,
) -> str:
    """Выбор id и слота, дерево выпуска и строка в БД — одна транзакция `BEGIN IMMEDIATE`:
    второй писатель (другое соединение или процесс) ждёт коммита первого и видит занятые номер
    и слот. Выпуск из идеи: проверка идеи и её `used` — в той же транзакции. `brief` — готовая
    заявка (выпуск по референсу, M4.10); у выпуска из идеи заявку собирает идея."""
    db.execute("BEGIN IMMEDIATE")
    try:
        if body.id is None:
            episode_id = next_episode_id(db, paths, body.channel)
        else:
            episode_id = body.id
            _require_free(db, paths, body.channel, episode_id)
        slot_date = _choose_slot(db, paths, body.slot)
        idea = _idea_for(db, body)
        title = idea.title if idea and "title" not in body.model_fields_set else body.title

        for directory in paths.episode_tree(body.channel, episode_id):
            directory.mkdir(parents=True, exist_ok=True)
        project = empty_project(body.channel, episode_id)
        if idea or brief:
            project = project.model_copy(update={"brief": _brief_of(idea) if idea else brief})
        write_json_atomic(
            paths.project_path(body.channel, episode_id), project.model_dump(mode="json")
        )

        now = now_iso()
        db.execute(
            "INSERT INTO episodes (id, channel, title, short_title, origin, stage, slot_date,"
            " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                episode_id,
                body.channel,
                title,
                body.short_title,
                body.origin,
                _START_STAGE[body.origin],
                slot_date,
                now,
                now,
            ),
        )
        if idea:
            db.execute(
                "UPDATE ideas SET status = 'used', episode_id = ?, updated_at = ? WHERE id = ?",
                (episode_id, now, idea.id),
            )
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return episode_id


# --- сводка ------------------------------------------------------------------------------------


def load_sources(paths: StudioPaths, episode: Episode) -> tuple[Project | None, Director | None]:
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
        project, director = load_sources(paths, episode)
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
    if channel is not None:
        return with_summaries(db, paths, channel_episodes(db, channel))
    rows = db.execute("SELECT * FROM episodes" + _ORDER).fetchall()
    return with_summaries(db, paths, [Episode.model_validate(dict(row)) for row in rows])


@router.post("/episodes", status_code=201)
async def create_episode(body: EpisodeCreate, paths: PathsDep, db: DbDep) -> EpisodeListItem:
    if db.execute("SELECT 1 FROM channels WHERE id = ?", (body.channel,)).fetchone() is None:
        raise HTTPException(
            status_code=404,
            detail=f"Канал «{body.channel}» не найден. Создайте каналы: {SEED_COMMAND}",
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
