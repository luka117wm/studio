"""Сборка частей плана, хэш версии, diff кадров и мёрдж в project.json по `shot.id`.

Только чистые функции: диск, коды ответов и временная область частей — `api/director.py`.
Мёрдж меняет в `ShotState` лишь `status` и `stale_reasons`; `*_locked` и `user_override`
не трогаются, ассеты и тайминги — тоже (принципы 1, 8).
"""

import hashlib
import json
from typing import Any, Literal

from app.models.director import CanonRef, Director, Shot, StrictModel
from app.models.project import DirectorVersionInfo, Project, ShotState
from app.models.validators import validate_director
from app.pipeline.director_import.stale import (
    CanonChanges,
    FieldChange,
    canon_reasons,
    decide,
    describe_animate,
    describe_motion,
    describe_transition,
    list_change,
    text_change,
    value_change,
)

ChangeKind = Literal["added", "changed", "removed"]


class PartsError(ValueError):
    """Части нельзя собрать в один план: `errors` — по строке на проблему."""

    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("\n".join(errors))


class ShotChange(StrictModel):
    """Строка таблицы расхождений (ConflictBar, экран 10)."""

    shot_id: str
    section: str | None
    kind: ChangeKind
    # Все изменения кадра одной строкой; у `stale` кадра причины ещё и в `ShotState.stale_reasons`.
    change: str
    fields: list[str] = []
    stale: bool = False
    # Когда нарисована текущая картинка и цена перерисовки — появятся с модулями картинок и цен.
    drawn_at: str | None = None
    price: int | None = None


class ImportResult(StrictModel):
    version: str
    # Новый файл `director/vNNN.json` записан; `false` — план уже был импортирован (тот же хэш).
    created: bool
    added: int
    changed: int
    removed: int
    changes: list[ShotChange]


# --- версия --------------------------------------------------------------------------------------


def canonical_hash(director: Director) -> str:
    """sha256 канонического JSON: порядок ключей и пробелы не влияют, тот же план — тот же хэш."""
    payload = json.dumps(
        director_to_json(director), sort_keys=True, ensure_ascii=False, separators=(",", ":")
    )
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def director_to_json(director: Director) -> dict[str, Any]:
    """Сериализуемый вид плана с ключом `schema` — то, что лежит в `director/vNNN.json`."""
    return director.model_dump(mode="json", by_alias=True)


# --- части ---------------------------------------------------------------------------------------


def assemble_parts(parts: list[Director]) -> Director:
    """Части 1…N → один план: шапка из части 1, кадры/музыка/факты — конкатенация по порядку.

    `sections` дедуплицируются по `id` (часть 1 обычно несёт весь план разделов, части 2…N —
    свои); один `id` с разным содержимым — ошибка. Собранный план проходит `validate_director`
    целиком: тут проверяются ссылки на канон для частей, пришедших без `canon_ref`.
    """
    if not parts:
        raise PartsError(["части: пусто, ожидалось хотя бы часть 1"])
    ordered = sorted(parts, key=lambda d: d.meta.part)
    first = ordered[0]
    total = first.meta.parts_total
    errors: list[str] = []

    if [d.meta.part for d in ordered] != list(range(1, total + 1)):
        received = sorted({d.meta.part for d in ordered})
        missing = [n for n in range(1, total + 1) if n not in received]
        errors.append(
            f"части: получены {received}, ожидалось 1…{total}"
            + (f", не хватает {missing}" if missing else "")
        )
    for d in ordered[1:]:
        if d.meta.parts_total != total:
            errors.append(
                f"часть {d.meta.part}: parts_total = {d.meta.parts_total}, "
                f"ожидалось {total} как в части 1"
            )
        if d.meta.episode_id != first.meta.episode_id:
            errors.append(
                f"часть {d.meta.part}: episode_id «{d.meta.episode_id}», "
                f"ожидалось «{first.meta.episode_id}» как в части 1"
            )
    if errors:
        raise PartsError(errors)

    data = director_to_json(first)
    data["meta"] = {**data["meta"], "part": 1, "parts_total": 1}
    sections: dict[str, dict[str, Any]] = {}
    shots: list[dict[str, Any]] = []
    music: list[dict[str, Any]] = []
    facts: list[dict[str, Any]] = []
    for d in ordered:
        chunk = director_to_json(d)
        for section in chunk["sections"]:
            known = sections.get(section["id"])
            if known is None:
                sections[section["id"]] = section
            elif known != section:
                errors.append(
                    f"раздел {section['id']}: в части {d.meta.part} отличается от предыдущих, "
                    "ожидалось одинаковое описание раздела во всех частях"
                )
        shots.extend(chunk["shots"])
        music.extend(chunk["music"])
        facts.extend(chunk["facts"])
    if errors:
        raise PartsError(errors)

    data["sections"] = list(sections.values())
    data["shots"] = shots
    data["music"] = music
    data["facts"] = facts
    return validate_director(data)


# --- diff ----------------------------------------------------------------------------------------


