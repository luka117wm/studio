"""Сборщик запроса картинки кадра выпуска (принцип 13; устав M5, решение 7).

Итоговый запрос — промпт, negative, референсы, seed — собирает код из канона выпуска (версии —
`canon_ref` плана) и действия кадра действующего плана (с правкой человека). LLM описывает только
действие; как это выглядит, задаёт канон. Порядок секций и разделители зафиксированы здесь и в
`docs/prompt_assembly.md`: менять — только с записью там и в `docs/LESSONS.md`.

Порядок: `style` → `period` → `appearance` (каждый облик кадра по порядку `shot.image.appearances`)
→ `action` → `shot_size`, секции разделены пустой строкой. Тексты стиля, эпохи и облика собирают те
же функции, что у листа опорных портретов (`pipeline/canon/anchors.py`): лист и кадр описывают канон
одинаково.

Сборка детерминирована: те же входы — побайтово тот же промпт и тот же хэш входов шлюза (ключ кэша
кадра в M6). Вариант 1 — запрос предпросмотра; вариант N ≥ 2 (перерисовка, M6.2) меняет только
seed. Модель — ключ каталога `images` или маршрут профиля по умолчанию: от неё зависят хэш, лимит
референсов и цена.

Что мешает рисовать, — `problems` по-русски с id кадра, а не исключение: предпросмотр показывает
их списком. У проблемы канона — адресат `canon` (сущность и вид, как у отказа «Утвердить план»):
по нему экран ведёт на экран 12, не разбирая текст.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.cost.pricing import Money, format_unit_usd
from app.models.canon import Appearance, Character, Period, Style
from app.models.canon_config import CanonConfig
from app.models.director import CanonRef, Shot
from app.models.validators import find_style_tokens
from app.pipeline.canon import anchors
from app.pipeline.canon.episode_canon import (
    SHEET_ANGLES,
    CanonIssue,
    CanonKind,
    CanonTarget,
    ref_tag,
)
from app.pipeline.director_import.effective import PlanShot
from app.providers.base import AspectRatio, Cost, ImageRef, ImageRequest, Route
from app.providers.gateway import Gateway, input_hash
from app.storage import canon_store
from app.storage.canon_store import CHARACTERS, PERIODS, STYLE, CanonNotFound, CanonRefError
from app.storage.paths import StudioPaths

IMAGES_STAGE = "images"  # этап кадров в `config/providers.yaml`
SECTION_SEPARATOR = "\n\n"
_ON_SCREEN = " на экране «Канон»"

SectionKind = Literal["style", "period", "appearance", "action", "shot_size"]
RefKind = Literal["anchor", "style_frame"]


class PromptSection(BaseModel):
    """Секция промпта и откуда она: версия канона (`style/v003`, `periods/…/v002`,
    `characters/…/v004#…`) или сам кадр (`shot`)."""

    kind: SectionKind
    source: str
    label: str  # подпись для экрана, по-русски
    text: str  # как в промпте, с шапкой


class PromptRef(BaseModel):
    """Референс кадра: выбранный ракурс листа облика или опорный кадр стиля."""

    kind: RefKind
    owner: str  # id облика или `style`
    slot: str  # ракурс или шаблон кадра стиля
    label: str  # «you@powder-monkey-11 — фас», «Кадр стиля — общий план»
    file: str  # путь от `data/`
    sha256: str


class DroppedRef(PromptRef):
    """Референс, который не поместился в лимит модели."""

    reason: str


def _is_none(value: object) -> bool:
    return value is None


class PromptProblem(BaseModel):
    """Что мешает рисовать кадр: текст с id кадра и, у проблемы канона, — её адресат."""

    message: str
    canon: CanonTarget | None = Field(default=None, exclude_if=_is_none)


class ShotPrompt(BaseModel):
    """Запрос картинки кадра до траты денег: `GET /api/projects/{id}/shots/{shot_id}/prompt`."""

    shot_id: str
    sections: list[PromptSection]
    text: str  # итоговый промпт: секции через пустую строку
    negative: str
    refs: list[PromptRef]
    dropped: list[DroppedRef]
    seed: int
    aspect_ratio: AspectRatio
    model: str  # ID модели маршрута `images`: выбранной или профиля по умолчанию
    cost: Cost
    usd: Money  # цена одного кадра, до десятых цента: «$0.067»
    input_hash: str | None  # ключ кэша кадра (M6); null — есть проблемы, рисовать нельзя
    problems: list[PromptProblem]  # что мешает рисовать, с id кадра
    warnings: list[str]  # что не попало в запрос, но рисовать не мешает


@dataclass(frozen=True)
class BuiltShot:
    prompt: ShotPrompt
    request: ImageRequest | None  # None — есть проблемы
    route: Route  # маршрут этапа `images`: выбранная модель или профиль по умолчанию


@dataclass(frozen=True)
class _Person:
    appearance_id: str
    ref: str
    character: Character
    appearance: Appearance


def _dotted(obj: Any, name: str) -> Any:
    for part in name.split("."):
        obj = getattr(obj, part)
    return obj


def _lower_first(text: str) -> str:
    return text[:1].lower() + text[1:]


def _images_note(start: int, count: int, *, style: bool = False) -> str:
    """Какие референсы чьи: номера по порядку итогового списка, с единицы."""
    if count == 0:
        return ""
    what = "style reference image" if style else "reference image"
    if count == 1:
        return f" ({what} {start})"
    return f" ({what}s {start}–{start + count - 1})"


class _Builder:
    def __init__(
        self,
        paths: StudioPaths,
        gateway: Gateway,
        config: CanonConfig,
        channel: str,
        canon_ref: CanonRef,
        shot: Shot,
    ) -> None:
        self.paths = paths
        self.gateway = gateway
        self.config = config
        self.channel = channel
        self.canon_ref = canon_ref
        self.shot = shot
        self.prefix = f"кадр {shot.id}: "
        self.problems: list[PromptProblem] = []
        self.warnings: list[str] = []

    def problem(self, text: str, target: CanonTarget | None = None) -> None:
        self.problems.append(PromptProblem(message=self.prefix + text, canon=target))

    def ref_problem(self, kind: CanonKind, entity_id: str, exc: CanonRefError) -> None:
        """Ссылка не резолвится: у сущности нет ни одной версии — «не опубликована», иначе ссылка
        не находит версию (как `episode_canon._ref_problem`)."""
        layer_id = None if kind == "style" else entity_id.split("@", 1)[0]
        layer = {"style": STYLE, "period": PERIODS, "appearance": CHARACTERS}[kind]
        published = canon_store.list_versions(self.paths, self.channel, layer, layer_id)
        issue: CanonIssue = "unresolved" if published else "unpublished"
        self.problem(str(exc), CanonTarget(kind=kind, id=entity_id, issue=issue))

    # --- канон --------------------------------------------------------------------------------

    def style(self) -> Style | None:
        try:
            return canon_store.resolve_style(self.paths, self.channel, self.canon_ref.style)
        except CanonRefError as exc:
            self.ref_problem("style", "style", exc)
            return None

    def period_ref(self) -> str | None:
        period_id = self.shot.image.period
        ref = self.canon_ref.periods.get(period_id)
        if ref is None:
            self.problem(
                f"эпохи {period_id} нет в canon_ref плана — импортируйте план заново",
                CanonTarget(kind="period", id=period_id, issue="unresolved"),
            )
        return ref

    def period(self, ref: str | None) -> Period | None:
        if ref is None:
            return None
        try:
            return canon_store.resolve_period(self.paths, self.channel, ref)
        except CanonRefError as exc:
            self.ref_problem("period", self.shot.image.period, exc)
            return None

    def people(self) -> list[_Person]:
        people: list[_Person] = []
        for appearance_id in self.shot.image.appearances:
            ref = self.canon_ref.appearances.get(appearance_id)
            if ref is None:
                self.problem(
                    f"облика {appearance_id} нет в canon_ref плана — импортируйте план заново",
                    CanonTarget(kind="appearance", id=appearance_id, issue="unresolved"),
                )
                continue
            try:
                character, appearance = canon_store.resolve_appearance(
                    self.paths, self.channel, ref
                )
            except CanonRefError as exc:
                self.ref_problem("appearance", appearance_id, exc)
                continue
            people.append(_Person(appearance_id, ref, character, appearance))
            self.check_sheet(appearance_id, ref)
        return people

    def check_sheet(self, appearance_id: str, ref: str) -> None:
        """Лист облика против прибитой версии — как в воротах «Утвердить план» (M5.2)."""
        tag = ref_tag(ref)
        if tag is None:
            return
        status, chosen = anchors.sheet_status(
            self.paths, self.channel, appearance_id, tag, SHEET_ANGLES
        )

        def sheet(issue: CanonIssue) -> CanonTarget:
            return CanonTarget(kind="appearance", id=appearance_id, issue=issue)

        if status == "missing":
            self.problem(
                f"у облика {appearance_id} нет листа опорных портретов — соберите его{_ON_SCREEN}",
                sheet("no_sheet"),
            )
        elif status == "partial":
            self.problem(
                f"лист облика {appearance_id} {chosen}/{SHEET_ANGLES} — выберите недостающие"
                f" ракурсы{_ON_SCREEN}",
                sheet("sheet_incomplete"),
            )
        elif status == "outdated":
            self.problem(
                f"лист облика {appearance_id} устарел — пересоберите его{_ON_SCREEN}",
                sheet("sheet_outdated"),
            )

    # --- референсы ----------------------------------------------------------------------------

    def anchor_refs(self, person: _Person) -> list[PromptRef]:
        """Выбранные ракурсы листа по крупности кадра, фас — первым."""
        s = anchors.appearance_set(self.paths, self.channel, person.appearance_id)
        chosen = anchors.read_chosen(s).slots
        refs: list[PromptRef] = []
        for angle_id in self.config.shots.sizes[self.shot.image.shot_size].angles:
            pick = chosen.get(angle_id)
            if pick is None or not (s.root / pick.file).is_file():
                continue
            angle = self.config.anchors.angle(angle_id)
            label = _lower_first(angle.label) if angle else angle_id
            refs.append(
                self._ref(
                    "anchor",
                    person.appearance_id,
                    angle_id,
                    f"{person.appearance_id} — {label}",
                    s.root / pick.file,
                )
            )
        return refs

    def style_frame_refs(self, style: Style | None) -> list[PromptRef]:
        """До двух опорных кадров стиля по крупности. Кадр другой эпохи или устаревший против
        прибитой версии стиля не подаётся — предупреждение, не проблема."""
        frames = self.config.shots.sizes[self.shot.image.shot_size].style_frames
        if style is None or not frames:
            return []
        s = anchors.style_set(self.paths, self.channel)
        chosen = anchors.read_chosen(s).slots
        pinned = ref_tag(self.canon_ref.style)
        period_id = self.shot.image.period
        labels = {frame.id: frame.label for frame in self.config.style_frames.frames}
        refs: list[PromptRef] = []
        for frame_id in frames:
            label = _lower_first(labels.get(frame_id, frame_id))
            pick = chosen.get(frame_id)
            if pick is None or not (s.root / pick.file).is_file():
                self.warnings.append(
                    f"кадра стиля «{label}» нет — соберите кадры стиля{_ON_SCREEN}"
                )
                continue
            frame_period = pick.canon.get("period", "")
            if not frame_period.startswith(f"periods/{period_id}/"):
                self.warnings.append(
                    f"кадр стиля «{label}» сделан в другой эпохе ({frame_period or 'не указана'})"
                    f" — в кадр эпохи {period_id} не подаётся"
                )
                continue
            if pick.version != pinned and self._style_changed(pick.version, style):
                self.warnings.append(
                    f"кадр стиля «{label}» устарел против {self.canon_ref.style} — пересоберите"
                    f" кадры стиля{_ON_SCREEN}"
                )
                continue
            refs.append(
                self._ref(
                    "style_frame",
                    anchors.STYLE_TARGET,
                    frame_id,
                    f"Кадр стиля — {label}",
                    s.root / pick.file,
                )
            )
        return refs

    def _style_changed(self, version: str, pinned: Style) -> bool:
        """Рендер, оптика или свет версии кадра стиля отличаются от прибитой (как у M5.4)."""
        try:
            old = canon_store.read_entry(self.paths, self.channel, STYLE, None, version).data
        except CanonNotFound:
            return True
        return any(_dotted(old, n) != _dotted(pinned, n) for n in anchors.STYLE_FIELDS)

    def _ref(self, kind: RefKind, owner: str, slot: str, label: str, path: Path) -> PromptRef:
        image = self.gateway.image_ref(path)
        return PromptRef(
            kind=kind, owner=owner, slot=slot, label=label, file=image.path, sha256=image.sha256
        )

    def fit(
        self, groups: list[list[PromptRef]], style: list[PromptRef], limit: int, model: str
    ) -> tuple[list[list[PromptRef]], list[PromptRef], list[DroppedRef]]:
        """Лимит референсов модели: сначала уходят кадры стиля, затем ракурсы сверх фаса — с
        последнего облика к первому. Фас не уходит никогда; не помещаются фасы — проблема."""
        groups = [list(group) for group in groups]
        style = list(style)
        dropped: list[DroppedRef] = []

        def total() -> int:
            return sum(len(group) for group in groups) + len(style)

        while total() > limit and style:
            ref = style.pop()
            dropped.append(
                DroppedRef(
                    **ref.model_dump(), reason="лимит референсов модели: кадры стиля уходят первыми"
                )
            )
        for group in reversed(groups):
            while total() > limit and len(group) > 1:
                ref = group.pop()
                dropped.append(
                    DroppedRef(
                        **ref.model_dump(),
                        reason="лимит референсов модели: ракурсы сверх фаса уходят"
                        " с последнего облика",
                    )
                )
        if total() > limit:
            self.problem(
                f"обликов в кадре {len(groups)}, а модель {model} принимает референсов не больше"
                f" {limit} — даже фасы не помещаются, уберите облик из кадра"
            )
        return groups, style, dropped


def build_shot_request(
    paths: StudioPaths,
    gateway: Gateway,
    config: CanonConfig,
    *,
    episode_id: str,
    channel: str,
    canon_ref: CanonRef,
    shot: Shot,
    variant: int = 1,
    model: str | None = None,
) -> BuiltShot:
    """Запрос картинки кадра `shot` действующего плана выпуска `episode_id` по канону `canon_ref`:
    секции с источниками, итоговый `ImageRequest` и хэш входов шлюза по маршруту `images`.

    `variant` — номер варианта (1 — как в предпросмотре), `model` — ключ каталога `images` или ID
    модели из него; не из каталога — `RouteError`."""
    if variant < 1:
        raise ValueError(f"variant must be >= 1, got {variant}")
    b = _Builder(paths, gateway, config, channel, canon_ref, shot)
    route = gateway.resolve(IMAGES_STAGE, override=model)
    style = b.style()
    period_ref = b.period_ref()
    period = b.period(period_ref)
    people = b.people()
    action = shot.image.prompt.strip()
    for token, category in find_style_tokens(action):
        b.problem(
            f"в действии стилевой токен «{token}» ({category}) — стиль задаёт канон, опишите"
            " только действие, композицию и ракурс"
        )

    groups, style_refs, dropped = b.fit(
        [b.anchor_refs(person) for person in people],
        b.style_frame_refs(style),
        route.max_refs or 0,
        route.model,
    )
    refs = [ref for group in groups for ref in group] + style_refs

    sections: list[PromptSection] = []
    if style is not None:
        note = _images_note(len(refs) - len(style_refs) + 1, len(style_refs), style=True)
        sections.append(
            PromptSection(
                kind="style",
                source=canon_ref.style,
                label="Стиль канала",
                text=f"Rendering{note}:\n{anchors.style_block(style, full=True)}",
            )
        )
    if period is not None and period_ref is not None:
        sections.append(
            PromptSection(
                kind="period",
                source=period_ref,
                label=f"Эпоха: {period.label}",
                text=f"Era:\n{anchors.period_block(period, full=True)}",
            )
        )
    start = 1
    for number, (person, group) in enumerate(zip(people, groups, strict=True), start=1):
        note = _images_note(start, len(group))
        start += len(group)
        sections.append(
            PromptSection(
                kind="appearance",
                source=person.ref,
                label=f"Облик: {person.appearance.label}",
                text=f"Person {number}{note}:\n"
                + anchors.appearance_block(person.character, person.appearance),
            )
        )
    edited = isinstance(shot, PlanShot) and "image.prompt" in shot.overridden
    sections.append(
        PromptSection(
            kind="action",
            source="shot",
            label="Действие — правка человека" if edited else "Действие",
            text=f"Action: {action}",
        )
    )
    size = shot.image.shot_size
    sections.append(
        PromptSection(
            kind="shot_size",
            source="shot",
            label=f"Крупность: {size}",
            text=f"Shot size: {config.shots.sizes[size].prompt}",
        )
    )

    text = SECTION_SEPARATOR.join(section.text for section in sections)
    neg = anchors.negative(
        style.negative_global if style else (),
        period.forbidden if period else (),
        *(person.appearance.negative_local for person in people),
    )
    canon = {"style": canon_ref.style}
    if period_ref is not None:
        canon["period"] = period_ref
    canon.update({f"appearance:{p.appearance_id}": p.ref for p in people})
    # Вариант 1 — seed предпросмотра M5.5; следующие отличаются только номером.
    extra = (str(variant),) if variant > 1 else ()
    seed = anchors.seed_of(episode_id, shot.id, *canon.values(), action, *extra)
    aspect = config.shots.aspect_ratio
    cost = gateway.estimate(
        IMAGES_STAGE, ImageRequest(prompt=text, aspect_ratio=aspect), override=route.key
    )

    request: ImageRequest | None = None
    digest: str | None = None
    if not b.problems:
        request = ImageRequest(
            prompt=text,
            negative=neg,
            canon=canon,
            refs=[ImageRef(path=ref.file, sha256=ref.sha256) for ref in refs],
            seed=seed,
            aspect_ratio=aspect,
        )
        digest = input_hash(route, request)
    prompt = ShotPrompt(
        shot_id=shot.id,
        sections=sections,
        text=text,
        negative=neg,
        refs=refs,
        dropped=dropped,
        seed=seed,
        aspect_ratio=aspect,
        model=route.model,
        cost=cost,
        usd=Money(usd_micro=cost.usd_micro, usd=format_unit_usd(cost.usd_micro)),
        input_hash=digest,
        problems=b.problems,
        warnings=b.warnings,
    )
    return BuiltShot(prompt, request, route)
