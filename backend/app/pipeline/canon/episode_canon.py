"""Канон выпуска (M5.2): к каким версиям канона прибит план и готовы ли они.

Устав M5, решения 2, 3, 8.

- `published_canon` — снимок канона канала: опубликованные версии и черновики каждой сущности.
- `pin_style` / `pin_period` / `pin_appearance` — правило версий `canon_ref` новой версии плана:
  прибитое в прошлой версии остаётся, новое получает последнюю опубликованную, нет версии —
  заготовку `v001`. Новые версии канона план сам не подхватывает (принцип 14).
- `updated_ref` — `canon_ref` для «Перевести на новые версии»: последние опубликованные, где есть.
- `episode_canon` — состояние канона выпуска: статусы, лист облика, проблемы для «Утвердить план».
- `canon_needed` — «нужно каналу»: id из планов выпусков, у которых нет опубликованной версии.
- `canon_overview` — сводка канона для экрана 12: сколько выпусков ссылаются на эпоху и сколько
  листов обликов готово.

Всё, кроме `published_canon`, `sheet_state`, `load_episode_canon` и `canon_overview`, — чистые
функции от снимка.
Лист облика читает `pipeline/canon/anchors.py` (M5.4).
Контракты — `docs/canon_schema.md`, `docs/director_schema.md`, `docs/episodes.md`.
"""

import re
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from functools import partial
from typing import Literal

from pydantic import BaseModel

from app.models.canon import CanonSummary
from app.models.director import CanonRef, Director
from app.pipeline.canon.anchors import SheetStatus, latest_appearance, sheet_status
from app.storage import canon_store
from app.storage.canon_store import CHARACTERS
from app.storage.paths import StudioPaths

# Версия, на которую ссылается план, пока у сущности нет опубликованной: файл появится по этому id.
PLACEHOLDER_VERSION = "v001"
# Ракурсов в листе опорных портретов облика (устав M5, решение 5).
SHEET_ANGLES = 6

CanonKind = Literal["style", "period", "appearance"]
# missing — нет ни версии, ни черновика; draft_only — только черновик; ready — прибита последняя
# версия; outdated — есть версия новее прибитой (или прибитая не находится, а опубликованная есть).
CanonStatus = Literal["missing", "draft_only", "ready", "outdated"]
# unpublished — нет опубликованной версии; unresolved — ссылка не находит версию, а новее есть.
CanonIssue = Literal["unpublished", "unresolved", "no_sheet", "sheet_incomplete", "sheet_outdated"]

_REF_TAG_RE = re.compile(r"/(v\d{3})(?:#[^/]*)?$")
_SUBJECT: dict[CanonKind, str] = {"style": "стиль канала", "period": "эпоха", "appearance": "облик"}
_NOT_PUBLISHED: dict[CanonKind, str] = {
    "style": "стиль канала не опубликован — заполните и опубликуйте его",
    "period": "эпоха {id} не опубликована — создайте и опубликуйте её",
    "appearance": "облик {id} не опубликован — создайте и опубликуйте его",
}
_ON_SCREEN = " на экране «Канон»"


# --- ссылки --------------------------------------------------------------------------------------


def style_ref(tag: str) -> str:
    return f"style/{tag}"


def period_ref(period_id: str, tag: str) -> str:
    return f"periods/{period_id}/{tag}"


def appearance_ref(appearance_id: str, tag: str) -> str:
    character, look = appearance_id.split("@", 1)
    return f"characters/{character}/{tag}#{look}"


def ref_tag(ref: str) -> str | None:
    """Версия из ссылки: `characters/you/v004#captain-35` → `v004`; не по формату — None."""
    match = _REF_TAG_RE.search(ref)
    return match.group(1) if match else None


def plan_canon_ref(director: Director) -> CanonRef:
    """`canon_ref` версии плана: у собранной версии он есть всегда (`validate_director`)."""
    if director.canon_ref is None:
        raise ValueError(f"plan {director.meta.episode_id} has no canon_ref")
    return director.canon_ref


# --- снимок канона канала ------------------------------------------------------------------------


@dataclass(frozen=True)
class Versions:
    """Опубликованные версии сущности по возрастанию и есть ли черновик."""

    tags: tuple[str, ...] = ()
    draft: bool = False

    @property
    def latest(self) -> str | None:
        return self.tags[-1] if self.tags else None


@dataclass(frozen=True)
class PublishedCanon:
    """Снимок канона канала. У облика `tags` — версии персонажа, где облик есть; `draft` — облик
    есть в черновике персонажа."""

    style: Versions = Versions()
    periods: Mapping[str, Versions] = field(default_factory=dict)
    appearances: Mapping[str, Versions] = field(default_factory=dict)
    # Персонажи, у которых есть черновик или версия.
    characters: frozenset[str] = frozenset()

    def period(self, period_id: str) -> Versions:
        return self.periods.get(period_id, Versions())

    def appearance(self, appearance_id: str) -> Versions:
        return self.appearances.get(appearance_id, Versions())