def diff_shots(old: Shot, new: Shot) -> list[FieldChange]:
    """Все изменения кадра между версиями в стабильном порядке полей; `id` одинаков по условию."""
    changes: list[FieldChange] = []
    if old.vo != new.vo:
        changes.append(FieldChange("vo", text_change("VO", old.vo, new.vo)))
    if old.image.prompt != new.image.prompt:
        changes.append(
            FieldChange("image.prompt", text_change("Промпт", old.image.prompt, new.image.prompt))
        )
    if old.image.period != new.image.period:
        changes.append(
            FieldChange("image.period", value_change("Эпоха", old.image.period, new.image.period))
        )
    if old.image.appearances != new.image.appearances:
        changes.append(
            FieldChange(
                "image.appearances",
                list_change("Облики", old.image.appearances, new.image.appearances),
            )
        )
    if old.image.shot_size != new.image.shot_size:
        changes.append(
            FieldChange(
                "image.shot_size",
                value_change("Крупность", old.image.shot_size, new.image.shot_size),
            )
        )
    if old.section != new.section:
        changes.append(FieldChange("section", value_change("Раздел", old.section, new.section)))
    if old.motion != new.motion:
        changes.append(
            FieldChange(
                "motion",
                value_change("Движение", describe_motion(old.motion), describe_motion(new.motion)),
            )
        )
    if old.transition_in != new.transition_in:
        changes.append(
            FieldChange(
                "transition_in",
                value_change(
                    "Переход",
                    describe_transition(old.transition_in),
                    describe_transition(new.transition_in),
                ),
            )
        )
    if old.animate != new.animate:
        if old.animate.recommended == new.animate.recommended:
            reason = "Анимация: изменено описание движения"
        else:
            reason = value_change(
                "Анимация", describe_animate(old.animate), describe_animate(new.animate)
            )
        changes.append(FieldChange("animate", reason))
    if old.sfx != new.sfx:
        changes.append(
            FieldChange("sfx", f"SFX: изменены (было {len(old.sfx)}, стало {len(new.sfx)})")
        )
    return changes


def diff_canon(old: CanonRef | None, new: CanonRef | None) -> CanonChanges:
    """Смена версий у ключей, общих для обоих планов; новые и убранные ключи ловит diff кадров."""
    if old is None or new is None:
        return CanonChanges()
    style = None
    if old.style != new.style:
        style = value_change("Стиль канала", old.style, new.style)
    periods = {
        key: value_change(f"Эпоха {key}", old.periods[key], ref)
        for key, ref in new.periods.items()
        if key in old.periods and old.periods[key] != ref
    }
    appearances = {
        key: value_change(f"Облик {key}", old.appearances[key], ref)
        for key, ref in new.appearances.items()
        if key in old.appearances and old.appearances[key] != ref
    }
    return CanonChanges(style=style, periods=periods, appearances=appearances)


# --- мёрдж ---------------------------------------------------------------------------------------


def merge_into_project(
    project: Project,
    old: Director | None,
    new: Director,
    version: str,
    *,
    parts: int,
    created: bool,
    now: str,
) -> tuple[Project, ImportResult]:
    """Новая версия плана поверх project.json: возвращает новый Project и отчёт расхождений.

    Новые кадры → `queued`; отсутствующие в плане → `removed` (ассеты и тайминги на месте);
    изменённые → `stale` по правилам `stale.decide`, остальные — как были. Кадр, вернувшийся в план
    после `removed`, снова `queued`. Порядок отчёта: кадры плана по таймлайну, затем убранные.
    """
    old_shots = {s.id: s for s in old.shots} if old else {}
    new_ids = {s.id for s in new.shots}
    canon = diff_canon(old.canon_ref if old else None, new.canon_ref)

    shots = dict(project.shots)
    changes: list[ShotChange] = []
    for shot in new.shots:
        state = shots.get(shot.id)
        previous = old_shots.get(shot.id)
        if state is None or previous is None or state.status == "removed":
            returned = state is not None and state.status == "removed"
            base = state or ShotState()
            shots[shot.id] = base.model_copy(update={"status": "queued", "stale_reasons": []})
            changes.append(
                ShotChange(
                    shot_id=shot.id,
                    section=shot.section,
                    kind="added",
                    change="Кадр вернулся в план" if returned else "Новый кадр",
                )
            )
            continue
        field_changes = diff_shots(previous, shot)
        canon_rs = canon_reasons(shot, canon)
        if not field_changes and not canon_rs:
            continue
        is_stale, reasons = decide(field_changes, canon_rs, state)
        if is_stale:
            shots[shot.id] = state.model_copy(update={"status": "stale", "stale_reasons": reasons})
        changes.append(
            ShotChange(
                shot_id=shot.id,
                section=shot.section,
                kind="changed",
                change="; ".join([*(c.reason for c in field_changes), *canon_rs]),
                fields=[c.field for c in field_changes],
                stale=is_stale,
            )
        )

    for shot_id, state in shots.items():
        if shot_id in new_ids or state.status == "removed":
            continue
        reason = f"Кадр убран из плана {version}"
        shots[shot_id] = state.model_copy(update={"status": "removed", "stale_reasons": [reason]})
        previous = old_shots.get(shot_id)
        changes.append(
            ShotChange(
                shot_id=shot_id,
                section=previous.section if previous else None,
                kind="removed",
                change=reason,
            )
        )

    added = sum(c.kind == "added" for c in changes)
    changed = sum(c.kind == "changed" for c in changes)
    removed = sum(c.kind == "removed" for c in changes)
    known = project.director_versions.get(version)
    info = DirectorVersionInfo(
        version=version,
        hash=canonical_hash(new),
        imported_at=known.imported_at if known else now,
        parts=parts,
        shots=len(new.shots),
        added=added,
        changed=changed,
        removed=removed,
    )
    updated = project.model_copy(
        update={
            "director_version": version,
            "director_versions": {**project.director_versions, version: info},
            "shots": shots,
            "updated_at": now,
        }
    )
    result = ImportResult(
        version=version,
        created=created,
        added=added,
        changed=changed,
        removed=removed,
        changes=changes,
    )
    return updated, result
