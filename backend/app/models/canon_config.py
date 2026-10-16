"""Настройки канона (`config/canon.yaml`, M5.4): ракурсы листа опорных портретов и шаблоны
опорных кадров стиля. Ошибка файла — `ConfigError`: бэкенд не стартует.

Набор ракурсов фиксирован (устав M5, решение 5): правила устаревания листа называют ракурсы по
id, поэтому конфиг может менять подписи и строки кадрирования, но не состав.
"""

from pathlib import Path
from typing import Literal

import yaml
from pydantic import Field, ValidationError, field_validator

from app.models.director import StrictModel
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


class CanonConfig(StrictModel):
    anchors: AnchorsConfig
    style_frames: StyleFramesConfig


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