def published_canon(paths: StudioPaths, channel: str) -> PublishedCanon:
    summary = canon_store.summary(paths, channel)
    found: dict[str, list[str]] = {}
    drafted: set[str] = set()
    for item in summary.characters:
        for info in item.versions:
            entry = canon_store.read_entry(paths, channel, CHARACTERS, item.id, info.version)
            for appearance in entry.data.appearances:
                found.setdefault(appearance.id, []).append(info.version)
        if item.draft:
            draft = canon_store.read_entry(paths, channel, CHARACTERS, item.id).data
            drafted.update(appearance.id for appearance in draft.appearances)
    return PublishedCanon(
        style=Versions(tuple(v.version for v in summary.style.versions), summary.style.draft),
        periods={
            item.id: Versions(tuple(v.version for v in item.versions), item.draft)
            for item in summary.periods
        },
        appearances={
            key: Versions(tuple(found.get(key, ())), key in drafted)
            for key in sorted({*found, *drafted})
        },
        characters=frozenset(item.id for item in summary.characters),
    )


# --- правило версий новой версии плана -----------------------------------------------------------


@dataclass(frozen=True)
class CanonPins:
    """С чем строится `canon_ref` новой версии плана: ссылки прошлой версии и снимок канона.
    По умолчанию — ни прошлой версии, ни канона: везде заготовка `v001`."""

    previous: CanonRef | None = None
    published: PublishedCanon = field(default_factory=PublishedCanon)


def pin_style(pins: CanonPins) -> str:
    if pins.previous is not None:
        return pins.previous.style
    return style_ref(pins.published.style.latest or PLACEHOLDER_VERSION)


def pin_period(period_id: str, pins: CanonPins) -> str:
    if pins.previous is not None and period_id in pins.previous.periods:
        return pins.previous.periods[period_id]
    tag = pins.published.period(period_id).latest
    return period_ref(period_id, tag or PLACEHOLDER_VERSION)


def pin_appearance(appearance_id: str, pins: CanonPins) -> str:
    if pins.previous is not None and appearance_id in pins.previous.appearances:
        return pins.previous.appearances[appearance_id]
    tag = pins.published.appearance(appearance_id).latest
    return appearance_ref(appearance_id, tag or PLACEHOLDER_VERSION)


def updated_ref(ref: CanonRef, published: PublishedCanon) -> CanonRef:
    """«Перевести на новые версии»: у каждой ссылки — последняя опубликованная версия; у сущности
    без опубликованной версии ссылка остаётся как была."""
    style = published.style.latest
    return CanonRef(
        style=style_ref(style) if style else ref.style,
        periods={
            key: period_ref(key, tag) if (tag := published.period(key).latest) else value
            for key, value in ref.periods.items()
        },
        appearances={
            key: appearance_ref(key, tag) if (tag := published.appearance(key).latest) else value
            for key, value in ref.appearances.items()
        },
    )


# --- лист опорных портретов ----------------------------------------------------------------------


class AnchorSheet(BaseModel):
    """Лист опорных портретов облика для версии персонажа: выбрано ракурсов из шести (M5.4)."""

    status: SheetStatus
    chosen: int
    total: int = SHEET_ANGLES


SheetLookup = Callable[[str, str], AnchorSheet]


def no_sheet() -> AnchorSheet:
    return AnchorSheet(status="missing", chosen=0)


def sheet_state(paths: StudioPaths, channel: str, appearance_id: str, version: str) -> AnchorSheet:
    """Лист облика `appearance_id` против версии персонажа `version`, к которой прибит выпуск:
    сколько ракурсов выбрано в `chosen.json` и не устарел ли выбор (M5.4)."""
    status, chosen = sheet_status(paths, channel, appearance_id, version, SHEET_ANGLES)
    return AnchorSheet(status=status, chosen=chosen)


# --- канон выпуска -------------------------------------------------------------------------------


class CanonTarget(BaseModel):
    """Что не готово в каноне выпуска: сущность и вид проблемы."""

    kind: CanonKind
    id: str  # у стиля — "style"
    issue: CanonIssue


class CanonProblem(CanonTarget):
    message: str


class EpisodeCanonItem(BaseModel):
    """Стиль, эпоха или облик из `canon_ref` плана."""

    id: str
    ref: str  # ссылка из `canon_ref`
    pinned: str | None  # версия из ссылки; null — ссылка не по формату
    latest: str | None  # последняя опубликованная версия; у облика — персонажа, где облик есть
    status: CanonStatus
    resolved: bool  # ссылка находит опубликованную версию
    draft: bool  # есть черновик (у облика — облик в черновике персонажа)
    shots: int  # кадров плана с этой эпохой или обликом; у стиля — все кадры


