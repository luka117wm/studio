"""Импорт версии плана: части → цельный план → неизменяемый файл → мёрдж в project.json по shot.id.

Чистые функции без диска и HTTP — `merge.py` (сборка, хэш, diff, мёрдж), `stale.py` (что делает
кадр `stale`) и `effective.py` (ручные правки и действующий план). Файлы, коды ответов и временная
область частей — `api/director.py`.
"""

from app.pipeline.director_import.effective import (
    EffectivePlan,
    PlanShot,
    apply_override,
    edit_stale,
    effective_plan,
    prune_override,
)
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
    "EffectivePlan",
    "FieldChange",
    "ImportResult",
    "PartsError",
    "PlanShot",
    "ShotChange",
    "apply_override",
    "assemble_parts",
    "canonical_hash",
    "diff_canon",
    "diff_shots",
    "edit_stale",
    "effective_plan",
    "merge_into_project",
    "prune_override",
]
