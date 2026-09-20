"""Контракт director.json (`studio.director/1`) — режиссёрский план эпизода.

Замысел, не реализация: что сказать, какие кадры, движение, звук, метаданные публикации.
Таймингов нет (они в project.json), канона нет — только ссылки `canon_ref` на конкретные версии.
Полное описание полей — `docs/director_schema.md`; JSON Schema генерируется из этих моделей
(`app.tools.gen_schema`).

Структурные ограничения (типы, литералы, диапазоны, паттерны) — здесь; доменные (уникальность,
ссылки, стоп-лист) — `validators.check_director`, он вызывается из `Director` автоматически.
Точка входа с человеческими сообщениями — `validators.validate_director`.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from app.models.validators import check_director

SCHEMA_VERSION = "studio.director/1"

Channel = Literal["cursus", "otto"]
EpisodeFormat = Literal["every_rank", "host"]
ReferenceMode = Literal["none", "structure_clone", "own_version"]
ShotSize = Literal["establishing", "action", "reaction", "detail"]
MotionType = Literal[
    "push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "static", "drift"
]
Ease = Literal["linear", "in_out_sine", "in_out_cubic", "in_cubic", "out_cubic"]
TransitionType = Literal["cut", "crossfade", "dip"]
FactStatus = Literal["verified", "disputed", "not_found"]

# Идентификаторы, которые становятся именами папок и файлов, и ссылки на версии канона.
EPISODE_ID_PATTERN = r"^[a-z0-9][a-z0-9-]*$"
SHOT_ID_PATTERN = r"^s\d{3,}$"
SECTION_ID_PATTERN = r"^[a-z][a-z0-9_-]*$"
STYLE_REF_PATTERN = r"^style/v\d{3}$"
PERIOD_REF_PATTERN = r"^periods/[a-z0-9-]+/v\d{3}$"
APPEARANCE_REF_PATTERN = r"^characters/[a-z0-9-]+/v\d{3}#[a-z0-9-]+$"


class StrictModel(BaseModel):
    """Лишние поля запрещены: контракт — ровно скелет из CLAUDE.md."""

    model_config = ConfigDict(extra="forbid")


class Meta(StrictModel):
    channel: Channel
    episode_id: str = Field(pattern=EPISODE_ID_PATTERN)
    working_title: str
    format: EpisodeFormat
    language: str = "en"
    target_minutes: int = Field(ge=1, le=40)
    part: int = Field(default=1, ge=1)
    parts_total: int = Field(default=1, ge=1)


class Source(StrictModel):
    title: str
    url: str


class Brief(StrictModel):
    idea: str
    angle: str
    hook_promise: str
    reference_mode: ReferenceMode = "none"
    sources: list[Source] = []


class CanonRef(StrictModel):
    """Ссылки на версии канона; ключи `periods` и `appearances` — то, на что ссылаются кадры.

    Формат значений (`periods/<id>/vNNN`, `characters/<id>/vNNN#<облик>`) проверяет
    `check_director`.
    """

    style: str = Field(pattern=STYLE_REF_PATTERN)
    periods: dict[str, str] = Field(default_factory=dict)
    appearances: dict[str, str] = Field(default_factory=dict)


class VoiceCfg(StrictModel):
    provider: str
    voice_id: str
    model: str
    pace_wpm: int = Field(ge=100, le=200)


class Section(StrictModel):
    id: str = Field(pattern=SECTION_ID_PATTERN)
    title: str
    chapter: bool = True
    vo_direction: str | None = None


class ImageSpec(StrictModel):
    prompt: str
    period: str
    appearances: list[str] = []
    shot_size: ShotSize


class Motion(StrictModel):
    type: MotionType
    strength: float = Field(ge=0.0, le=0.25)
    ease: Ease


class Transition(StrictModel):
    type: TransitionType = "cut"
    duration: float = Field(default=0.0, ge=0.0, le=1.5)


class AnimateSpec(StrictModel):
    recommended: bool = False
    reason: str | None = None
    prompt: str | None = None
    seconds: int = Field(default=4, ge=2, le=10)


class SfxSpec(StrictModel):
    prompt: str
    offset: float = Field(default=0.0, ge=0.0)
    duration: float = Field(gt=0.0)
    gain_db: float = Field(ge=-40.0, le=0.0)


class Shot(StrictModel):
    id: str = Field(pattern=SHOT_ID_PATTERN)
    section: str
    vo: str
    image: ImageSpec
    motion: Motion
    transition_in: Transition = Transition()
    animate: AnimateSpec = AnimateSpec()
    sfx: list[SfxSpec] = []
    # Зарезервировано: в схеме 1 форма оверлея не определена, допустим только null.
    overlay: None = None


class MusicCue(StrictModel):
    section: str
    mood: str
    gain_db: float = Field(ge=-40.0, le=0.0)


class ThumbnailConcept(StrictModel):
    prompt: str
    text: str


class Thumbnail(StrictModel):
    concepts: list[ThumbnailConcept]


class PublishMeta(StrictModel):
    titles: list[str]
    description: str
    tags: list[str]
    category_id: str
    synthetic_media: bool
    made_for_kids: bool


class Fact(StrictModel):
    claim: str
    status: FactStatus
    source_url: str | None = None


class Director(StrictModel):
    """Корень плана. В частях 2…N (`meta.part > 1`) `canon_ref` и `voice` берутся из части 1."""

    model_config = ConfigDict(extra="forbid", validate_by_name=True, validate_by_alias=True)

    # `schema` конфликтует с BaseModel.schema(), поэтому в Python поле называется schema_version.
    schema_version: Literal["studio.director/1"] = Field(alias="schema")
    meta: Meta
    brief: Brief
    canon_ref: CanonRef | None = None
    voice: VoiceCfg | None = None
    sections: list[Section]
    shots: list[Shot]
    music: list[MusicCue] = []
    thumbnail: Thumbnail
    publish: PublishMeta
    facts: list[Fact] = []

    @model_validator(mode="after")
    def _domain_checks(self) -> "Director":
        messages = check_director(self)
        if messages:
            raise PydanticCustomError(
                "director_domain", "\n".join(messages), {"messages": messages}
            )
        return self
