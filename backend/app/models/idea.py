"""Идея канала (устав M4, решение 9): бэклог выпусков. Таблица `ideas`, контракт —
`docs/research.md`.

Идею заводит человек (`manual`, сразу в бэклог) или предлагает чат через мост (`bridge`,
`proposed`). Оценка `score` — мнение чата 0–100, не данные. Тексты ошибок — одна русская фраза на
поле (L-022): проверки — функцией после разбора, а не ограничениями на ветках `X | None`.
"""

from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BeforeValidator, ConfigDict, model_validator
from pydantic.json_schema import SkipJsonSchema
from pydantic_core import PydanticCustomError

from app.models.director import Channel, StrictModel

IdeaSource = Literal["manual", "bridge"]
IdeaStatus = Literal["proposed", "backlog", "used", "dropped"]

TITLE_MAX = 200
# Человеческие названия статусов — в тексты ошибок.
STATUS_TEXT: dict[str, str] = {
    "proposed": "предложена",
    "backlog": "в бэклоге",
    "used": "взята в выпуск",
    "dropped": "отброшена",
}
# Переходы статуса через PATCH; `used` ставит только создание выпуска из идеи.
TRANSITIONS: dict[str, frozenset[str]] = {
    "proposed": frozenset({"backlog", "dropped"}),
    "backlog": frozenset({"dropped"}),
    "dropped": frozenset({"backlog"}),
    "used": frozenset(),
}
# PATCH их не меняет: id и канал — факт создания, источник — откуда пришла идея, выпуск — ставит
# создание выпуска.
FROZEN_FIELDS = ("id", "channel", "source", "episode_id", "created_at", "updated_at")


def _clean_title(value: str | None) -> str:
    title = (value or "").strip()
    if not title:
        raise PydanticCustomError("title_empty", "Название не может быть пустым — введите текст.")
    if len(title) > TITLE_MAX:
        raise PydanticCustomError(
            "title_too_long", "Название длиннее {max} знаков — сократите его.", {"max": TITLE_MAX}
        )
    return title


def _clean_score(value: Any) -> Any:
    """Целое 0–100 или null; дробное с нулевой частью (`85.0`) — целое. Остальное — одна ошибка."""
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100:
        raise PydanticCustomError("score_invalid", "Оценка — целое число от 0 до 100 или null.")
    return value


def _text(value: Any) -> Any:
    """Текстовое поле идеи: строка после `strip`; null — пустая строка."""
    if value is None:
        return ""
    if not isinstance(value, str):
        raise PydanticCustomError("text_invalid", "Ожидалась строка текста.")
    return value.strip()


Title = Annotated[str, AfterValidator(_clean_title)]
Score = Annotated[int | None, BeforeValidator(_clean_score)]
Text = Annotated[str, BeforeValidator(_text)]
Reason = Annotated[str | None, BeforeValidator(lambda v: _text(v) or None)]


class Idea(StrictModel):
    id: str
    channel: Channel
    title: str
    angle: str
    hook_promise: str
    summary: str
    # Мнение чата о потенциале идеи, 0–100; null — оценки нет.
    score: int | None
    score_reason: str | None
    source: IdeaSource
    status: IdeaStatus
    # Выпуск, созданный из идеи (`used`); у остальных — null.
    episode_id: str | None
    created_at: str
    updated_at: str


class IdeaCreate(StrictModel):
    """Идея руками: `source: manual`, сразу в бэклог."""

    channel: Channel
    title: Title
    angle: Text = ""
    hook_promise: Text = ""
    summary: Text = ""
    score: Score = None
    score_reason: Reason = None


class IdeaPatch(StrictModel):
    """Правка идеи. Поля нет в теле — не меняется; `score: null` — сбросить оценку. Статус — по
    `TRANSITIONS`, неверный переход — 409 в API."""

    # Явный null отклоняет `_clean_title`, поэтому в схеме (и в TS) его нет.
    title: Annotated[str | SkipJsonSchema[None], AfterValidator(_clean_title)] = None
    angle: Text = ""
    hook_promise: Text = ""
    summary: Text = ""
    score: Score = None
    score_reason: Reason = None
    status: IdeaStatus | None = None

    @model_validator(mode="before")
    @classmethod
    def _no_frozen_fields(cls, data: Any) -> Any:
        frozen = [key for key in FROZEN_FIELDS if isinstance(data, dict) and key in data]
        if frozen:
            raise PydanticCustomError(
                "frozen_fields",
                "Поля {fields} через PATCH не меняются — уберите их из запроса. Канал и источник"
                " задаются при создании, выпуск — созданием выпуска из идеи.",
                {"fields": ", ".join(frozen)},
            )
        return data


class IdeaProposal(StrictModel):
    """Идея из ответа чата (`{"ideas": [...]}`). Лишние ключи чата не мешают: игнорируются."""

    model_config = ConfigDict(extra="ignore")

    title: Title
    angle: Text
    hook_promise: Text
    summary: Text
    score: Score = None
    score_reason: Reason = None
