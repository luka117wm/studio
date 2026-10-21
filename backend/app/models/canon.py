"""Канон канала — визуальная константа уровня канала (`docs/canon_schema.md`).

Три слоя, каждый версионируется отдельно (принцип 14): стиль канала, эпохи, персонажи с
обликами. Одна модель на слой служит и черновику, и версии: у полей пустые значения по
умолчанию, поэтому скелет из одного id — годный черновик. Форму (id, цвета, годы, облики)
проверяет модель — 422; правила публикации (`publish_problems`) проверяются только при
«Опубликовать» — 409.

Текст полей, кроме подписей `label`, — английский: он уходит в промпт картинки (принцип 13).
"""

import re
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator
from pydantic_core import PydanticCustomError

from app.models.director import EPISODE_ID_PATTERN, StrictModel

# id эпохи и персонажа становятся именами каталогов — правило то же, что у выпуска.
CANON_ID_PATTERN = EPISODE_ID_PATTERN
# Облик — `<персонаж>@<облик>`: `you@powder-monkey-11`. Тоже имя каталога (`canon/anchors/`).
APPEARANCE_ID_PATTERN = r"^[a-z0-9][a-z0-9-]*@[a-z0-9][a-z0-9-]*$"
VERSION_PATTERN = r"^v\d{3}$"
SWATCHES_MIN = 3
SWATCHES_MAX = 5
AGE_MAX = 120

_CANON_ID_RE = re.compile(CANON_ID_PATTERN)
_APPEARANCE_ID_RE = re.compile(APPEARANCE_ID_PATTERN)
_VERSION_RE = re.compile(VERSION_PATTERN)
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_CYRILLIC_RE = re.compile(r"[Ѐ-ӿ]")
# Подписи на экране — по-русски; в промпт картинки они не идут.
_SCREEN_ONLY_FIELDS = frozenset({"label"})


def _check_canon_id(value: str) -> str:
    if not _CANON_ID_RE.fullmatch(value):
        raise PydanticCustomError(
            "canon_id",
            "id «{value}» не годится — только строчные латинские буквы, цифры и дефис, "
            "например caribbean-1716.",
            {"value": value},
        )
    return value


def _check_period_ref(value: str) -> str:
    """Эпоха облика: пустая — в черновике, иначе id эпохи."""
    return value if value == "" else _check_canon_id(value)


def _check_appearance_id(value: str) -> str:
    if not _APPEARANCE_ID_RE.fullmatch(value):
        raise PydanticCustomError(
            "appearance_id",
            "id облика «{value}» не годится — нужен вид <персонаж>@<облик>, например "
            "you@powder-monkey-11.",
            {"value": value},
        )
    return value


def _check_anchor_target(value: str) -> str:
    """Набор опорных: лист облика (`you@powder-monkey-11`) или кадры стиля `style`."""
    return value if value == "style" else _check_appearance_id(value)


def _check_version(value: str) -> str:
    if not _VERSION_RE.fullmatch(value):
        raise PydanticCustomError(
            "canon_version", "Версия «{value}» не годится — нужна вида v001.", {"value": value}
        )
    return value


def _check_hex(value: str) -> str:
    if not _HEX_RE.fullmatch(value):
        raise PydanticCustomError(
            "canon_hex",
            "Цвет «{value}» не годится — нужен код #RRGGBB, например #2b2118.",
            {"value": value},
        )
    return value


def _check_age(value: int | None) -> int | None:
    if value is not None and not 0 <= value <= AGE_MAX:
        raise PydanticCustomError(
            "canon_age",
            "Возраст {value} вне 0–{max} — укажите полных лет.",
            {"value": value, "max": AGE_MAX},
        )
    return value


CanonId = Annotated[str, AfterValidator(_check_canon_id)]
AppearanceId = Annotated[str, AfterValidator(_check_appearance_id)]
AnchorTarget = Annotated[str, AfterValidator(_check_anchor_target)]
VersionTag = Annotated[str, AfterValidator(_check_version)]
HexColor = Annotated[str, AfterValidator(_check_hex)]


def _text_problems(model: BaseModel, owner: str = "") -> list[str]:
    """Кириллица в тексте промпта и пустые позиции списков — по каждому полю `model`.

    `owner` — где поле («облика you@captain-35»), путь — через точку (`light.direction`).
    """
    problems: list[str] = []

    def walk(node: BaseModel, prefix: str) -> None:
        for name, value in node:
            if name in _SCREEN_ONLY_FIELDS:
                continue
            path = f"{prefix}{name}"
            where = f"{path} {owner}".rstrip()
            if isinstance(value, BaseModel):
                walk(value, f"{path}.")
            elif isinstance(value, str) and _CYRILLIC_RE.search(value):
                problems.append(
                    f"Поле {where} написано по-русски — текст канона уходит в промпт "
                    "картинки, пишите по-английски."
                )
            elif isinstance(value, list):
                texts = [item for item in value if isinstance(item, str)]
                if any(not item.strip() for item in texts):
                    problems.append(f"Пустая позиция в списке {where} — заполните или удалите её.")
                if any(_CYRILLIC_RE.search(item) for item in texts):
                    problems.append(
                        f"Список {where} написан по-русски — текст канона уходит в промпт "
                        "картинки, пишите по-английски."
                    )
                for index, item in enumerate(value):
                    if isinstance(item, BaseModel):
                        walk(item, f"{path}[{index}].")

    walk(model, "")
    return problems


