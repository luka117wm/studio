"""Опорные портреты облика и опорные кадры стиля (M5.4; устав M5, решения 1, 5, 6).

- **Заказ джоба** (`sheet_order`, `angle_order`, `style_order`) — что нарисовать: промпт, negative,
  seed и соотношение сторон каждого кандидата. Промпт собирает код из опубликованных версий канона
  и шаблона `prompts/anchor_sheet.md` / `style_anchor.md` (принцип 13). Заказ целиком лежит в
  payload джоба: перезапуск после аварии рисует то же самое и берёт оплаченное из кэша (принцип 8).
- **Набор** — лист облика `canon/anchors/<облик>/` (`candidates/`, `rejected/`) или кадры стиля
  `canon/anchors/style/`. В нём `sheet.json` — все кандидаты с seed, версией, ценой и статусом, и
  `chosen.json` — выбор по ракурсу (у кадров стиля — по шаблону, выбор автоматический).
- **Выбор и отбраковка.** Ничего не удаляется: отбракованный кандидат переезжает в `rejected/`, а
  строка `assets` — вслед за ним, чтобы кэш не потерял оплаченное и не вернул его в кандидаты.
- **Состояние** набора с устареванием: выбор сравнивается с версией канона, к которой он сделан.

Манифест пишут синхронные функции без await внутри: джобы листа (async) и API идут в одном event
loop, чтение и запись манифеста не перемежаются. Контракт — `docs/canon_schema.md`, «Листы опорных
портретов» и «Опорные кадры стиля».
"""

import hashlib
import os
import sqlite3
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.cost.pricing import Money, money
from app.models.canon import Appearance, Character, Period, Style
from app.models.canon_config import BODY_ANGLES, FRONT, AngleConfig, CanonConfig
from app.models.director import EPISODE_ID_PATTERN, StrictModel
from app.pipeline.bridge.prompts import PromptLibrary
from app.providers.base import AspectRatio, ImageRef, ImageRequest
from app.storage import canon_store
from app.storage.atomic import read_json, write_json_atomic
from app.storage.canon_store import (
    CHARACTERS,
    PERIODS,
    STYLE,
    CanonConflict,
    CanonNotFound,
    CanonRefError,
)
from app.storage.db import now_iso
from app.storage.paths import StudioPaths

ANCHORS_STAGE = "anchors"  # этап `config/providers.yaml`: Pro 1K во всех профилях
STYLE_TARGET = "style"
SHEET_TEMPLATE = "anchor_sheet"
STYLE_TEMPLATE = "style_anchor"
SEED_MAX = 2**31 - 1
_ON_SCREEN = " на экране «Канон»"

SheetStatus = Literal["missing", "partial", "ready", "outdated"]
CandidateStatus = Literal["ready", "rejected", "failed"]

# Устаревание листа облика (устав M5, решение 5): смена этих полей — лист целиком; одежды,
# предметов и износа — ракурсы `BODY_ANGLES`. `hair`, `age`, `wear` — решение этапа M5.4.
SHEET_FIELDS: tuple[str, ...] = ("nature.face", "face", "build", "hair", "age")
BODY_FIELDS: tuple[str, ...] = ("clothing", "props", "wear")
# Кадры стиля устаревают при смене рендера, оптики или света (группы слоя «Стиль»).
STYLE_FIELDS: tuple[str, ...] = (
    "render",
    "material",
    "processing",
    "optics.focal",
    "optics.depth",
    "optics.distortion",
    "light.character",
    "light.contrast",
    "light.direction",
)


# --- заказ джоба: payload `anchor_sheet`, `anchor_angle`, `style_anchors` -----------------------


class AnchorItem(StrictModel):
    """Один кандидат заказа. `key` — имя файла кандидата без хэша: `front-1`, `establishing-1`."""

    key: str = Field(pattern=r"^[a-z][a-z0-9_]*-\d+$")
    slot: str  # ракурс листа или шаблон кадра стиля
    label: str  # подпись ракурса для прогресса, по-русски
    n: int = Field(ge=1)
    prompt: str = Field(min_length=1)
    negative: str = ""
    aspect_ratio: AspectRatio
    seed: int = Field(ge=0, le=SEED_MAX)
    with_front: bool = False  # референс — фас этого же облика (устав M5, решение 5)


