"""Доменные проверки director.json и человеческие сообщения об ошибках.

Два слоя:
- `check_director(director)` — проверки поверх уже собранной модели (уникальность, ссылки,
  стоп-лист). Вызывается самой моделью `Director`, поэтому обойти их через `model_validate` нельзя.
- `validate_director(data)` — точка входа для сырого JSON: переводит и структурные ошибки pydantic,
  и доменные в русские строки вида «кадр s047: <что не так>, ожидалось <что>» и отдаёт все разом.
"""

import re
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING, Any

import yaml
from pydantic import ValidationError

from app.settings import REPO_ROOT

if TYPE_CHECKING:
    from app.models.director import Director

STOPLIST_PATH = REPO_ROOT / "config" / "prompt_stoplist.yaml"

PERIOD_REF = re.compile(r"^periods/[a-z0-9-]+/v\d{3}$")
APPEARANCE_REF = re.compile(r"^characters/[a-z0-9-]+/v\d{3}#[a-z0-9-]+$")

# Что ожидалось, по базовому типу структурной ошибки pydantic (`string_type` → «строка»).
TYPE_EXPECTATIONS = {
    "string": "строка",
    "int": "целое число",
    "float": "число",
    "bool": "логическое значение",
    "list": "список",
    "dict": "объект",
    "model": "объект",
    "none": "null",
    "model_attributes": "объект",
}


class DirectorValidationError(ValueError):
    """Все ошибки плана разом: `errors` — по строке на ошибку, `str()` — они же построчно."""

    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("\n".join(errors))


# --- стоп-лист ------------------------------------------------------------------------------


@lru_cache(maxsize=4)
def load_stoplist(path: Path = STOPLIST_PATH) -> tuple[tuple[str, str], ...]:
    """Пары (токен, категория) из `config/prompt_stoplist.yaml`; кэш — файл читается один раз."""
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    pairs: list[tuple[str, str]] = []
    for category, tokens in raw["tokens"].items():
        for token in tokens:
            pairs.append((str(token).lower(), str(category)))
    return tuple(pairs)


def _normalize(text: str) -> str:
    # Пунктуация и лишние пробелы не прячут фразу: «cinematic, lighting» → «cinematic lighting».
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def find_style_tokens(
    prompt: str, stoplist: tuple[tuple[str, str], ...] | None = None
) -> list[tuple[str, str]]:
    """Токены стоп-листа в промпте: без учёта регистра, по целым словам и фразам, по порядку."""
    stoplist = load_stoplist() if stoplist is None else stoplist
    haystack = _normalize(prompt)
    found: list[tuple[int, str, str]] = []
    for token, category in stoplist:
        needle = re.escape(_normalize(token))
        match = re.search(rf"(?<![a-z0-9]){needle}(?![a-z0-9])", haystack)
        if match:
            found.append((match.start(), token, category))
    found.sort()
    return [(token, category) for _, token, category in found]


# --- доменные проверки ----------------------------------------------------------------------


def _duplicates(ids: list[str]) -> list[str]:
    seen: set[str] = set()
    dupes: list[str] = []
    for item in ids:
        if item in seen and item not in dupes:
            dupes.append(item)
        seen.add(item)
    return dupes


def check_director(d: "Director") -> list[str]:
    """Все доменные ошибки плана в стабильном порядке; пустой список — план корректен."""
    errors: list[str] = []
    meta = d.meta

    if meta.part > meta.parts_total:
        errors.append(
            f"meta: part = {meta.part} больше parts_total = {meta.parts_total}, "
            "ожидалось part ≤ parts_total"
        )
    if meta.part == 1:
        if d.canon_ref is None:
            errors.append("canon_ref: блок отсутствует, ожидалось обязательный блок в части 1")
        if d.voice is None:
            errors.append("voice: блок отсутствует, ожидалось обязательный блок в части 1")

    if d.canon_ref is not None:
        for key, ref in d.canon_ref.periods.items():
            if not PERIOD_REF.fullmatch(ref):
                errors.append(f"canon_ref: periods[{key}] = «{ref}», ожидалось periods/<id>/vNNN")
        for key, ref in d.canon_ref.appearances.items():
            if not APPEARANCE_REF.fullmatch(ref):
                errors.append(
                    f"canon_ref: appearances[{key}] = «{ref}», "
                    "ожидалось characters/<id>/vNNN#<облик>"
                )

    section_ids = [s.id for s in d.sections]
    for dup in _duplicates(section_ids):
        errors.append(f"раздел {dup}: id повторяется, ожидалось уникальный id раздела")
    for dup in _duplicates([s.id for s in d.shots]):
        errors.append(f"кадр {dup}: id повторяется, ожидалось уникальный id кадра")

    known_sections = set(section_ids)
    known_periods = set(d.canon_ref.periods) if d.canon_ref else None
    known_appearances = set(d.canon_ref.appearances) if d.canon_ref else None
    stoplist = load_stoplist()

    for shot in d.shots:
        prefix = f"кадр {shot.id}"
        if shot.section not in known_sections:
            errors.append(
                f"{prefix}: раздел «{shot.section}» не найден, "
                f"ожидалось один из {_listing(section_ids)}"
            )
        if not shot.vo.strip():
            errors.append(f"{prefix}: пустой vo, ожидалось текст закадрового голоса")
        if not shot.image.prompt.strip():
            errors.append(f"{prefix}: пустой image.prompt, ожидалось действие и композиция кадра")
        if shot.animate.recommended and not (shot.animate.prompt or "").strip():
            errors.append(
                f"{prefix}: animate.recommended = true без animate.prompt, "
                "ожидалось описание движения для анимации"
            )
        if known_periods is not None and shot.image.period not in known_periods:
            errors.append(
                f"{prefix}: image.period «{shot.image.period}» нет в canon_ref.periods, "
                f"ожидалось один из {_listing(sorted(known_periods))}"
            )
        if known_appearances is not None:
            for appearance in shot.image.appearances:
                if appearance not in known_appearances:
                    errors.append(
                        f"{prefix}: облик «{appearance}» нет в canon_ref.appearances, "
                        f"ожидалось один из {_listing(sorted(known_appearances))}"
                    )
        for token, category in find_style_tokens(shot.image.prompt, stoplist):
            errors.append(
                f"{prefix}: в image.prompt стилевой токен «{token}» ({category}), "
                "ожидалось только действие, композиция и ракурс — стиль задаёт канон"
            )

    for i, cue in enumerate(d.music):
        if cue.section not in known_sections:
            errors.append(
                f"music[{i}]: раздел «{cue.section}» не найден, "
                f"ожидалось один из {_listing(section_ids)}"
            )

    return errors


