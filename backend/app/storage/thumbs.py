"""Миниатюры webp 160/320 (принцип 12): сетки экрана не грузят полноразмерные картинки.

Миниатюра делается при первом запросе и лежит в `thumbs/` рядом с набором: `<id>-<w>.webp`.
Содержимое по id не меняется (в id кандидата — хэш входов вызова), поэтому готовый файл
отдаётся как есть. Запись атомарна (L-003): параллельные запросы одной миниатюры в худшем
случае посчитают её дважды, обрезка на диске не останется.
"""

from pathlib import Path
from typing import Literal

import cv2
import numpy as np

from app.storage.atomic import write_bytes_atomic

ThumbWidth = Literal[160, 320]
WEBP_QUALITY = 80


class ThumbError(Exception):
    """Исходник не читается как картинка."""


def thumb_path(folder: Path, name: str, width: ThumbWidth) -> Path:
    return folder / f"{name}-{width}.webp"


def ensure_thumb(source: Path, target: Path, width: ThumbWidth) -> Path:
    """Миниатюра `source` шириной `width` в `target`; уже есть — не пересчитывается. Узкая
    картинка не растягивается. Цвет — как у исходника (sRGB, принцип 4)."""
    if target.is_file():
        return target
    image = cv2.imdecode(np.fromfile(source, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ThumbError(source.name)
    height, current = image.shape[:2]
    if current > width:
        size = (width, max(1, round(height * width / current)))
        image = cv2.resize(image, size, interpolation=cv2.INTER_AREA)
    ok, encoded = cv2.imencode(".webp", image, [cv2.IMWRITE_WEBP_QUALITY, WEBP_QUALITY])
    if not ok:
        raise ThumbError(source.name)
    write_bytes_atomic(target, encoded.tobytes())
    return target