class CanonEntity(StrictModel):
    """Слой канона: черновик и версия — одна модель, публикация — `publish_problems`."""

    def publish_problems(self) -> list[str]:
        """Что мешает опубликовать: по фразе на нарушение; пустой список — можно."""
        raise NotImplementedError


# --- стиль канала: canon/style/vNNN.json --------------------------------------------------------


class Optics(StrictModel):
    focal: str = ""
    depth: str = ""
    distortion: str = ""


class Light(StrictModel):
    character: str = ""
    contrast: str = ""
    direction: str = ""


class Swatch(StrictModel):
    role: str = ""
    hex: HexColor


def _check_swatches(value: list[Swatch]) -> list[Swatch]:
    if len(value) > SWATCHES_MAX:
        raise PydanticCustomError(
            "canon_swatches",
            "Образцов палитры {count}, а можно не больше {max} — уберите лишние.",
            {"count": len(value), "max": SWATCHES_MAX},
        )
    return value


class Palette(StrictModel):
    rule: str = ""
    swatches: Annotated[list[Swatch], AfterValidator(_check_swatches)] = []


class Style(CanonEntity):
    """Стиль канала — один на канал, одинаков для всех выпусков (артборд 12, слой «Стиль»)."""

    # Рендер и материал
    render: str = ""
    material: str = ""
    processing: str = ""
    optics: Optics = Optics()
    light: Light = Light()
    palette: Palette = Palette()
    # Зерно и композиция
    grain: str = ""
    composition: str = ""
    negative_global: list[str] = []

    def publish_problems(self) -> list[str]:
        problems: list[str] = []
        if not self.render.strip():
            problems.append(
                "Стиль без рендера не публикуется — опишите технику изображения в поле render."
            )
        count = len(self.palette.swatches)
        if count < SWATCHES_MIN:
            problems.append(
                f"Образцов палитры {count}, а нужно от {SWATCHES_MIN} до {SWATCHES_MAX} — "
                "добавьте цвета."
            )
        for swatch in self.palette.swatches:
            if not swatch.role.strip():
                problems.append(
                    f"У цвета {swatch.hex} нет роли — напишите в role, для чего он, "
                    "например shadows."
                )
        return problems + _text_problems(self)


# --- эпоха: canon/periods/<id>/vNNN.json --------------------------------------------------------


class Years(StrictModel):
    model_config = ConfigDict(extra="forbid", validate_by_name=True, validate_by_alias=True)

    # `from` — ключевое слово Python; в JSON поле называется `from`.
    from_: int = Field(alias="from")
    to: int

    @model_validator(mode="after")
    def _ordered(self) -> "Years":
        if self.from_ > self.to:
            raise PydanticCustomError(
                "canon_years",
                "Годы эпохи наоборот: from {start} позже to {end} — поменяйте их местами.",
                {"start": self.from_, "end": self.to},
            )
        return self


class Period(CanonEntity):
    """Эпоха: факты времени и места, переиспользуются между выпусками. `forbidden` —
    анахронизмы: идут в negative каждого кадра эпохи (L-007)."""

    id: CanonId
    label: str = ""
    region: str = ""
    years: Years | None = None
    palette_shift: list[str] = []
    materials: list[str] = []
    light_sources: list[str] = []
    architecture: list[str] = []
    clothing: list[str] = []
    props: list[str] = []
    forbidden: list[str] = []

    def publish_problems(self) -> list[str]:
        problems: list[str] = []
        if not self.label.strip():
            problems.append(
                "Эпоха без названия не публикуется — заполните label, например «Карибы, 1716»."
            )
        if not self.region.strip():
            problems.append(
                "Эпоха без региона не публикуется — заполните region, например Caribbean Sea."
            )
        if self.years is None:
            problems.append("Эпоха без годов не публикуется — заполните years.from и years.to.")
        if not self.forbidden:
            problems.append("Эпоха без запретов не публикуется — добавьте хотя бы один анахронизм.")
        return problems + _text_problems(self)


# --- персонаж: canon/characters/<id>/vNNN.json, облики — внутри ---------------------------------


