"""Атомарная запись: temp-файл в той же папке → fsync → rename (L-003).

Файл на диске в любой момент — либо старая, либо новая версия, никогда обрезок. Ни одного
`open(path, "w")` для файлов состояния и медиа за пределами этого модуля.
"""

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def write_json_atomic(path: Path, data: Any) -> None:
    """Пишет `data` (уже сериализуемые данные, без pydantic-моделей) в `path` атомарно."""
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    _write_atomic(path, text.encode("utf-8"))


def write_bytes_atomic(path: Path, data: bytes) -> None:
    """Результат провайдера (картинка, аудио, видео) — в `media/` атомарно."""
    _write_atomic(path, data)


def write_json_new(path: Path, data: Any) -> None:
    """Как `write_json_atomic`, но только новым файлом: если `path` уже есть — FileExistsError,
    файл не тронут. Для неизменяемых версий (канон): temp → fsync → link → unlink temp.
    `os.replace` здесь не годится — он заменяет существующий файл молча."""
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    tmp = _write_temp(path, text.encode("utf-8"))
    try:
        os.link(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
    _fsync_dir(path.parent)


def _write_atomic(path: Path, data: bytes) -> None:
    tmp = _write_temp(path, data)
    try:
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    _fsync_dir(path.parent)


def _write_temp(path: Path, data: bytes) -> Path:
    """Temp-файл рядом с `path` (та же ФС — rename и link атомарны), данные уже на диске."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return tmp


def read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def _fsync_dir(directory: Path) -> None:
    """Rename становится долговечным только после fsync каталога (POSIX)."""
    fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
