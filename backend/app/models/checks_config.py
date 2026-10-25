"""Настройки проверок консистентности готовых кадров (`config/checks.yaml`, M6.5): веса проверки
лица — откуда, хэш, лицензия; порог сходства, размер лица. Ошибка файла — `ConfigError`: бэкенд
не стартует. Контракт — `docs/generation.md`, «Проверка лица».
"""

from pathlib import Path

import yaml
from pydantic import Field, ValidationError

from app.models.director import StrictModel
from app.providers.base import ConfigError

SHA256_HEX = r"^[0-9a-f]{64}$"


class WeightFile(StrictModel):
    """Файл весов в `data/models/`: имя, sha256 содержимого, лицензия и откуда качать — зеркала
    по порядку. В git веса не кладутся, их скачивает `app.tools.fetch_models`."""

    file: str = Field(pattern=r"^[A-Za-z0-9._-]+\.onnx$")
    sha256: str = Field(pattern=SHA256_HEX)
    license: str = Field(min_length=1)
    source: str = Field(min_length=1)
    urls: list[str] = Field(min_length=1)


class FaceModels(StrictModel):
    detector: WeightFile  # YuNet — `cv2.FaceDetectorYN`
    recognizer: WeightFile  # SFace — `cv2.FaceRecognizerSF`


class FaceCheckConfig(StrictModel):
    models: FaceModels
    # Косинусное сходство с фасом облика ниже порога — `low` (пометка, не блокировка).
    threshold: float = Field(ge=-1.0, le=1.0)
    # Уверенность детектора: ниже — не лицо.
    detect_score: float = Field(gt=0.0, lt=1.0)
    # Большая сторона картинки при детекции: больше — уменьшается (быстрее, лица крупнее порога).
    detect_max_side: int = Field(ge=320)
    # Лицо меньше этого по меньшей стороне рамки (на уменьшенной картинке) — не проверяется.
    min_face_px: int = Field(ge=16)


class ChecksConfig(StrictModel):
    face: FaceCheckConfig


def load_checks_config(path: Path) -> ChecksConfig:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ConfigError(f"Не прочитать настройки проверок {path}: {exc}") from exc
    try:
        return ChecksConfig.model_validate(raw)
    except ValidationError as exc:
        raise ConfigError(
            f"{path}: настройки проверок некорректны: {exc.errors(include_url=False)}"
        ) from exc
