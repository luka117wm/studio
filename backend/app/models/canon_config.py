"""Настройки канона (`config/canon.yaml`): ракурсы листа опорных портретов и шаблоны опорных
кадров стиля (M5.4), по крупности кадра — строка промпта, ракурсы и кадры стиля в референсы (M5.5).
Ошибка файла — `ConfigError`: бэкенд не стартует.

Набор ракурсов фиксирован (устав M5, решение 5): правила устаревания листа называют ракурсы по
id, поэтому конфиг может менять подписи и строки кадрирования, но не состав.
"""

from pathlib import Path
from typing import Literal, get_args

import yaml
from pydantic import Field, ValidationError, field_validator, model_validator

from app.models.director import ShotSize, StrictModel
from app.providers.base import AspectRatio, ConfigError

AngleId = Literal["front", "three_quarter", "profile", "full_body", "in_action", "detail"]
ANGLES: tuple[AngleId, ...] = (
    "front",
    "three_quarter",
    "profile",
    "full_body",
    "in_action",
    "detail",
)
FRONT: AngleId = "front"
# Ракурсы, где видны одежда и предметы: их устаревает смена одежды, предметов и износа.
BODY_ANGLES: frozenset[AngleId] = frozenset({"full_body", "in_action", "detail"})


class AngleConfig(StrictModel):
    id: AngleId
    label: str = Field(min_length=1)  # подпись на экране, по-русски
    hint: str = ""  # подсказка на экране (артборд 12)
    prompt: str = Field(min_length=1)  # строка кадрирования, по-английски
    aspect_ratio: AspectRatio


class AnchorsConfig(StrictModel):
    candidates: int = Field(ge=1, le=4)
    angles: list[AngleConfig]

    @field_validator("angles")
    @classmethod
    def _all_angles_once(cls, value: list[AngleConfig]) -> list[AngleConfig]:
        if tuple(angle.id for angle in value) != ANGLES:
            raise ValueError(f"angles must be exactly {', '.join(ANGLES)} in this order")
        return value

    def angle(self, angle_id: str) -> AngleConfig | None:
        return next((a for a in self.angles if a.id == angle_id), None)


class StyleFrameConfig(StrictModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(min_length=1)
    prompt: str = Field(min_length=1)


class StyleFramesConfig(StrictModel):
    aspect_ratio: AspectRatio
    frames: list[StyleFrameConfig] = Field(min_length=1)

    @field_validator("frames")
    @classmethod
    def _unique(cls, value: list[StyleFrameConfig]) -> list[StyleFrameConfig]:
        ids = [frame.id for frame in value]
        if len(set(ids)) != len(ids):
            raise ValueError("style frame ids must be unique")
        return value


# Кадров стиля в референсах кадра — не больше двух (устав M5, решение 7).
SHOT_STYLE_FRAMES_MAX = 2


class ShotSizeConfig(StrictModel):
    """Крупность кадра: строка промпта и что из канона идёт в референсы."""

    prompt: str = Field(min_length=1)  # по-английски, секция `Shot size` промпта кадра
    angles: list[AngleId] = Field(min_length=1)  # первым — фас: он не уходит при лимите
    style_frames: list[str] = Field(default_factory=list, max_length=SHOT_STYLE_FRAMES_MAX)

    @field_validator("angles")
    @classmethod
    def _front_first(cls, value: list[AngleId]) -> list[AngleId]:
        if value[0] != FRONT or len(set(value)) != len(value):
            raise ValueError("angles must start with front and have no repeats")
        return value


class ShotsConfig(StrictModel):
    aspect_ratio: AspectRatio
    sizes: dict[ShotSize, ShotSizeConfig]


class CanonConfig(StrictModel):
    anchors: AnchorsConfig
    style_frames: StyleFramesConfig
    shots: ShotsConfig

    @model_validator(mode="after")
    def _shots_refer_to_known_things(self) -> "CanonConfig":
        missing = set(get_args(ShotSize)) - self.shots.sizes.keys()
        if missing:
            raise ValueError(f"shots.sizes must cover every shot size, missing: {sorted(missing)}")
        frames = {frame.id for frame in self.style_frames.frames}
        for size, entry in self.shots.sizes.items():
            unknown = [f for f in entry.style_frames if f not in frames]
            if unknown:
                raise ValueError(f"shots.sizes.{size}: unknown style frames {unknown}")
        return self


def load_canon_config(path: Path) -> CanonConfig:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ConfigError(f"Не прочитать настройки канона {path}: {exc}") from exc
    try:
        return CanonConfig.model_validate(raw)
    except ValidationError as exc:
        raise ConfigError(
            f"{path}: настройки канона некорректны: {exc.errors(include_url=False)}"
        ) from exc
