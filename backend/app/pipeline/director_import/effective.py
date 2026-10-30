"""Ручные правки кадра и действующий план: версия плана с наложенными `user_override`.

Только чистые функции, без диска и HTTP: PATCH правок — `api/projects.py`, ответ
`GET /api/projects/{id}/plan` — `api/plan.py`. Правка накладывается на кадр тем же правилом, что и
PATCH (`merge_patch`): словари сливаются, остальное заменяется. Версии плана не меняются — правки
живут в project.json, новая версия их не затирает (M2.4).
"""

from collections.abc import Mapping
from typing import Any, get_args

from app.models.director import Director, Fact, Meta, Section, Shot, StrictModel
from app.models.project import (
    OverrideField,
    Project,
    ShotOverride,
    ShotState,
    ShotStatus,
    VersionSource,
    merge_patch,
)
from app.pipeline.director_import.merge import diff_shots
from app.pipeline.director_import.stale import STALE_FIELDS

OVERRIDE_FIELDS: tuple[OverrideField, ...] = get_args(OverrideField)

# Правка поля, от которого зависит картинка, делает нарисованный кадр `stale`. Из `STALE_FIELDS`
# правке открыты только эти два — эпоху и облики меняет новая версия плана.
MANUAL_STALE_REASONS: dict[str, str] = {
    "image.prompt": "Промпт изменён вручную",
    "image.shot_size": "Крупность изменена вручную",
}


class PlanShot(Shot):
    """Кадр действующего плана: поля версии с наложенной правкой и состояние из project.json."""

    status: ShotStatus
    stale_reasons: list[str]
    duration_locked: bool
    prompt_locked: bool
    # Какие поля поправлены вручную — в порядке `OverrideField`.
    overridden: list[OverrideField]


class EffectivePlan(StrictModel):
    """Действующий план для экрана 3: текущая версия плюс ручные правки.

    `shots` — кадры версии по таймлайну, затем убранные (`status: removed`) с содержимым из
    последней версии, где они были (принцип 8).
    """

    version: str
    source: VersionSource
    # Утверждённая версия (M4.6); null — план не утверждали. Не равна `version` — утверждена
    # старая версия, план нужно утвердить снова.
    approved_version: str | None = None
    meta: Meta
    sections: list[Section]
    shots: list[PlanShot]
    facts: list[Fact]


def prune_override(value: Mapping[str, Any]) -> dict[str, Any] | None:
    """Правка после мёрджа PATCH без сброшенных полей: `null` и пустые объекты убираются, пустая
    правка — `None`. Списки (`sfx`) остаются как есть: пустой список — тоже правка."""
    pruned: dict[str, Any] = {}
    for key, item in value.items():
        if isinstance(item, Mapping):
            nested = prune_override(item)
            if nested is not None:
                pruned[key] = nested
        elif item is not None:
            pruned[key] = item
    return pruned or None


def override_data(override: ShotOverride | None) -> dict[str, Any]:
    """Правка как JSON без пустых полей; нет правки — пустой словарь."""
    return override.model_dump(mode="json", exclude_none=True) if override else {}


def apply_override(shot: Shot, override: ShotOverride | None) -> Shot:
    """Кадр плана с наложенной правкой. Ошибка диапазона или типа — `ValidationError` модели
    `Shot`, те же проверки, что у кадра плана."""
    data = override_data(override)
    if not data:
        return shot
    return Shot.model_validate(merge_patch(shot.model_dump(mode="json"), data))


def overridden_fields(override: ShotOverride | None) -> list[OverrideField]:
    data = override_data(override)
    fields: list[OverrideField] = []
    for name in OVERRIDE_FIELDS:
        node: Any = data
        for part in name.split("."):
            node = node.get(part) if isinstance(node, dict) else None
        if node is not None:
            fields.append(name)
    return fields


def edit_stale(state: ShotState, before: Shot, after: Shot) -> ShotState:
    """Правка поменяла поле, от которого зависит уже нарисованная картинка, — кадр `stale`.

    `before` и `after` — действующий кадр до и после правки. Картинка есть у кадра с выбранной
    версией (`has_image`, M6.1); у остальных рисовать ещё нечего, и правка войдёт в генерацию.
    """
    if not state.has_image:
        return state
    reasons = [
        MANUAL_STALE_REASONS[change.field]
        for change in diff_shots(before, after)
        if change.field in STALE_FIELDS and change.field in MANUAL_STALE_REASONS
    ]
    new = [r for r in reasons if r not in state.stale_reasons]
    if not new:
        return state
    return state.model_copy(
        update={"status": "stale", "stale_reasons": [*state.stale_reasons, *new]}
    )


def image_edits(before: Shot, after: Shot) -> bool:
    """Правка поменяла поле, из которого собирается запрос картинки (промпт, крупность): заказы
    кадра в очереди рисовали бы прежний запрос (M6.11)."""
    return any(change.field in MANUAL_STALE_REASONS for change in diff_shots(before, after))


def effective_plan(
    director: Director,
    project: Project,
    removed_shots: Mapping[str, Shot] | None = None,
) -> EffectivePlan:
    """Текущая версия плана (`director`) с правками из project.json. Аргументы не меняются.

    `removed_shots` — содержимое убранных кадров из прошлых версий (их собирает API); убранный
    кадр без содержимого в ответ не попадает.
    """
    version = project.director_version
    if version is None:
        raise ValueError("project has no director_version — nothing to overlay")
    info = project.director_versions[version]

    shots: list[PlanShot] = []
    in_plan = {s.id for s in director.shots}
    for shot in director.shots:
        shots.append(_plan_shot(shot, project.shots.get(shot.id, ShotState())))
    removed_shots = removed_shots or {}
    for shot_id in sorted(project.shots):
        state = project.shots[shot_id]
        if shot_id in in_plan or state.status != "removed" or shot_id not in removed_shots:
            continue
        shots.append(_plan_shot(removed_shots[shot_id], state))

    return EffectivePlan(
        version=version,
        source=info.source,
        approved_version=project.approved_version,
        meta=director.meta,
        sections=director.sections,
        shots=shots,
        facts=director.facts,
    )


def _plan_shot(shot: Shot, state: ShotState) -> PlanShot:
    effective = apply_override(shot, state.user_override)
    return PlanShot.model_validate(
        {
            **effective.model_dump(),
            "status": state.status,
            "stale_reasons": list(state.stale_reasons),
            "duration_locked": state.duration_locked,
            "prompt_locked": state.prompt_locked,
            "overridden": overridden_fields(state.user_override),
        }
    )
