"""Референс (устав M4, решение 10): ролик, чью структуру разбирает чат через мост.

Таблица `reference_videos` хранит исходные субтитры и разбор чата; реплики (`Cue`) и метрики
считает код при чтении. Текст субтитров в промпт плана не попадает никогда (принцип 11): туда идёт
только структура — сегменты, длительности, темп, приёмы. Контракт — `docs/research.md`, «Референс».
"""

import re
from pathlib import Path
from typing import Annotated, Any, Literal

import yaml
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, ValidationError
from pydantic_core import PydanticCustomError

from app.models.director import Channel, StrictModel
from app.providers.base import ConfigError

ReferenceMode = Literal["structure_clone", "own_version"]
SegmentKind = Literal["hook", "promise", "rank", "retention", "finale", "other"]
SEGMENT_KINDS: tuple[str, ...] = ("hook", "promise", "rank", "retention", "finale", "other")

_CLOCK = re.compile(r"^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$")


def parse_clock(value: Any) -> Any:
    """Время сегмента: секунды числом или строкой `ss`, `mm:ss`, `h:mm:ss` → секунды."""
    if isinstance(value, bool):
        raise PydanticCustomError("start_invalid", "Начало — секунды или mm:ss.")
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        try:
            return float(text)
        except ValueError:
            pass
        match = _CLOCK.fullmatch(text)
        if match:
            hours, minutes, seconds = match.groups()
            return int(hours or 0) * 3600 + int(minutes) * 60 + float(seconds)
    raise PydanticCustomError("start_invalid", "Начало — секунды или mm:ss.")


Seconds = Annotated[float, BeforeValidator(parse_clock), Field(ge=0)]


class Cue(StrictModel):
    """Реплика субтитров: начало и конец в секундах, текст без тегов."""

    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str


class AnalysisSegment(StrictModel):
    """Сегмент разбора: вид, подпись своими словами, начало, сколько фактов."""

    model_config = ConfigDict(extra="ignore")

    kind: SegmentKind
    label: str = Field(min_length=1)
    start: Seconds
    facts: int = Field(default=0, ge=0)


class Technique(StrictModel):
    """Приём подачи своими словами и сколько раз он встречается."""

    model_config = ConfigDict(extra="ignore")

    text: str = Field(min_length=1)
    count: int = Field(ge=1)


class ReferenceAnalysis(StrictModel):
    """Разбор референса чатом (ответ на промпт `reference`). Лишние ключи чата игнорируются."""

    model_config = ConfigDict(extra="ignore")

    title: str = ""
    author: str = ""
    # Тема своими словами, одной строкой: идея выпуска «Своя версия этой темы».
    topic: str = Field(min_length=1)
    segments: list[AnalysisSegment]
    techniques: list[Technique] = []


class SegmentMetrics(BaseModel):
    index: int  # номер сегмента с 1
    kind: SegmentKind
    label: str
    start_s: float
    duration_s: float
    words: int
    pace_wpm: float  # слова реплик сегмента в минуту
    facts: int
    facts_per_min: float


class ReferenceMetrics(BaseModel):
    """Метрики референса — считает код по репликам и разбору; средней длины кадра нет (нужно
    видео)."""

    duration_s: float
    words: int
    pace_wpm: float  # слова всех реплик в минуту
    norm_wpm: int  # темп пресета нашего канала (`config/formats.yaml`)
    pace_delta: float  # (темп − норма) / норма: +0.12 — быстрее нормы на 12 %
    facts_total: int
    facts_per_min: float
    # Конец последнего сегмента, где плотность фактов не ниже 70 % средней; null — фактов нет.
    holds_until_s: float | None
    retention_hooks_s: list[float]  # начала сегментов `retention`
    segments_total: int
    ranks_total: int
    segments: list[SegmentMetrics]


class ReferenceVideo(BaseModel):
    """Референс в ответах API: разбор и метрики — когда разобран."""

    id: str
    channel: Channel
    url: str
    title: str
    author: str
    duration_s: float
    cues: int  # сколько реплик в субтитрах
    subtitles: str
    analysis: ReferenceAnalysis | None
    metrics: ReferenceMetrics | None
    created_at: str
    analyzed_at: str | None


class Similarity(BaseModel):
    """Сходство VO плана с текстом референса (принцип 11): доля n-грамм плана, найденных в
    субтитрах."""

    ratio: float
    threshold: float
    ngram: int
    ok: bool  # доля не выше порога
    matched: int  # совпавших n-грамм плана
    total: int  # всего n-грамм плана
    phrases: list[str]  # до пяти самых длинных совпавших фраз


class SimilarityReport(BaseModel):
    """`GET /api/projects/{id}/similarity`: сходство или почему его нет (нет плана, выпуск не по
    референсу)."""

    similarity: Similarity | None
    reason: str | None


class ReferenceConfig(StrictModel):
    """`config/reference.yaml`: длина n-граммы и порог сходства."""

    ngram: int = Field(ge=2, le=12)
    max_similarity: float = Field(gt=0, lt=1)


def load_reference_config(path: Path) -> ReferenceConfig:
    """Ошибка файла — `ConfigError`: бэкенд не стартует (как пресеты формата)."""
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ConfigError(f"Не прочитать настройки референса {path}: {exc}") from exc
    try:
        return ReferenceConfig.model_validate(raw)
    except ValidationError as exc:
        raise ConfigError(
            f"{path}: настройки референса некорректны: {exc.errors(include_url=False)}"
        ) from exc
