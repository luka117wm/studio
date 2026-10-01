"""Пресеты формата выпуска — `config/formats.yaml` (решение 5 устава M3).

Объёмы выпуска по формату канала: минуты, разделы, кадры, темп речи, подпись для диалога. Цен
здесь нет — их даёт `config/pricing.yaml` через gateway. Проверяется при старте, как
`providers.yaml`: ошибка — `ConfigError`, бэкенд не стартует.
"""

from pathlib import Path
from typing import get_args

import yaml
from pydantic import Field, ValidationError, model_validator

from app.models.director import EpisodeFormat, StrictModel
from app.providers.base import ConfigError

# Предел `meta.target_minutes` плана (`models/director.py`).
_MAX_MINUTES = 40


class FormatMinutes(StrictModel):
    min: int = Field(ge=1, le=_MAX_MINUTES)
    target: int = Field(ge=1, le=_MAX_MINUTES)
    max: int = Field(ge=1, le=_MAX_MINUTES)

    @model_validator(mode="after")
    def _ordered(self) -> "FormatMinutes":
        if not self.min <= self.target <= self.max:
            raise ValueError(
                f"нужно min ≤ target ≤ max, а сейчас {self.min} / {self.target} / {self.max}"
            )
        return self


class FormatPreset(StrictModel):
    # Подпись и пояснение в диалоге «Новый выпуск»; числа и цену к ним добавляет фронт.
    label: str = Field(min_length=1)
    hint: str = Field(min_length=1)
    minutes: FormatMinutes
    sections: int = Field(ge=1)
    shots: int = Field(ge=1)
    words_per_minute: int = Field(ge=1)


class EstimateVolumes(StrictModel):
    """Объём запросов сметы выпуска на слово VO и на сценарий."""

    voice_chars_per_word: float = Field(gt=0)
    script_input_tokens: int = Field(gt=0)
    script_output_tokens_per_word: float = Field(gt=0)


class FormatsConfig(StrictModel):
    formats: dict[EpisodeFormat, FormatPreset]
    estimate: EstimateVolumes

    @model_validator(mode="after")
    def _every_format(self) -> "FormatsConfig":
        missing = [name for name in get_args(EpisodeFormat) if name not in self.formats]
        if missing:
            raise ValueError(f"нет пресета для формата: {', '.join(missing)}")
        return self


def load_formats(path: Path) -> FormatsConfig:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ConfigError(f"Не прочитать пресеты формата {path}: {exc}") from exc
    try:
        return FormatsConfig.model_validate(raw)
    except ValidationError as exc:
        raise ConfigError(
            f"{path}: пресеты формата некорректны: {exc.errors(include_url=False)}"
        ) from exc