class Nature(StrictModel):
    """Неизменяемое персонажа: одинаково во всех обликах."""

    personality: str = ""
    posture: str = ""
    manner: str = ""
    face: str = ""


class Appearance(StrictModel):
    """Облик: персонаж в одной эпохе и одном возрасте. Свой лист опорных портретов."""

    id: AppearanceId
    label: str = ""
    period: Annotated[str, AfterValidator(_check_period_ref)] = ""
    age: Annotated[int | None, AfterValidator(_check_age)] = None
    build: str = ""
    # Уточнение к `nature.face` персонажа: возраст, загар, шрам этого облика.
    face: str = ""
    hair: str = ""
    clothing: str = ""
    wear: str = ""
    props: list[str] = []
    negative_local: list[str] = []


class Character(CanonEntity):
    """Персонаж — один файл версии на всех обликов; ссылка на облик —
    `characters/<персонаж>/vNNN#<облик>`."""

    id: CanonId
    label: str = ""
    nature: Nature = Nature()
    appearances: list[Appearance] = []

    @model_validator(mode="after")
    def _own_appearances(self) -> "Character":
        seen: set[str] = set()
        for appearance in self.appearances:
            if not appearance.id.startswith(f"{self.id}@"):
                raise PydanticCustomError(
                    "canon_appearance_owner",
                    "Облик {appearance} не принадлежит персонажу {character} — id облика "
                    "начинается с «{character}@».",
                    {"appearance": appearance.id, "character": self.id},
                )
            if appearance.id in seen:
                raise PydanticCustomError(
                    "canon_appearance_duplicate",
                    "Облик {appearance} повторяется — у каждого облика свой id.",
                    {"appearance": appearance.id},
                )
            seen.add(appearance.id)
        return self

    def appearance(self, appearance_id: str) -> Appearance | None:
        return next((a for a in self.appearances if a.id == appearance_id), None)

    def publish_problems(self) -> list[str]:
        problems: list[str] = []
        if not self.label.strip():
            problems.append("Персонаж без имени не публикуется — заполните label.")
        if not self.nature.face.strip():
            problems.append(
                "Персонаж без черт лица не публикуется — заполните nature.face: по ним "
                "собирается лист портретов."
            )
        if not self.appearances:
            problems.append("Персонаж без обликов не публикуется — добавьте хотя бы один облик.")
        own = self.model_copy(update={"appearances": []})
        problems += _text_problems(own)
        for appearance in self.appearances:
            if not appearance.label.strip():
                problems.append(
                    f"Облик {appearance.id} без названия не публикуется — заполните label."
                )
            if not appearance.period:
                problems.append(f"Облик {appearance.id} без эпохи не публикуется — укажите period.")
            problems += _text_problems(appearance, f"облика {appearance.id}")
        return problems


# --- API: документ слоя и сводка канона ---------------------------------------------------------


class CanonVersionInfo(StrictModel):
    version: str
    # Версия, из которой начат черновик; null — черновик начат с нуля.
    based_on: str | None
    published_at: str


class CanonDocHead(StrictModel):
    """Что лежит в ответе: черновик (`draft`, `version` — null) или версия `vNNN`."""

    draft: bool
    version: str | None
    based_on: str | None
    # `saved_at` черновика или `published_at` версии.
    updated_at: str


class StyleDoc(CanonDocHead):
    data: Style


class PeriodDoc(CanonDocHead):
    data: Period


class CharacterDoc(CanonDocHead):
    data: Character


class CanonStyleSummary(StrictModel):
    versions: list[CanonVersionInfo]
    draft: bool


class CanonPeriodItem(StrictModel):
    """Подпись, регион, годы и число запретов — из черновика, а без него — из последней версии.
    `episodes` — сколько выпусков ссылаются на эпоху текущими планами (`canon_ref` или кадры);
    считает `episode_canon.canon_overview`, хранилище оставляет 0."""

    id: str
    label: str
    region: str
    years: Years | None
    versions: list[CanonVersionInfo]
    draft: bool
    forbidden_count: int
    episodes: int = 0


class CanonCharacterItem(StrictModel):
    """Подпись и число обликов — из черновика, а без него — из последней версии.
    `sheets_ready` — у скольких из этих обликов лист опорных портретов готов 6/6 и не устарел
    против последней опубликованной версии с обликом, `sheets_outdated` — у скольких лист устарел
    (выбор есть, но лицо или одежда в новой версии другие). Считает `episode_canon.canon_overview`.
    """

    id: str
    label: str
    versions: list[CanonVersionInfo]
    draft: bool
    appearances_count: int
    sheets_ready: int = 0
    sheets_outdated: int = 0


class CanonSummary(StrictModel):
    channel: str
    style: CanonStyleSummary
    periods: list[CanonPeriodItem]
    characters: list[CanonCharacterItem]
