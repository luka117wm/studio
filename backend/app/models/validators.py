"""Доменные проверки director.json и человеческие сообщения об ошибках.

Два слоя:
- `check_director(director)` — проверки поверх уже собранной модели (уникальность, ссылки,
  стоп-лист). Вызывается самой моделью `Director`, поэтому обойти их через `model_validate` нельзя.
- `validate_director(data)` — точка входа для сырого JSON: переводит и структурные ошибки pydantic,
  и доменные в русские строки вида «кадр s047: <что не так>, ожидалось <что>» и отдаёт все разом.

Каждой строке ошибки соответствует `ValidationItem` (кадр, путь поля, та же строка) — для ссылок
«к кадру» в редакторе плана; строки (`errors`) — контракт M2.2, их вид не меняется.
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING, Any

import yaml
from pydantic import BaseModel, ConfigDict, ValidationError

from app.settings import REPO_ROOT

if TYPE_CHECKING:
    from app.models.director import Director, Shot

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


class ValidationItem(BaseModel):
    """Ошибка плана структурно: кадр (`null` — не про кадр), путь поля и строка из `errors`."""

    model_config = ConfigDict(extra="forbid")

    shot_id: str | None
    path: str
    message: str


class DirectorValidationError(ValueError):
    """Все ошибки плана разом: `errors` — по строке на ошибку, `str()` — они же построчно;
    `items` — те же ошибки структурно, в том же порядке."""

    def __init__(self, errors: list[str], items: list[ValidationItem] | None = None) -> None:
        self.errors = errors
        self.items = (
            items
            if items is not None
            else [ValidationItem(shot_id=None, path="", message=e) for e in errors]
        )
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


@dataclass(frozen=True)
class ShotContext:
    """С чем сверяется кадр: разделы плана, ключи `canon_ref` (None — блока нет), стоп-лист."""

    sections: Sequence[str]
    periods: set[str] | None
    appearances: set[str] | None
    stoplist: tuple[tuple[str, str], ...]

    @classmethod
    def of(cls, d: "Director") -> "ShotContext":
        return cls(
            sections=[s.id for s in d.sections],
            periods=set(d.canon_ref.periods) if d.canon_ref else None,
            appearances=set(d.canon_ref.appearances) if d.canon_ref else None,
            stoplist=load_stoplist(),
        )


def check_director(d: "Director") -> list[str]:
    """Все доменные ошибки плана в стабильном порядке; пустой список — план корректен."""
    return [item.message for item in check_director_items(d)]


def check_director_items(d: "Director") -> list[ValidationItem]:
    """`check_director` структурно: строка, кадр и путь поля."""
    items: list[ValidationItem] = []

    def add(message: str, path: str, shot_id: str | None = None) -> None:
        items.append(ValidationItem(shot_id=shot_id, path=path, message=message))

    meta = d.meta
    if meta.part > meta.parts_total:
        add(
            f"meta: part = {meta.part} больше parts_total = {meta.parts_total}, "
            "ожидалось part ≤ parts_total",
            "meta.part",
        )
    if meta.part == 1:
        if d.canon_ref is None:
            add("canon_ref: блок отсутствует, ожидалось обязательный блок в части 1", "canon_ref")
        if d.voice is None:
            add("voice: блок отсутствует, ожидалось обязательный блок в части 1", "voice")

    if d.canon_ref is not None:
        for key, ref in d.canon_ref.periods.items():
            if not PERIOD_REF.fullmatch(ref):
                add(
                    f"canon_ref: periods[{key}] = «{ref}», ожидалось periods/<id>/vNNN",
                    f"canon_ref.periods.{key}",
                )
        for key, ref in d.canon_ref.appearances.items():
            if not APPEARANCE_REF.fullmatch(ref):
                add(
                    f"canon_ref: appearances[{key}] = «{ref}», "
                    "ожидалось characters/<id>/vNNN#<облик>",
                    f"canon_ref.appearances.{key}",
                )

    context = ShotContext.of(d)
    for dup in _duplicates(list(context.sections)):
        add(f"раздел {dup}: id повторяется, ожидалось уникальный id раздела", "sections")
    for dup in _duplicates([s.id for s in d.shots]):
        add(f"кадр {dup}: id повторяется, ожидалось уникальный id кадра", "id", dup)

    for shot in d.shots:
        items.extend(check_shot(shot, context))

    for i, cue in enumerate(d.music):
        if cue.section not in context.sections:
            add(
                f"music[{i}]: раздел «{cue.section}» не найден, "
                f"ожидалось один из {_listing(list(context.sections))}",
                f"music.{i}.section",
            )

    # Факт части может ссылаться на кадр другой части — ссылки проверяет сборка целого плана.
    if meta.parts_total == 1:
        shot_ids = {s.id for s in d.shots}
        for i, fact in enumerate(d.facts):
            if fact.shot_id is not None and fact.shot_id not in shot_ids:
                add(
                    f"facts[{i}]: кадр «{fact.shot_id}» не найден, ожидалось id кадра этого плана",
                    f"facts.{i}.shot_id",
                )

    return items


def check_shot(shot: "Shot", context: ShotContext) -> list[ValidationItem]:
    """Доменные ошибки одного кадра: те же для кадра плана и для кадра с ручной правкой."""
    items: list[ValidationItem] = []
    prefix = f"кадр {shot.id}"

    def add(path: str, text: str) -> None:
        items.append(ValidationItem(shot_id=shot.id, path=path, message=f"{prefix}: {text}"))

    if shot.section not in context.sections:
        add(
            "section",
            f"раздел «{shot.section}» не найден, "
            f"ожидалось один из {_listing(list(context.sections))}",
        )
    if not shot.vo.strip():
        add("vo", "пустой vo, ожидалось текст закадрового голоса")
    if not shot.image.prompt.strip():
        add("image.prompt", "пустой image.prompt, ожидалось действие и композиция кадра")
    if shot.animate.recommended and not (shot.animate.prompt or "").strip():
        add(
            "animate.prompt",
            "animate.recommended = true без animate.prompt, "
            "ожидалось описание движения для анимации",
        )
    if context.periods is not None and shot.image.period not in context.periods:
        add(
            "image.period",
            f"image.period «{shot.image.period}» нет в canon_ref.periods, "
            f"ожидалось один из {_listing(sorted(context.periods))}",
        )
    if context.appearances is not None:
        for appearance in shot.image.appearances:
            if appearance not in context.appearances:
                add(
                    "image.appearances",
                    f"облик «{appearance}» нет в canon_ref.appearances, "
                    f"ожидалось один из {_listing(sorted(context.appearances))}",
                )
    for token, category in find_style_tokens(shot.image.prompt, context.stoplist):
        add(
            "image.prompt",
            f"в image.prompt стилевой токен «{token}» ({category}), "
            "ожидалось только действие, композиция и ракурс — стиль задаёт канон",
        )
    return items


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


def describe_error(err: Mapping[str, Any], path: str) -> str:
    """Одна структурная ошибка pydantic → «<путь> = <значение> …, ожидалось …» по-русски."""
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
    return [item.message for item in describe_pydantic_errors(exc, data)]


def describe_pydantic_errors(exc: ValidationError, data: Mapping[str, Any]) -> list[ValidationItem]:
    """`format_pydantic_errors` структурно: у доменных ошибок кадр и путь — из `check_director`."""
    items: list[ValidationItem] = []
    for err in exc.errors(include_url=False):
        if err["type"] == "director_domain":
            ctx = err.get("ctx") or {}
            items.extend(ValidationItem.model_validate(item) for item in ctx["items"])
            continue
        loc = tuple(err["loc"])
        prefix, path = _locate(loc, data)
        description = describe_error(err, path)
        items.append(
            ValidationItem(
                shot_id=_shot_id_at(loc, data),
                path=path if prefix.startswith("кадр") else ".".join(str(p) for p in loc),
                message=f"{prefix}: {description}" if prefix else description,
            )
        )
    return items


def describe_shot_errors(exc: ValidationError, shot_id: str) -> list[ValidationItem]:
    """Структурные ошибки одного кадра (`Shot`) — в том же виде, что у кадра в плане."""
    items: list[ValidationItem] = []
    for err in exc.errors(include_url=False):
        path = ".".join(str(p) for p in err["loc"])
        items.append(
            ValidationItem(
                shot_id=shot_id,
                path=path,
                message=f"кадр {shot_id}: {describe_error(err, path)}",
            )
        )
    return items


def _shot_id_at(loc: tuple[int | str, ...], data: Mapping[str, Any]) -> str | None:
    if len(loc) >= 2 and loc[0] == "shots" and isinstance(loc[1], int):
        item = _item_at(data, "shots", loc[1])
        shot_id = item.get("id") if isinstance(item, Mapping) else None
        return shot_id if isinstance(shot_id, str) and shot_id else None
    return None


def validate_director(data: Mapping[str, Any]) -> "Director":
    """Собирает `Director` из сырых данных; при ошибках — `DirectorValidationError` со всеми."""
    from app.models.director import Director

    try:
        return Director.model_validate(data)
    except ValidationError as exc:
        items = describe_pydantic_errors(exc, data)
        raise DirectorValidationError([item.message for item in items], items) from None