class EpisodeAppearanceItem(EpisodeCanonItem):
    sheet: AnchorSheet


class EpisodeCanon(BaseModel):
    """Канон выпуска для экрана 3 (`GET /api/projects/{id}/canon`)."""

    plan_version: str
    ready: bool  # ни одной проблемы: можно утверждать по канону
    updatable: bool  # «Перевести на новые версии» что-то поменяет
    style: EpisodeCanonItem
    periods: list[EpisodeCanonItem]
    appearances: list[EpisodeAppearanceItem]
    problems: list[CanonProblem]


def _item(
    entity_id: str, ref: str, canonical: Callable[[str], str], versions: Versions, shots: int
) -> EpisodeCanonItem:
    pinned = ref_tag(ref)
    resolved = pinned is not None and pinned in versions.tags and canonical(pinned) == ref
    latest = versions.latest
    status: CanonStatus
    if latest is None:
        status = "draft_only" if versions.draft else "missing"
    elif resolved and pinned == latest:
        status = "ready"
    else:
        status = "outdated"
    return EpisodeCanonItem(
        id=entity_id,
        ref=ref,
        pinned=pinned,
        latest=latest,
        status=status,
        resolved=resolved,
        draft=versions.draft,
        shots=shots,
    )


def _ref_problem(kind: CanonKind, item: EpisodeCanonItem) -> CanonProblem | None:
    if item.resolved:
        return None
    subject = _SUBJECT[kind] if kind == "style" else f"{_SUBJECT[kind]} {item.id}"
    if item.latest is None:
        if item.status == "draft_only":
            message = f"{subject}: есть только черновик — опубликуйте его{_ON_SCREEN}"
        else:
            message = _NOT_PUBLISHED[kind].format(id=item.id) + _ON_SCREEN
        return CanonProblem(kind=kind, id=item.id, issue="unpublished", message=message)
    return CanonProblem(
        kind=kind,
        id=item.id,
        issue="unresolved",
        message=f"{subject}: ссылка {item.ref} не находит опубликованную версию — переведите "
        f"выпуск на {item.latest} кнопкой «Перевести на новые версии»",
    )


def _sheet_problem(item: EpisodeAppearanceItem) -> CanonProblem | None:
    sheet = item.sheet
    if not item.resolved or sheet.status == "ready":
        return None
    subject = f"облик {item.id}"
    if sheet.status == "missing":
        issue: CanonIssue = "no_sheet"
        message = f"{subject}: нет листа опорных портретов — соберите его{_ON_SCREEN}"
    elif sheet.status == "partial":
        issue = "sheet_incomplete"
        message = (
            f"{subject}: лист {sheet.chosen}/{sheet.total} — выберите недостающие ракурсы"
            + _ON_SCREEN
        )
    else:
        issue = "sheet_outdated"
        message = f"{subject}: лист устарел — пересоберите его{_ON_SCREEN}"
    return CanonProblem(kind="appearance", id=item.id, issue=issue, message=message)


def episode_canon(
    director: Director, version: str, published: PublishedCanon, sheets: SheetLookup
) -> EpisodeCanon:
    """Канон версии плана `version`: что прибито, что опубликовано, что мешает утвердить.

    Лист проверяется только у облика, чья ссылка находит версию: лист привязан к версии облика."""
    ref = plan_canon_ref(director)
    shots = director.shots
    style = _item("style", ref.style, style_ref, published.style, len(shots))
    periods = [
        _item(
            key,
            value,
            partial(period_ref, key),
            published.period(key),
            sum(shot.image.period == key for shot in shots),
        )
        for key, value in ref.periods.items()
    ]
    appearances: list[EpisodeAppearanceItem] = []
    for key, value in ref.appearances.items():
        base = _item(
            key,
            value,
            partial(appearance_ref, key),
            published.appearance(key),
            sum(key in shot.image.appearances for shot in shots),
        )
        sheet = sheets(key, base.pinned) if base.resolved and base.pinned else no_sheet()
        appearances.append(EpisodeAppearanceItem(**base.model_dump(), sheet=sheet))

    problems = [
        problem
        for problem in (
            _ref_problem("style", style),
            *(_ref_problem("period", item) for item in periods),
            *(_ref_problem("appearance", item) for item in appearances),
            *(_sheet_problem(item) for item in appearances),
        )
        if problem is not None
    ]
    return EpisodeCanon(
        plan_version=version,
        ready=not problems,
        updatable=updated_ref(ref, published) != ref,
        style=style,
        periods=periods,
        appearances=appearances,
        problems=problems,
    )


