"""Хранилище канона: черновики, неизменяемые версии, резолв ссылок плана (`docs/canon_schema.md`).

Слой или сущность — каталог: `canon/style/`, `canon/periods/<id>/`, `canon/characters/<id>/`.
В нём версии `vNNN.json` и один `draft.json`. Черновик пишется атомарно поверх (L-003) и
проверяется только на форму; «Опубликовать» проверяет правила публикации, пишет `v<N+1>.json`
только новым файлом (`write_json_new`) и удаляет черновик. Версии не правятся и не удаляются.

Отказы — `CanonError` с готовой фразой для пользователя и HTTP-кодом; ссылка плана, которая
не резолвится, — `CanonRefError`.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.models.canon import (
    VERSION_PATTERN,
    Appearance,
    CanonCharacterItem,
    CanonEntity,
    CanonPeriodItem,
    CanonStyleSummary,
    CanonSummary,
    CanonVersionInfo,
    Character,
    Period,
    Style,
)
from app.models.director import StrictModel
from app.storage.atomic import read_json, write_json_atomic, write_json_new
from app.storage.db import now_iso
from app.storage.paths import StudioPaths

_VERSION_FILE_RE = re.compile(r"^v(\d{3})\.json$")
_VERSION_TAG_RE = re.compile(VERSION_PATTERN)
_ID = r"[a-z0-9][a-z0-9-]*"
_ENTITY_DIR_RE = re.compile(rf"^{_ID}$")
_STYLE_REF_RE = re.compile(r"^style/(v\d{3})$")
_PERIOD_REF_RE = re.compile(rf"^periods/({_ID})/(v\d{{3}})$")
_APPEARANCE_REF_RE = re.compile(rf"^characters/({_ID})/(v\d{{3}})#({_ID})$")


class CanonError(Exception):
    """Отказ хранилища с текстом для пользователя; `status` — HTTP-код ответа."""

    status = 409


class CanonNotFound(CanonError):
    status = 404


class CanonConflict(CanonError):
    status = 409


class CanonRefError(ValueError):
    """Ссылка `canon_ref` не резолвится. Текст — фрагмент со строчной буквы, чтобы импорт
    плана мог приставить кадр: «кадр s047: облик you@captain-35 не найден в characters/you/v004»."""

    def __init__(self, ref: str, message: str) -> None:
        super().__init__(message)
        self.ref = ref


@dataclass(frozen=True)
class Layer[E: CanonEntity]:
    """Слой канона: модель, каталог сущности и имя в родительном падеже для отказов."""

    key: str
    model: type[E]
    entity_dir: Callable[[StudioPaths, str, str | None], Path]
    genitive: Callable[[str | None], str]


@dataclass(frozen=True)
class Entry[E: CanonEntity]:
    """Прочитанный черновик (`version` — None) или версия `vNNN`."""

    data: E
    version: str | None
    based_on: str | None
    updated_at: str


class _VersionFile(StrictModel):
    based_on: str | None
    published_at: str
    data: dict[str, Any]


class _DraftFile(StrictModel):
    based_on: str | None
    saved_at: str
    data: dict[str, Any]


def _need_id(entity_id: str | None) -> str:
    if entity_id is None:
        raise ValueError("entity id is required for periods and characters")
    return entity_id


STYLE: Layer[Style] = Layer(
    key="style",
    model=Style,
    entity_dir=lambda paths, channel, _: paths.canon_style_dir(channel),
    genitive=lambda _: "стиля канала",
)
PERIODS: Layer[Period] = Layer(
    key="periods",
    model=Period,
    entity_dir=lambda paths, channel, eid: paths.canon_period_dir(channel, _need_id(eid)),
    genitive=lambda eid: f"эпохи {eid}",
)
CHARACTERS: Layer[Character] = Layer(
    key="characters",
    model=Character,
    entity_dir=lambda paths, channel, eid: paths.canon_character_dir(channel, _need_id(eid)),
    genitive=lambda eid: f"персонажа {eid}",
)


def version_tag(number: int) -> str:
    return f"v{number:03d}"


def _dump(entity: CanonEntity) -> dict[str, Any]:
    data: dict[str, Any] = entity.model_dump(mode="json", by_alias=True)
    return data


def _numbers(folder: Path) -> list[int]:
    """Номера опубликованных версий по возрастанию."""
    if not folder.is_dir():
        return []
    found = (_VERSION_FILE_RE.fullmatch(p.name) for p in folder.iterdir())
    return sorted(int(m.group(1)) for m in found if m)


def _read_version[E: CanonEntity](folder: Path, layer: Layer[E], number: int) -> Entry[E]:
    raw = _VersionFile.model_validate(read_json(StudioPaths.canon_version_path(folder, number)))
    return Entry(
        data=layer.model.model_validate(raw.data),
        version=version_tag(number),
        based_on=raw.based_on,
        updated_at=raw.published_at,
    )


def _read_draft[E: CanonEntity](folder: Path, layer: Layer[E]) -> Entry[E] | None:
    path = StudioPaths.canon_draft_path(folder)
    if not path.exists():
        return None
    raw = _DraftFile.model_validate(read_json(path))
    return Entry(
        data=layer.model.model_validate(raw.data),
        version=None,
        based_on=raw.based_on,
        updated_at=raw.saved_at,
    )


def _exists(folder: Path) -> bool:
    return StudioPaths.canon_draft_path(folder).exists() or bool(_numbers(folder))


def _missing[E: CanonEntity](layer: Layer[E], channel: str, entity_id: str | None) -> CanonNotFound:
    what = layer.genitive(entity_id)
    return CanonNotFound(f"{what[0].upper()}{what[1:]} в каноне {channel} нет — создайте черновик.")


def list_versions[E: CanonEntity](
    paths: StudioPaths, channel: str, layer: Layer[E], entity_id: str | None = None
) -> list[CanonVersionInfo]:
    folder = layer.entity_dir(paths, channel, entity_id)
    infos: list[CanonVersionInfo] = []
    for number in _numbers(folder):
        entry = _read_version(folder, layer, number)
        infos.append(
            CanonVersionInfo(
                version=version_tag(number), based_on=entry.based_on, published_at=entry.updated_at
            )
        )
    return infos


def read_entry[E: CanonEntity](
    paths: StudioPaths,
    channel: str,
    layer: Layer[E],
    entity_id: str | None = None,
    version: str | None = None,
) -> Entry[E]:
    """Версия `version`; без неё — черновик, а без черновика — последняя версия."""
    folder = layer.entity_dir(paths, channel, entity_id)
    if not _exists(folder):
        raise _missing(layer, channel, entity_id)
    numbers = _numbers(folder)
    if version is None:
        draft = _read_draft(folder, layer)
        if draft is not None:
            return draft
        return _read_version(folder, layer, numbers[-1])
    if not _VERSION_TAG_RE.fullmatch(version):
        raise ValueError(f"canon version {version!r} must look like v001")
    number = int(version[1:])
    if number not in numbers:
        have = ", ".join(version_tag(n) for n in numbers) or "опубликованных версий нет"
        raise CanonNotFound(f"У {layer.genitive(entity_id)} нет версии {version} — есть: {have}.")
    return _read_version(folder, layer, number)


def save_draft[E: CanonEntity](
    paths: StudioPaths, channel: str, layer: Layer[E], entity_id: str | None, data: E
) -> Entry[E]:
    """Черновик целиком, атомарно поверх прежнего. Правила публикации не проверяются.

    `based_on` — от прежнего черновика, а без него — последняя версия (правят то, что видят).
    """
    if getattr(data, "id", entity_id) != entity_id:
        raise ValueError(f"draft id {getattr(data, 'id', None)!r} != {entity_id!r}")
    folder = layer.entity_dir(paths, channel, entity_id)
    previous = _read_draft(folder, layer)
    if previous is not None:
        based_on = previous.based_on
    else:
        numbers = _numbers(folder)
        based_on = version_tag(numbers[-1]) if numbers else None
    return _write_draft(folder, data, based_on)


def _write_draft[E: CanonEntity](folder: Path, data: E, based_on: str | None) -> Entry[E]:
    saved_at = now_iso()
    write_json_atomic(
        StudioPaths.canon_draft_path(folder),
        {"based_on": based_on, "saved_at": saved_at, "data": _dump(data)},
    )
    return Entry(data=data, version=None, based_on=based_on, updated_at=saved_at)


def draft_from[E: CanonEntity](
    paths: StudioPaths, channel: str, layer: Layer[E], entity_id: str | None, version: str
) -> Entry[E]:
    """Черновик из любой версии: «Создать v004 из v002». Несохранённый черновик не затирается."""
    folder = layer.entity_dir(paths, channel, entity_id)
    if _read_draft(folder, layer) is not None:
        raise CanonConflict(
            f"У {layer.genitive(entity_id)} уже есть черновик — опубликуйте или сбросьте его, "
            f"потом создавайте черновик из {version}."
        )
    source = read_entry(paths, channel, layer, entity_id, version)
    return _write_draft(folder, source.data, version)


def discard_draft[E: CanonEntity](
    paths: StudioPaths, channel: str, layer: Layer[E], entity_id: str | None = None
) -> None:
    """Сбросить черновик; версии не трогаются."""
    folder = layer.entity_dir(paths, channel, entity_id)
    path = StudioPaths.canon_draft_path(folder)
    if not path.exists():
        if not _exists(folder):
            raise _missing(layer, channel, entity_id)
        raise CanonNotFound(f"У {layer.genitive(entity_id)} нет черновика — сбрасывать нечего.")
    path.unlink()


def publish[E: CanonEntity](
    paths: StudioPaths, channel: str, layer: Layer[E], entity_id: str | None = None
) -> Entry[E]:
    """Черновик → `v<N+1>.json`, черновик удаляется. Отказ — черновик остаётся как был."""
    folder = layer.entity_dir(paths, channel, entity_id)
    draft = _read_draft(folder, layer)
    what = layer.genitive(entity_id)
    if draft is None:
        if not _exists(folder):
            raise _missing(layer, channel, entity_id)
        raise CanonConflict(f"У {what} нет черновика — публиковать нечего.")
    problems = draft.data.publish_problems()
    if problems:
        raise CanonConflict("\n".join(problems))
    numbers = _numbers(folder)
    if numbers:
        latest = _read_version(folder, layer, numbers[-1])
        if _dump(latest.data) == _dump(draft.data):
            raise CanonConflict(
                f"Черновик {what} не отличается от {latest.version} — публиковать нечего, "
                "сбросьте черновик."
            )
    number = (numbers[-1] if numbers else 0) + 1
    if number > 999:
        raise CanonConflict(f"У {what} уже 999 версий — больше формат vNNN не вмещает.")
    tag = version_tag(number)
    published_at = now_iso()
    try:
        write_json_new(
            StudioPaths.canon_version_path(folder, number),
            {"based_on": draft.based_on, "published_at": published_at, "data": _dump(draft.data)},
        )
    except FileExistsError:
        raise CanonConflict(
            f"Версия {tag} {what} уже есть — опубликованные версии не перезаписываются, "
            "обновите страницу."
        ) from None
    StudioPaths.canon_draft_path(folder).unlink()
    return Entry(data=draft.data, version=tag, based_on=draft.based_on, updated_at=published_at)


# --- сводка канона ------------------------------------------------------------------------------


def _entity_ids(root: Path) -> list[str]:
    """Каталоги сущностей слоя, где есть черновик или версия."""
    if not root.is_dir():
        return []
    return sorted(
        p.name
        for p in root.iterdir()
        if p.is_dir() and _ENTITY_DIR_RE.fullmatch(p.name) and _exists(p)
    )


def summary(paths: StudioPaths, channel: str) -> CanonSummary:
    style_dir = STYLE.entity_dir(paths, channel, None)
    periods: list[CanonPeriodItem] = []
    for period_id in _entity_ids(paths.canon_periods_root(channel)):
        period = read_entry(paths, channel, PERIODS, period_id).data
        periods.append(
            CanonPeriodItem(
                id=period_id,
                label=period.label,
                region=period.region,
                years=period.years,
                versions=list_versions(paths, channel, PERIODS, period_id),
                draft=StudioPaths.canon_draft_path(
                    paths.canon_period_dir(channel, period_id)
                ).exists(),
                forbidden_count=len(period.forbidden),
            )
        )
    characters: list[CanonCharacterItem] = []
    for character_id in _entity_ids(paths.canon_characters_root(channel)):
        character = read_entry(paths, channel, CHARACTERS, character_id).data
        characters.append(
            CanonCharacterItem(
                id=character_id,
                label=character.label,
                versions=list_versions(paths, channel, CHARACTERS, character_id),
                draft=StudioPaths.canon_draft_path(
                    paths.canon_character_dir(channel, character_id)
                ).exists(),
                appearances_count=len(character.appearances),
            )
        )
    return CanonSummary(
        channel=channel,
        style=CanonStyleSummary(
            versions=list_versions(paths, channel, STYLE),
            draft=StudioPaths.canon_draft_path(style_dir).exists(),
        ),
        periods=periods,
        characters=characters,
    )


# --- резолв ссылок canon_ref --------------------------------------------------------------------


def _resolve[E: CanonEntity](
    paths: StudioPaths, channel: str, layer: Layer[E], entity_id: str | None, tag: str
) -> E | None:
    """Опубликованная версия `tag` или None, если её нет. Черновик ссылкой не резолвится."""
    folder = layer.entity_dir(paths, channel, entity_id)
    number = int(tag[1:])
    if not StudioPaths.canon_version_path(folder, number).exists():
        return None
    return _read_version(folder, layer, number).data


def resolve_style(paths: StudioPaths, channel: str, ref: str) -> Style:
    """`style/v003` → стиль этой версии."""
    match = _STYLE_REF_RE.fullmatch(ref)
    if match is None:
        raise CanonRefError(ref, f"ссылка «{ref}» не по формату style/vNNN")
    style = _resolve(paths, channel, STYLE, None, match.group(1))
    if style is None:
        raise CanonRefError(ref, f"стиль {ref} не найден в каноне {channel}")
    return style


def resolve_period(paths: StudioPaths, channel: str, ref: str) -> Period:
    """`periods/caribbean-1716/v002` → эпоха этой версии."""
    match = _PERIOD_REF_RE.fullmatch(ref)
    if match is None:
        raise CanonRefError(ref, f"ссылка «{ref}» не по формату periods/<эпоха>/vNNN")
    period_id, tag = match.groups()
    period = _resolve(paths, channel, PERIODS, period_id, tag)
    if period is None:
        raise CanonRefError(ref, f"эпоха {ref} не найдена в каноне {channel}")
    return period


def resolve_appearance(paths: StudioPaths, channel: str, ref: str) -> tuple[Character, Appearance]:
    """`characters/you/v004#captain-35` → персонаж этой версии и его облик `you@captain-35`."""
    match = _APPEARANCE_REF_RE.fullmatch(ref)
    if match is None:
        raise CanonRefError(ref, f"ссылка «{ref}» не по формату characters/<персонаж>/vNNN#<облик>")
    character_id, tag, suffix = match.groups()
    file_ref = ref.split("#", 1)[0]
    character = _resolve(paths, channel, CHARACTERS, character_id, tag)
    if character is None:
        raise CanonRefError(ref, f"персонаж {file_ref} не найден в каноне {channel}")
    appearance_id = f"{character_id}@{suffix}"
    appearance = character.appearance(appearance_id)
    if appearance is None:
        raise CanonRefError(ref, f"облик {appearance_id} не найден в {file_ref}")
    return character, appearance


# --- копия облика в другую эпоху (M5.4) -----------------------------------------------------------


def copy_appearance(
    paths: StudioPaths, channel: str, source_id: str, new_id: str, period: str
) -> Entry[Character]:
    """Облик `source_id` → новый облик `new_id` эпохи `period` в черновике персонажа: тот же
    человек в другой эпохе (устав M5, решение 5). `face`, `build`, `hair`, `age` и `negative_local`
    переносятся побайтово, неизменяемое персонажа общее; одежда, износ, предметы и подпись —
    пустые, листа у копии нет. Источник — черновик персонажа, а без него — последняя версия."""
    character_id = source_id.split("@", 1)[0]
    entry = read_entry(paths, channel, CHARACTERS, character_id)
    where = "черновике" if entry.version is None else entry.version
    source = entry.data.appearance(source_id)
    if source is None:
        raise CanonNotFound(
            f"Облика {source_id} нет в персонаже {character_id} ({where}) — копировать нечего."
        )
    if entry.data.appearance(new_id) is not None:
        raise CanonConflict(
            f"Облик {new_id} уже есть в персонаже {character_id} — выберите другой id копии."
        )
    copy = Appearance(
        id=new_id,
        period=period,
        age=source.age,
        build=source.build,
        face=source.face,
        hair=source.hair,
        negative_local=list(source.negative_local),
    )
    character = entry.data.model_copy(update={"appearances": [*entry.data.appearances, copy]})
    return save_draft(paths, channel, CHARACTERS, character_id, character)