def _listing(values: list[str]) -> str:
    return ", ".join(values) if values else "(разделов нет)"


# --- перевод структурных ошибок pydantic ----------------------------------------------------


def _locate(loc: tuple[int | str, ...], data: Mapping[str, Any]) -> tuple[str, str]:
    """(префикс, путь внутри): для `shots.3.motion.strength` → («кадр s004», «motion.strength»)."""
    if len(loc) >= 2 and isinstance(loc[1], int) and loc[0] in ("shots", "sections", "music"):
        collection, index = str(loc[0]), loc[1]
        rest = ".".join(str(p) for p in loc[2:])
        item = _item_at(data, collection, index)
        item_id = item.get("id") if isinstance(item, Mapping) else None
        if collection == "shots":
            prefix = f"кадр {item_id}" if item_id else f"кадр #{index + 1}"
        elif collection == "sections":
            prefix = f"раздел {item_id}" if item_id else f"раздел #{index + 1}"
        else:
            prefix = f"music[{index}]"
        return prefix, rest
    if len(loc) >= 2:
        return str(loc[0]), ".".join(str(p) for p in loc[1:])
    # Поле верхнего уровня: префикс не нужен, путь — само поле.
    return "", str(loc[0]) if loc else "документ"


def _item_at(data: Mapping[str, Any], collection: str, index: int) -> Any:
    items = data.get(collection)
    if isinstance(items, list) and 0 <= index < len(items):
        return items[index]
    return None


def _describe(err: Mapping[str, Any], path: str) -> str:
    kind = str(err["type"])
    ctx = err.get("ctx") or {}
    value = err.get("input")
    where = path or "блок"

    if kind == "missing":
        return f"нет поля {where}, ожидалось обязательное поле"
    if kind == "extra_forbidden":
        return f"лишнее поле {where}, ожидалось только поля схемы studio.director/1"
    if kind == "literal_error":
        expected = str(ctx.get("expected", "")).replace(" or ", " или ")
        return f"{where} = {value!r} недопустимо, ожидалось одно из: {expected}"
    if kind in ("greater_than_equal", "greater_than", "less_than_equal", "less_than"):
        sign = {
            "greater_than_equal": "≥",
            "greater_than": ">",
            "less_than_equal": "≤",
            "less_than": "<",
        }[kind]
        bound = ctx.get("ge", ctx.get("gt", ctx.get("le", ctx.get("lt"))))
        return f"{where} = {value!r} вне диапазона, ожидалось {sign} {bound}"
    if kind == "none_required":
        return f"{where} = {value!r}, ожидалось null (поле зарезервировано)"
    if kind == "string_pattern_mismatch":
        return f"{where} = {value!r} не по формату, ожидалось соответствие {ctx.get('pattern')}"
    if kind.endswith("_type") or kind.endswith("_parsing"):
        base = kind.rsplit("_", 1)[0]
        expected = TYPE_EXPECTATIONS.get(base, base)
        return f"{where} = {value!r} не того типа, ожидалось {expected}"
    return f"{where}: {err.get('msg')}"


def format_pydantic_errors(exc: ValidationError, data: Mapping[str, Any]) -> list[str]:
    """Ошибки pydantic → русские строки с ID кадра; доменные (`director_domain`) — как есть."""
    messages: list[str] = []
    for err in exc.errors(include_url=False):
        if err["type"] == "director_domain":
            messages.extend((err.get("ctx") or {})["messages"])
            continue
        prefix, path = _locate(tuple(err["loc"]), data)
        description = _describe(err, path)
        messages.append(f"{prefix}: {description}" if prefix else description)
    return messages


def validate_director(data: Mapping[str, Any]) -> "Director":
    """Собирает `Director` из сырых данных; при ошибках — `DirectorValidationError` со всеми."""
    from app.models.director import Director

    try:
        return Director.model_validate(data)
    except ValidationError as exc:
        raise DirectorValidationError(format_pydantic_errors(exc, data)) from None