def load_episode_canon(
    paths: StudioPaths, channel: str, director: Director, version: str
) -> EpisodeCanon:
    """Канон выпуска по каналу на диске; лист облика — `sheet_state`."""
    return episode_canon(
        director,
        version,
        published_canon(paths, channel),
        lambda appearance_id, tag: sheet_state(paths, channel, appearance_id, tag),
    )


# --- нужно каналу --------------------------------------------------------------------------------


@dataclass(frozen=True)
class EpisodePlan:
    """Текущая версия плана выпуска канала."""

    episode_id: str
    title: str
    director: Director


class NeededEpisode(BaseModel):
    id: str
    title: str
    shots: int  # кадров этого выпуска с эпохой или обликом


class NeededItem(BaseModel):
    id: str
    draft: bool  # черновик уже начат: создавать скелет не нужно, нужно опубликовать
    shots: int  # кадров во всех выпусках
    episodes: list[NeededEpisode]


class NeededAppearance(NeededItem):
    character_exists: bool  # персонаж облика есть в каноне — облик допишется в его черновик


class CanonNeeded(BaseModel):
    """«Нужно каналу» (`GET /api/canon/{channel}/needed`): эпохи и облики из `canon_ref` текущих
    версий планов, у которых нет ни одной опубликованной версии."""

    channel: str
    periods: list[NeededItem]
    appearances: list[NeededAppearance]


def canon_needed(
    channel: str, plans: Iterable[EpisodePlan], published: PublishedCanon
) -> CanonNeeded:
    periods: dict[str, list[NeededEpisode]] = {}
    appearances: dict[str, list[NeededEpisode]] = {}
    for plan in plans:
        ref, shots = plan.director.canon_ref, plan.director.shots
        if ref is None:
            continue
        for key in ref.periods:
            if published.period(key).latest is None:
                count = sum(shot.image.period == key for shot in shots)
                periods.setdefault(key, []).append(
                    NeededEpisode(id=plan.episode_id, title=plan.title, shots=count)
                )
        for key in ref.appearances:
            if published.appearance(key).latest is None:
                count = sum(key in shot.image.appearances for shot in shots)
                appearances.setdefault(key, []).append(
                    NeededEpisode(id=plan.episode_id, title=plan.title, shots=count)
                )
    return CanonNeeded(
        channel=channel,
        periods=[
            NeededItem(
                id=key,
                draft=published.period(key).draft,
                shots=sum(e.shots for e in episodes),
                episodes=episodes,
            )
            for key, episodes in sorted(periods.items())
        ],
        appearances=[
            NeededAppearance(
                id=key,
                draft=published.appearance(key).draft,
                shots=sum(e.shots for e in episodes),
                episodes=episodes,
                character_exists=key.split("@", 1)[0] in published.characters,
            )
            for key, episodes in sorted(appearances.items())
        ],
    )


def uses_period(director: Director, period_id: str) -> bool:
    """Эпоха есть в `canon_ref` плана или хотя бы в одном его кадре."""
    pinned = director.canon_ref is not None and period_id in director.canon_ref.periods
    return pinned or any(shot.image.period == period_id for shot in director.shots)


# --- сводка экрана 12 ----------------------------------------------------------------------------


def _ready_sheets(paths: StudioPaths, channel: str, character_id: str) -> int:
    """Облики персонажа (черновик, без него — последняя версия), чей лист готов 6/6 против
    последней опубликованной версии персонажа с обликом. Облик без версии листа не имеет."""
    head = canon_store.read_entry(paths, channel, CHARACTERS, character_id).data
    ready = 0
    for appearance in head.appearances:
        found = latest_appearance(paths, channel, appearance.id)
        if found is not None:
            status, _ = sheet_status(paths, channel, appearance.id, found[2], SHEET_ANGLES)
            ready += status == "ready"
    return ready


def canon_overview(paths: StudioPaths, channel: str, plans: Iterable[EpisodePlan]) -> CanonSummary:
    """Сводка канона канала (`canon_store.summary`) со счётчиками экрана 12: у эпохи — сколько
    выпусков ссылаются на неё текущими планами, у персонажа — сколько листов обликов готово."""
    summary = canon_store.summary(paths, channel)
    directors = [plan.director for plan in plans]
    periods = [
        item.model_copy(update={"episodes": sum(uses_period(d, item.id) for d in directors)})
        for item in summary.periods
    ]
    characters = [
        item.model_copy(update={"sheets_ready": _ready_sheets(paths, channel, item.id)})
        for item in summary.characters
    ]
    return summary.model_copy(update={"periods": periods, "characters": characters})
