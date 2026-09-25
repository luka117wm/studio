"""Импорт версии плана: части → цельный план → неизменяемый файл → мёрдж в project.json по shot.id.

Чистые функции без диска и HTTP — `merge.py` (сборка, хэш, diff, мёрдж) и `stale.py` (что делает
кадр `stale`). Файлы, коды ответов и временная область частей — `api/director.py`.
"""

from app.pipeline.director_import.merge import (
    ImportResult,
    PartsError,
    ShotChange,
    assemble_parts,
    canonical_hash,
    diff_canon,
    diff_shots,
    merge_into_project,
)
from app.pipeline.director_import.stale import CanonChanges, FieldChange

__all__ = [
    "CanonChanges",
    "FieldChange",
    "ImportResult",
    "PartsError",
    "ShotChange",
    "assemble_parts",
    "canonical_hash",
    "diff_canon",
    "diff_shots",
    "merge_into_project",
]
