"""Правила `stale`: словарь изменений кадра и какое из них делает кадр устаревшим.

Изменение — пара (поле, причина человеческим языком): «Промпт: добавлено „a lantern in his
hand“»; сами сравнения кадров и канона — `merge.diff_shots` / `merge.diff_canon`.

`stale` получает кадр, у которого картинка перестала соответствовать плану (промпт, облики, эпоха,
крупность, версии канона — принципы 8 и 14) или план конфликтует с ручной блокировкой
(`prompt_locked`, `duration_locked`, `user_override`). Смена VO, движения, перехода, анимации, SFX
и раздела без блокировки — изменение для отчёта импорта, статус кадра не трогает: голос и рендер
увидят её сами по хэшу входов (принцип 8).
"""

import difflib
import re
from dataclasses import dataclass, field
from typing import Any

from app.models.director import AnimateSpec, Motion, Shot, Transition
from app.models.project import ShotState

# Поля кадра, изменение которых делает картинку устаревшей.
STALE_FIELDS = frozenset({"image.prompt", "image.period", "image.appearances", "image.shot_size"})

# Больше фрагментов — не diff, а переписанный текст.
MAX_DIFF_FRAGMENTS = 4
MAX_FRAGMENT_CHARS = 60


@dataclass(frozen=True)
class FieldChange:
    """Одно изменение кадра между версиями плана: поле в точечной записи и причина."""

    field: str
    reason: str


@dataclass(frozen=True)
class CanonChanges:
    """Смена версий канона между планами: причины по стилю, эпохам и обликам."""

    style: str | None = None
    periods: dict[str, str] = field(default_factory=dict)
    appearances: dict[str, str] = field(default_factory=dict)

    def __bool__(self) -> bool:
        return bool(self.style or self.periods or self.appearances)


# --- причины -------------------------------------------------------------------------------------


def text_change(label: str, old: str, new: str) -> str:
    """«Промпт: добавлено „…“; убрано „…“» по словам; сильно переписанный текст — «переписан»."""
    old_words, new_words = old.split(), new.split()
    # Сравниваются слова без пунктуации и регистра («panel,» = «panel»), показываются как есть.
    matcher = difflib.SequenceMatcher(
        None, [_word_key(w) for w in old_words], [_word_key(w) for w in new_words], autojunk=False
    )
    added: list[str] = []
    removed: list[str] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag in ("replace", "insert"):
            added.append(" ".join(new_words[j1:j2]))
        if tag in ("replace", "delete"):
            removed.append(" ".join(old_words[i1:i2]))
    if not added and not removed:
        return f"{label}: изменены пробелы"
    if len(added) + len(removed) > MAX_DIFF_FRAGMENTS:
        return f"{label} переписан"
    parts = []
    if added:
        parts.append("добавлено " + ", ".join(_quote(a) for a in added))
    if removed:
        parts.append("убрано " + ", ".join(_quote(r) for r in removed))
    return f"{label}: {'; '.join(parts)}"


def list_change(label: str, old: list[str], new: list[str], one: str = "") -> str:
    """«Облики: добавлен you@captain-35, убран you@powder-monkey-11»; тот же набор — порядок."""
    added = [x for x in new if x not in old]
    removed = [x for x in old if x not in new]
    parts = []
    if added:
        parts.append(f"добавлен{one} " + ", ".join(added))
    if removed:
        parts.append(f"убран{one} " + ", ".join(removed))
    if not parts:
        return f"{label}: порядок изменён"
    return f"{label}: {', '.join(parts)}"


def value_change(label: str, old: object, new: object) -> str:
    return f"{label}: {old} → {new}"


def describe_motion(m: Motion) -> str:
    return f"{m.type} {m.strength:g} {m.ease}"


def describe_transition(t: Transition) -> str:
    return t.type if t.type == "cut" else f"{t.type} {t.duration:g} с"


def describe_animate(a: AnimateSpec) -> str:
    return f"рекомендована, {a.seconds} с" if a.recommended else "не рекомендована"


def canon_reasons(shot: Shot, canon: CanonChanges) -> list[str]:
    """Смена стиля касается всех кадров; эпохи — кадров этой эпохи; облика — кадров с ним."""
    reasons: list[str] = []
    if canon.style:
        reasons.append(canon.style)
    if shot.image.period in canon.periods:
        reasons.append(canon.periods[shot.image.period])
    reasons.extend(canon.appearances[a] for a in shot.image.appearances if a in canon.appearances)
    return reasons


# --- блокировки ----------------------------------------------------------------------------------


def lock_conflicts(changes: list[FieldChange], state: ShotState) -> list[str]:
    """План изменил поле, которое пользователь заблокировал или переопределил вручную."""
    fields = {c.field for c in changes}
    reasons: list[str] = []
    if state.prompt_locked and "image.prompt" in fields:
        reasons.append("План изменил промпт, но промпт заблокирован — действует ручная правка")
    if state.duration_locked and "vo" in fields:
        reasons.append("План изменил текст VO (длительность), но длительность заблокирована")
    for path in _override_paths(state.user_override):
        for changed in sorted(fields):
            if path == changed or path.startswith(changed + ".") or changed.startswith(path + "."):
                reasons.append(f"План изменил {changed}, но действует ручная правка {path}")
    return reasons


def _override_paths(override: dict[str, Any] | None, prefix: str = "") -> list[str]:
    """Листья `user_override` точечно: {"motion": {"strength": 0.12}} → motion.strength."""
    if not override:
        return []
    paths: list[str] = []
    for key, value in override.items():
        path = f"{prefix}{key}"
        if isinstance(value, dict) and value:
            paths.extend(_override_paths(value, path + "."))
        else:
            paths.append(path)
    return paths


# --- решение -------------------------------------------------------------------------------------


def decide(
    changes: list[FieldChange], canon: list[str], state: ShotState
) -> tuple[bool, list[str]]:
    """(stale?, причины). Причины — только те, что сделали кадр устаревшим."""
    reasons = [c.reason for c in changes if c.field in STALE_FIELDS]
    reasons.extend(canon)
    reasons.extend(lock_conflicts(changes, state))
    return bool(reasons), reasons


def _word_key(word: str) -> str:
    return re.sub(r"[^\w']+", "", word.lower())


def _quote(fragment: str) -> str:
    if len(fragment) > MAX_FRAGMENT_CHARS:
        fragment = fragment[: MAX_FRAGMENT_CHARS - 1].rstrip() + "…"
    return f"„{fragment}“"