class AnchorOrder(StrictModel):
    """Заказ джоба: канал, набор, версия канона, кандидаты по порядку (фасы — первыми)."""

    channel: str = Field(pattern=EPISODE_ID_PATTERN)
    target: str  # id облика или `style`
    version: str  # версия персонажа облика или версия стиля
    canon: dict[str, str]  # ссылки на версии канона: в хэш входов (принцип 8) и в манифест
    items: list[AnchorItem] = Field(min_length=1)

    def request(self, item: AnchorItem, refs: Sequence[ImageRef] = ()) -> ImageRequest:
        return ImageRequest(
            prompt=item.prompt,
            negative=item.negative,
            canon=self.canon,
            refs=list(refs),
            seed=item.seed,
            aspect_ratio=item.aspect_ratio,
        )


def seed_of(*parts: str) -> int:
    """Seed — от хэша входов кандидата (облик, версия, ракурс, номер): тот же кандидат — тот же."""
    digest = hashlib.sha256("\n".join(parts).encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") & SEED_MAX


def candidate_id(item: AnchorItem, input_hash: str) -> str:
    """id кандидата = имя его файла без расширения (`Gateway._store`: `<кадр>-<хэш16>`)."""
    return f"{item.key}-{input_hash[:16]}"


# --- канон: опубликованные версии ---------------------------------------------------------------


@dataclass(frozen=True)
class SheetCanon:
    """Из чего собирается лист облика: последние опубликованные версии стиля, эпохи облика и
    персонажа, где облик есть. Черновики в лист не идут."""

    style: Style
    style_version: str
    period: Period
    period_version: str
    character: Character
    appearance: Appearance
    character_version: str

    def refs(self) -> dict[str, str]:
        return {
            "style": f"style/{self.style_version}",
            "period": f"periods/{self.period.id}/{self.period_version}",
            "appearance": _appearance_ref(self.appearance.id, self.character_version),
        }


def _appearance_ref(appearance_id: str, version: str) -> str:
    """Ссылка облика в формате `CanonRef` (`models/director.py`)."""
    character, look = appearance_id.split("@", 1)
    return f"characters/{character}/{version}#{look}"


def latest_style(paths: StudioPaths, channel: str) -> tuple[Style, str]:
    versions = canon_store.list_versions(paths, channel, STYLE)
    if not versions:
        raise CanonConflict(
            f"Стиль канала не опубликован — опубликуйте его{_ON_SCREEN}, потом собирайте опорные."
        )
    tag = versions[-1].version
    return canon_store.read_entry(paths, channel, STYLE, None, tag).data, tag


def latest_period(
    paths: StudioPaths, channel: str, period_id: str, whose: str
) -> tuple[Period, str]:
    versions = canon_store.list_versions(paths, channel, PERIODS, period_id)
    if not versions:
        raise CanonConflict(
            f"Эпоха {period_id} {whose} не опубликована — опубликуйте её{_ON_SCREEN}."
        )
    tag = versions[-1].version
    return canon_store.read_entry(paths, channel, PERIODS, period_id, tag).data, tag


def latest_appearance(
    paths: StudioPaths, channel: str, appearance_id: str
) -> tuple[Character, Appearance, str] | None:
    """Последняя опубликованная версия персонажа, где облик есть."""
    character_id = appearance_id.split("@", 1)[0]
    for info in reversed(canon_store.list_versions(paths, channel, CHARACTERS, character_id)):
        character = canon_store.read_entry(
            paths, channel, CHARACTERS, character_id, info.version
        ).data
        appearance = character.appearance(appearance_id)
        if appearance is not None:
            return character, appearance, info.version
    return None


def appearance_at(
    paths: StudioPaths, channel: str, appearance_id: str, version: str
) -> tuple[Character, Appearance] | None:
    try:
        return canon_store.resolve_appearance(
            paths, channel, _appearance_ref(appearance_id, version)
        )
    except CanonRefError:
        return None


def sheet_canon(paths: StudioPaths, channel: str, appearance_id: str) -> SheetCanon:
    """Канон листа; чего-то не опубликовано — 409 с тем, что опубликовать."""
    style, style_version = latest_style(paths, channel)
    found = latest_appearance(paths, channel, appearance_id)
    if found is None:
        raise CanonConflict(
            f"Облик {appearance_id} не опубликован — опубликуйте персонажа с этим обликом"
            f"{_ON_SCREEN}, потом собирайте лист."
        )
    character, appearance, character_version = found
    period, period_version = latest_period(
        paths, channel, appearance.period, f"облика {appearance_id}"
    )
    return SheetCanon(
        style, style_version, period, period_version, character, appearance, character_version
    )


# --- блоки промпта: стиль, эпоха, облик (порядок секций — в шаблонах) ---------------------------


def _lines(pairs: Iterable[tuple[str, str]]) -> str:
    return "\n".join(f"- {label}: {value.strip()}" for label, value in pairs if value.strip())


def _list(values: Iterable[str]) -> str:
    return ", ".join(value.strip() for value in values if value.strip())


def _palette(style: Style) -> str:
    swatches = _list(f"{swatch.role} {swatch.hex}" for swatch in style.palette.swatches)
    parts = [style.palette.rule.strip(), f"colours {swatches}" if swatches else ""]
    return "; ".join(part for part in parts if part)


def style_block(style: Style, *, full: bool) -> str:
    """Стиль канала. Лист (`full=False`) берёт технику, материал, обработку, палитру и зерно: свет,
    оптика и композиция у эталона внешности свои — нейтральный фон и ровный свет."""
    pairs = [
        ("Technique", style.render),
        ("Material", style.material),
        ("Processing", style.processing),
    ]
    if full:
        optics, light = style.optics, style.light
        pairs += [
            ("Optics", _list((optics.focal, optics.depth, optics.distortion))),
            ("Light", _list((light.character, light.contrast, light.direction))),
        ]
    pairs += [("Palette", _palette(style)), ("Grain", style.grain)]
    if full:
        pairs.append(("Composition", style.composition))
    return _lines(pairs)


def _years(period: Period) -> str:
    if period.years is None:
        return ""
    start, end = period.years.from_, period.years.to
    return str(start) if start == end else f"{start} to {end}"


def period_block(period: Period, *, full: bool) -> str:
    """Эпоха. Лист берёт место, годы, материалы, одежду и предметы; кадры стиля — всё."""
    pairs = [("Place", period.region), ("Years", _years(period))]
    if full:
        pairs += [
            ("Palette shift", _list(period.palette_shift)),
            ("Materials", _list(period.materials)),
            ("Light sources", _list(period.light_sources)),
            ("Architecture", _list(period.architecture)),
        ]
    else:
        pairs.append(("Materials", _list(period.materials)))
    pairs += [("Clothing", _list(period.clothing)), ("Props", _list(period.props))]
    return _lines(pairs)


def appearance_block(character: Character, appearance: Appearance) -> str:
    """Облик: неизменяемое персонажа и облик этой эпохи и возраста."""
    nature = character.nature
    return _lines(
        [
            ("Age", "" if appearance.age is None else str(appearance.age)),
            ("Face", "; ".join(t.strip() for t in (nature.face, appearance.face) if t.strip())),
            ("Build", appearance.build),
            ("Hair", appearance.hair),
            ("Clothing", appearance.clothing),
            ("Wear", appearance.wear),
            ("Props", _list(appearance.props)),
            ("Posture", nature.posture),
            ("Manner", nature.manner),
            ("Personality", nature.personality),
        ]
    )


def negative(*lists: Iterable[str]) -> str:
    """`negative_global ∪ forbidden ∪ negative_local` — без повторов, порядок стабильный."""
    seen: dict[str, str] = {}
    for values in lists:
        for value in values:
            text = value.strip()
            if text and text.lower() not in seen:
                seen[text.lower()] = text
    return ", ".join(seen.values())


# --- заказы -------------------------------------------------------------------------------------


def _angle(config: CanonConfig, angle_id: str) -> AngleConfig:
    angle = config.anchors.angle(angle_id)
    if angle is None:
        known = ", ".join(a.id for a in config.anchors.angles)
        raise CanonNotFound(f"Ракурса «{angle_id}» в листе нет — есть: {known}.")
    return angle


def _sheet_item(
    canon: SheetCanon, angle: AngleConfig, n: int, prompts: PromptLibrary
) -> AnchorItem:
    text = prompts.render(
        SHEET_TEMPLATE,
        {
            "style_block": style_block(canon.style, full=False),
            "period_block": period_block(canon.period, full=False),
            "appearance_block": appearance_block(canon.character, canon.appearance),
            "angle": angle.prompt,
        },
    ).text
    return AnchorItem(
        key=f"{angle.id}-{n}",
        slot=angle.id,
        label=angle.label,
        n=n,
        prompt=text,
        negative=negative(
            canon.style.negative_global, canon.period.forbidden, canon.appearance.negative_local
        ),
        aspect_ratio=angle.aspect_ratio,
        seed=seed_of(canon.appearance.id, canon.character_version, angle.id, str(n)),
        with_front=angle.id != FRONT,
    )


def sheet_order(
    paths: StudioPaths,
    channel: str,
    appearance_id: str,
    config: CanonConfig,
    prompts: PromptLibrary,
) -> AnchorOrder:
    """«Собрать лист»: кандидаты 1…k каждого ракурса, сначала фасы. Номера постоянны: повторная
    сборка без изменений — те же seed и промпты, оплаченное берётся из кэша."""
    canon = sheet_canon(paths, channel, appearance_id)
    numbers = range(1, config.anchors.candidates + 1)
    return AnchorOrder(
        channel=channel,
        target=appearance_id,
        version=canon.character_version,
        canon=canon.refs(),
        items=[
            _sheet_item(canon, angle, n, prompts)
            for angle in config.anchors.angles
            for n in numbers
        ],
    )


def angle_order(
    paths: StudioPaths,
    channel: str,
    appearance_id: str,
    angle_id: str,
    config: CanonConfig,
    prompts: PromptLibrary,
) -> AnchorOrder:
    """«Перегенерировать ракурс»: k новых кандидатов одного ракурса. Номера — следующие за
    последним кандидатом ракурса, их фиксирует заказ: перезапуск джоба не плодит новых."""
    angle = _angle(config, angle_id)
    canon = sheet_canon(paths, channel, appearance_id)
    if (
        angle.id != FRONT
        and front_reference(paths, channel, appearance_id, canon.character_version) is None
    ):
        raise CanonConflict(
            f"Для ракурса «{angle.label}» нужен фас облика {appearance_id}"
            f" ({canon.character_version}) — соберите лист или перегенерируйте фас."
        )
    manifest = read_manifest(appearance_set(paths, channel, appearance_id))
    start = max((r.n for r in manifest.candidates if r.slot == angle.id), default=0) + 1
    return AnchorOrder(
        channel=channel,
        target=appearance_id,
        version=canon.character_version,
        canon=canon.refs(),
        items=[
            _sheet_item(canon, angle, n, prompts)
            for n in range(start, start + config.anchors.candidates)
        ],
    )


def style_order(
    paths: StudioPaths, channel: str, period_id: str, config: CanonConfig, prompts: PromptLibrary
) -> AnchorOrder:
    """«Пересобрать кадры стиля»: по кандидату на шаблон в эпохе `period_id`."""
    style, style_version = latest_style(paths, channel)
    period, period_version = latest_period(paths, channel, period_id, "для кадров стиля")
    frames = config.style_frames
    items = [
        AnchorItem(
            key=f"{frame.id}-1",
            slot=frame.id,
            label=frame.label,
            n=1,
            prompt=prompts.render(
                STYLE_TEMPLATE,
                {
                    "style_block": style_block(style, full=True),
                    "period_block": period_block(period, full=True),
                    "frame": frame.prompt,
                },
            ).text,
            negative=negative(style.negative_global, period.forbidden),
            aspect_ratio=frames.aspect_ratio,
            seed=seed_of(STYLE_TARGET, style_version, period_id, period_version, frame.id),
        )
        for frame in frames.frames
    ]
    return AnchorOrder(
        channel=channel,
        target=STYLE_TARGET,
        version=style_version,
        canon={
            "style": f"style/{style_version}",
            "period": f"periods/{period_id}/{period_version}",
        },
        items=items,
    )


# --- набор: файлы, манифест, выбор --------------------------------------------------------------


@dataclass(frozen=True)
class SetDir:
    """Каталог набора и куда ложатся файлы кандидатов (`CallContext.asset_dir`)."""

    target: str
    root: Path
    files: Path
    rejected: Path

    @property
    def manifest_path(self) -> Path:
        return StudioPaths.anchor_manifest_path(self.root)

    @property
    def chosen_path(self) -> Path:
        return StudioPaths.anchor_set_chosen_path(self.root)


def appearance_set(paths: StudioPaths, channel: str, appearance_id: str) -> SetDir:
    return SetDir(
        target=appearance_id,
        root=paths.anchor_dir(channel, appearance_id),
        files=paths.anchor_candidates_dir(channel, appearance_id),
        rejected=paths.anchor_rejected_dir(channel, appearance_id),
    )


def style_set(paths: StudioPaths, channel: str) -> SetDir:
    root = paths.style_anchors_dir(channel)
    return SetDir(target=STYLE_TARGET, root=root, files=root, rejected=root / "rejected")


def set_of(paths: StudioPaths, channel: str, target: str) -> SetDir:
    if target == STYLE_TARGET:
        return style_set(paths, channel)
    return appearance_set(paths, channel, target)


class CandidateRecord(StrictModel):
    """Кандидат в `sheet.json`. `file` — от каталога набора; у неудавшегося — null."""

    id: str
    slot: str
    n: int
    status: CandidateStatus
    file: str | None = None
    error: str | None = None
    seed: int
    version: str
    canon: dict[str, str]
    ref: str | None = None  # id фаса-референса
    usd_micro: int = 0  # цена первого, оплаченного вызова; из кэша — 0
    cached: bool = False
    job_id: str | None = None
    created_at: str


class Manifest(StrictModel):
    target: str
    candidates: list[CandidateRecord] = []


class ChosenRecord(StrictModel):
    """Выбор ракурса (у кадров стиля — шаблона): файл, seed, версия облика или стиля, дата, цена."""

    candidate: str
    file: str
    seed: int
    version: str
    canon: dict[str, str] = {}
    chosen_at: str
    usd_micro: int


class Chosen(StrictModel):
    target: str
    slots: dict[str, ChosenRecord] = {}


def read_manifest(s: SetDir) -> Manifest:
    if not s.manifest_path.exists():
        return Manifest(target=s.target)
    return Manifest.model_validate(read_json(s.manifest_path))


def read_chosen(s: SetDir) -> Chosen:
    if not s.chosen_path.exists():
        return Chosen(target=s.target)
    return Chosen.model_validate(read_json(s.chosen_path))


def _write(path: Path, model: BaseModel) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json_atomic(path, model.model_dump(mode="json"))


def record_candidate(s: SetDir, record: CandidateRecord, *, auto_choose: bool = False) -> None:
    """Кандидат в манифест. Удавшаяся или отбракованная запись с тем же id (те же входы) остаётся
    как была: повтор из кэша её не трогает, отбракованный не возвращается. Запись о сбое того же
    кандидата (ракурс, номер, версия) заменяет новая попытка. `auto_choose` — выбор кадра стиля:
    и для записи, которая уже была, — иначе пересборка в прежней эпохе вернула бы файл из кэша, а
    выбор остался бы на другой эпохе (найдено в M5.5)."""
    manifest = read_manifest(s)
    kept = next(
        (r for r in manifest.candidates if r.id == record.id and r.status != "failed"), None
    )
    if kept is None:
        manifest.candidates = [
            r
            for r in manifest.candidates
            if not (
                r.status == "failed"
                and (r.slot, r.n, r.version) == (record.slot, record.n, record.version)
            )
        ]
        manifest.candidates.append(record)
        _write(s.manifest_path, manifest)
        kept = record
    if auto_choose and kept.status == "ready" and kept.file is not None:
        chosen = read_chosen(s)
        pick = chosen.slots.get(kept.slot)
        if pick is None or pick.candidate != kept.id:
            chosen.slots[kept.slot] = _chosen_from(kept)
            _write(s.chosen_path, chosen)


def _chosen_from(record: CandidateRecord) -> ChosenRecord:
    assert record.file is not None
    return ChosenRecord(
        candidate=record.id,
        file=record.file,
        seed=record.seed,
        version=record.version,
        canon=record.canon,
        chosen_at=now_iso(),
        usd_micro=record.usd_micro,
    )


def front_reference(
    paths: StudioPaths, channel: str, appearance_id: str, version: str
) -> CandidateRecord | None:
    """Фас-референс для остальных ракурсов версии `version`: выбранный фас этой версии, а без него
    — первый удавшийся по времени (порядок манифеста). Не по номеру: дорисованный позже фас-1 не
    должен сменить референс и перерисовать платно уже готовые ракурсы. Только фас этого же облика
    (устав M5, решение 5)."""
    s = appearance_set(paths, channel, appearance_id)
    ready = [
        r
        for r in read_manifest(s).candidates
        if r.slot == FRONT
        and r.status == "ready"
        and r.version == version
        and r.file is not None
        and (s.root / r.file).is_file()
    ]
    pick = read_chosen(s).slots.get(FRONT)
    if pick is not None:
        for record in ready:
            if record.id == pick.candidate:
                return record
    return ready[0] if ready else None


def _candidate(
    s: SetDir, config: CanonConfig, angle_id: str, candidate: str
) -> tuple[AngleConfig, CandidateRecord, Manifest]:
    angle = _angle(config, angle_id)
    manifest = read_manifest(s)
    for record in manifest.candidates:
        if record.id == candidate and record.slot == angle.id:
            return angle, record, manifest
    raise CanonNotFound(
        f"У ракурса «{angle.label}» облика {s.target} нет кандидата {candidate} — обновите лист."
    )


def choose(
    paths: StudioPaths,
    channel: str,
    appearance_id: str,
    angle_id: str,
    candidate: str,
    config: CanonConfig,
) -> None:
    """Выбор кандидата ракурса → `chosen.json`: файл, seed, версия облика, дата, цена."""
    s = appearance_set(paths, channel, appearance_id)
    angle, record, _ = _candidate(s, config, angle_id, candidate)
    if record.status == "rejected":
        raise CanonConflict(f"Кандидат {candidate} отбракован — выберите другого.")
    if record.status == "failed" or record.file is None:
        raise CanonConflict(
            f"Кандидат {candidate} не получился — перегенерируйте ракурс «{angle.label}»."
        )
    if not (s.root / record.file).is_file():
        raise CanonNotFound(f"Файла кандидата {candidate} нет на диске — перегенерируйте ракурс.")
    chosen = read_chosen(s)
    chosen.slots[angle.id] = _chosen_from(record)
    _write(s.chosen_path, chosen)


def reject(
    paths: StudioPaths,
    conn: sqlite3.Connection,
    channel: str,
    appearance_id: str,
    angle_id: str,
    candidate: str,
    config: CanonConfig,
) -> None:
    """Отбраковка: файл → `rejected/`, строка `assets` — за ним (кэш помнит оплаченное и не вернёт
    его в кандидаты), запись манифеста — `rejected`. Ничего не удаляется."""
    s = appearance_set(paths, channel, appearance_id)
    angle, record, manifest = _candidate(s, config, angle_id, candidate)
    if record.status == "rejected":
        raise CanonConflict(f"Кандидат {candidate} уже отбракован.")
    if record.status == "failed" or record.file is None:
        raise CanonConflict(f"Кандидат {candidate} не получился — отбраковывать нечего.")
    pick = read_chosen(s).slots.get(angle.id)
    if pick is not None and pick.candidate == candidate:
        raise CanonConflict(
            f"Кандидат {candidate} выбран для ракурса «{angle.label}» — выберите другого, потом "
            "отбракуйте этого."
        )
    source = s.root / record.file
    target = s.rejected / source.name
    target.parent.mkdir(parents=True, exist_ok=True)
    os.replace(source, target)
    with conn:
        conn.execute(
            "UPDATE assets SET path = ? WHERE path = ?",
            (
                target.relative_to(paths.root).as_posix(),
                source.relative_to(paths.root).as_posix(),
            ),
        )
    index = manifest.candidates.index(record)
    manifest.candidates[index] = record.model_copy(
        update={"status": "rejected", "file": target.relative_to(s.root).as_posix()}
    )
    _write(s.manifest_path, manifest)


# --- состояние набора ---------------------------------------------------------------------------


class AnchorCandidate(BaseModel):
    id: str
    n: int
    status: CandidateStatus
    file: str | None  # путь от `data/`; у неудавшегося — null
    error: str | None
    seed: int
    version: str  # версия персонажа облика или стиля, с которой сделан кандидат
    ref: str | None  # фас-референс
    usd: Money
    cached: bool
    created_at: str


class ChosenAnchor(BaseModel):
    candidate: str
    file: str  # путь от `data/`
    seed: int
    version: str
    chosen_at: str
    usd: Money


class AnchorSlot(BaseModel):
    """Ракурс листа или шаблон кадра стиля."""

    slot: str
    label: str
    hint: str
    candidates: list[AnchorCandidate]
    chosen: ChosenAnchor | None
    stale: str | None  # почему выбор устарел; null — не устарел


class AnchorSetState(BaseModel):
    """Лист облика (`GET …/appearances/{id}/anchors`) или кадры стиля (`GET …/style/anchors`)."""

    channel: str
    target: str  # id облика или `style`
    # С чем сравнивается выбор: последняя опубликованная версия персонажа с обликом или стиля.
    version: str | None
    status: SheetStatus
    chosen: int
    total: int
    stale: str | None  # сводка устаревания для экрана
    slots: list[AnchorSlot]
    spent: Money  # оплачено за все кандидаты набора


@dataclass(frozen=True)
class _Stale:
    """Что поменялось между версией выбора и текущей: поля листа целиком и поля одежды."""

    whole: tuple[str, ...] = ()
    body: tuple[str, ...] = ()
    missing: bool = False  # версии выбора нет в каноне

    @property
    def any(self) -> bool:
        return bool(self.whole or self.body or self.missing)


def _value(obj: Any, name: str) -> Any:
    for part in name.split("."):
        obj = getattr(obj, part)
    return obj


def _changed(
    old: Callable[[str], Any], new: Callable[[str], Any], names: Sequence[str]
) -> tuple[str, ...]:
    return tuple(name for name in names if old(name) != new(name))


def _appearance_value(character: Character, appearance: Appearance) -> Callable[[str], Any]:
    def value(name: str) -> Any:
        if name.startswith("nature."):
            return _value(character, name)
        return _value(appearance, name)

    return value


@dataclass
class _Picks:
    s: SetDir
    manifest: Manifest
    picks: dict[str, ChosenRecord]
    stale: dict[str, _Stale] = field(default_factory=dict)


def _sheet_picks(
    paths: StudioPaths, channel: str, appearance_id: str, version: str | None
) -> _Picks:
    """Выбор листа с устареванием против версии персонажа `version` (None — сравнить не с чем)."""
    s = appearance_set(paths, channel, appearance_id)
    picks = {
        slot: pick
        for slot, pick in read_chosen(s).slots.items()
        if (s.root / pick.file).is_file()  # файл пропал — выбора нет
    }
    result = _Picks(s, read_manifest(s), picks)
    target = appearance_at(paths, channel, appearance_id, version) if version else None
    if target is None:
        return result
    new = _appearance_value(*target)
    for slot, pick in picks.items():
        if pick.version == version:
            continue
        old = appearance_at(paths, channel, appearance_id, pick.version)
        if old is None:
            result.stale[slot] = _Stale(missing=True)
            continue
        before = _appearance_value(*old)
        body = _changed(before, new, BODY_FIELDS) if slot in BODY_ANGLES else ()
        stale = _Stale(whole=_changed(before, new, SHEET_FIELDS), body=body)
        if stale.any:
            result.stale[slot] = stale
    return result


def _status(chosen: int, total: int, stale: bool) -> SheetStatus:
    if chosen == 0:
        return "missing"
    if stale:
        return "outdated"
    return "partial" if chosen < total else "ready"


def sheet_status(
    paths: StudioPaths, channel: str, appearance_id: str, version: str, total: int
) -> tuple[SheetStatus, int]:
    """Лист облика против версии персонажа `version` — для канона выпуска (M5.2): статус и
    сколько ракурсов выбрано."""
    picks = _sheet_picks(paths, channel, appearance_id, version)
    return _status(len(picks.picks), total, bool(picks.stale)), len(picks.picks)


def _stale_text(stale: _Stale, version: str | None) -> str:
    if stale.missing:
        return "версии выбора нет в каноне — пересоберите"
    return f"в {version} изменились {', '.join((*stale.whole, *stale.body))}"


def _slots(
    paths: StudioPaths,
    picks: _Picks,
    labels: Sequence[tuple[str, str, str]],
    version: str | None,
) -> list[AnchorSlot]:
    s = picks.s
    out: list[AnchorSlot] = []
    for slot, label, hint in labels:
        pick = picks.picks.get(slot)
        stale = picks.stale.get(slot)
        out.append(
            AnchorSlot(
                slot=slot,
                label=label,
                hint=hint,
                candidates=[
                    AnchorCandidate(
                        id=r.id,
                        n=r.n,
                        status=r.status,
                        file=_data_path(paths, s, r.file),
                        error=r.error,
                        seed=r.seed,
                        version=r.version,
                        ref=r.ref,
                        usd=money(r.usd_micro),
                        cached=r.cached,
                        created_at=r.created_at,
                    )
                    for r in picks.manifest.candidates
                    if r.slot == slot
                ],
                chosen=None
                if pick is None
                else ChosenAnchor(
                    candidate=pick.candidate,
                    file=_data_path(paths, s, pick.file) or pick.file,
                    seed=pick.seed,
                    version=pick.version,
                    chosen_at=pick.chosen_at,
                    usd=money(pick.usd_micro),
                ),
                stale=None if stale is None else _stale_text(stale, version),
            )
        )
    return out


def _data_path(paths: StudioPaths, s: SetDir, file: str | None) -> str | None:
    return None if file is None else (s.root / file).relative_to(paths.root).as_posix()


def appearance_anchors(
    paths: StudioPaths, channel: str, appearance_id: str, config: CanonConfig
) -> AnchorSetState:
    """Лист облика против последней опубликованной версии персонажа с этим обликом."""
    latest = latest_appearance(paths, channel, appearance_id)
    version = latest[2] if latest else None
    picks = _sheet_picks(paths, channel, appearance_id, version)
    angles = config.anchors.angles
    total = len(angles)
    summary: str | None = None
    if picks.stale:
        label: dict[str, str] = {angle.id: angle.label for angle in angles}
        whole = [name for st in picks.stale.values() for name in st.whole]
        if whole:
            fields = ", ".join(dict.fromkeys(whole))
            summary = f"Лист устарел: в {version} изменились {fields} — пересоберите лист."
        elif any(st.missing for st in picks.stale.values()):
            summary = (
                "Лист устарел: версии, с которой сделан выбор, нет в каноне — пересоберите лист."
            )
        else:
            body = ", ".join(dict.fromkeys(n for st in picks.stale.values() for n in st.body))
            slots = ", ".join(f"«{label[slot]}»" for slot in picks.stale)
            summary = (
                f"Устарели ракурсы {slots}: в {version} изменились {body} — перегенерируйте их."
            )
    return AnchorSetState(
        channel=channel,
        target=appearance_id,
        version=version,
        status=_status(len(picks.picks), total, bool(picks.stale)),
        chosen=len(picks.picks),
        total=total,
        stale=summary,
        slots=_slots(paths, picks, [(a.id, a.label, a.hint) for a in angles], version),
        spent=money(sum(r.usd_micro for r in picks.manifest.candidates)),
    )


def style_anchors(paths: StudioPaths, channel: str, config: CanonConfig) -> AnchorSetState:
    """Кадры стиля против последней версии стиля: устаревают при смене рендера, оптики, света."""
    s = style_set(paths, channel)
    versions = canon_store.list_versions(paths, channel, STYLE)
    version = versions[-1].version if versions else None
    picks = _Picks(
        s,
        read_manifest(s),
        {
            slot: pick
            for slot, pick in read_chosen(s).slots.items()
            if (s.root / pick.file).is_file()
        },
    )
    if version is not None:
        current = canon_store.read_entry(paths, channel, STYLE, None, version).data
        for slot, pick in picks.picks.items():
            if pick.version == version:
                continue
            try:
                old = canon_store.read_entry(paths, channel, STYLE, None, pick.version).data
            except CanonNotFound:
                picks.stale[slot] = _Stale(missing=True)
                continue
            changed = _changed(partial(_value, old), partial(_value, current), STYLE_FIELDS)
            if changed:
                picks.stale[slot] = _Stale(whole=changed)
    frames = config.style_frames.frames
    total = len(frames)
    summary: str | None = None
    if picks.stale:
        fields = ", ".join(dict.fromkeys(n for st in picks.stale.values() for n in st.whole))
        summary = (
            f"Кадры стиля устарели: в {version} изменились {fields} — пересоберите их."
            if fields
            else "Кадры стиля устарели: их версии нет в каноне — пересоберите их."
        )
    return AnchorSetState(
        channel=channel,
        target=STYLE_TARGET,
        version=version,
        status=_status(len(picks.picks), total, bool(picks.stale)),
        chosen=len(picks.picks),
        total=total,
        stale=summary,
        slots=_slots(paths, picks, [(f.id, f.label, "") for f in frames], version),
        spent=money(sum(r.usd_micro for r in picks.manifest.candidates)),
    )
