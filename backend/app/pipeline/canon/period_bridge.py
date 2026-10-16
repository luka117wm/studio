"""Эпоха через мост (M5.6; устав M5, решение 4; `docs/bridge.md`, «Эпоха»).

Чат пишет черновик эпохи по id из планов и заявкам выпусков (режим `draft`) или дополняет её запреты
(`forbidden`). Эпоха — факты времени и места; стиль канала и облики мост не пишет (принцип 13),
стилевой токен в любом поле — отказ. Ответ ложится в черновик, публикует человек.

Здесь чистые функции: контекст промпта, проверка ответа, слияние с черновиком. Журнал обменов и
диск — `api/canon.py`. Мост бесплатен: ни провайдеров, ни `cost_ledger` (устав M4, решение 1).
"""

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from app.models.canon import Period, Years
from app.models.channel import ChannelProfile
from app.models.director import StrictModel
from app.models.validators import find_style_tokens
from app.pipeline.bridge import BridgeAnswerError, BridgeIssue, json_block
from app.pipeline.canon.episode_canon import EpisodePlan
from app.pipeline.script.plan_bridge import errors_word, plural

PROMPT_CANON_PERIOD = "canon_period"
PeriodMode = Literal["draft", "forbidden"]
MODES: tuple[PeriodMode, ...] = ("draft", "forbidden")
FORBIDDEN_MIN = 10  # запретов в черновике из моста — не меньше (устав M5, решение 4)

LIST_FIELDS = (
    "palette_shift",
    "materials",
    "light_sources",
    "architecture",
    "clothing",
    "props",
    "forbidden",
)
DRAFT_FIELDS = ("label", "region", "years", *LIST_FIELDS)
# Подпись — по-русски, только для экрана; всё остальное уходит в промпт картинки.
_SCREEN_ONLY = frozenset({"label"})
_CYRILLIC_RE = re.compile(r"[Ѐ-ӿ]")
_ARTICLE_RE = re.compile(r"^(?:a|an|the)\s+")

HINT_DRAFT = "Попросите чат исправить эти места и прислать эпоху целиком одним блоком ```json."
HINT_FORBIDDEN = (
    'Попросите чат прислать только новые запреты одним блоком ```json вида {"forbidden": [...]}.'
)
_MODE_TITLE: dict[PeriodMode, str] = {"draft": "черновик эпохи", "forbidden": "«Дополнить запреты»"}


# --- контекст промпта ----------------------------------------------------------------------------


class PeriodEpisode(BaseModel):
    """Выпуск, чей текущий план ссылается на эпоху: что о ней знает заявка."""

    id: str
    title: str
    idea: str
    angle: str
    shots: int  # кадров плана в этой эпохе


def period_episodes(period_id: str, plans: Iterable[EpisodePlan]) -> list[PeriodEpisode]:
    """Выпуски, где эпоха есть в `canon_ref` или в кадрах текущей версии плана, по порядку доски."""
    found: list[PeriodEpisode] = []
    for plan in plans:
        director = plan.director
        shots = sum(shot.image.period == period_id for shot in director.shots)
        pinned = director.canon_ref is not None and period_id in director.canon_ref.periods
        if shots or pinned:
            found.append(
                PeriodEpisode(
                    id=plan.episode_id,
                    title=plan.title or director.meta.working_title,
                    idea=director.brief.idea,
                    angle=director.brief.angle,
                    shots=shots,
                )
            )
    return found


def period_data(period: Period | None) -> dict[str, Any] | None:
    return None if period is None else period.model_dump(mode="json", by_alias=True)


def period_context(
    profile: ChannelProfile,
    period_id: str,
    mode: PeriodMode,
    episodes: list[PeriodEpisode],
    current: Period | None,
) -> dict[str, str]:
    """Контекст шаблона `canon_period`: канал, формат, эпоха, режим, выпуски, текущая эпоха.
    Стиля канала нет: эпоха — факты, а не то, как выглядит картинка."""
    return {
        "channel_name": profile.name,
        "format": profile.format,
        "period_id": period_id,
        "mode": mode,
        "forbidden_min": str(FORBIDDEN_MIN),
        "episodes_json": json_block([episode.model_dump() for episode in episodes]),
        "current_json": json_block(period_data(current)),
    }


# --- приём ответа --------------------------------------------------------------------------------


class PeriodProposal(StrictModel):
    """Ответ режима `draft`: эпоха целиком, без `id` — его знает адрес."""

    label: str
    region: str
    years: Years
    palette_shift: list[str]
    materials: list[str]
    light_sources: list[str]
    architecture: list[str]
    clothing: list[str]
    props: list[str]
    forbidden: list[str]


class ForbiddenProposal(StrictModel):
    """Ответ режима `forbidden`: только новые запреты."""

    forbidden: list[str] = Field(min_length=1)


def _path(loc: Iterable[Any]) -> str:
    out = ""
    for part in loc:
        out += f"[{part}]" if isinstance(part, int) else (f".{part}" if out else str(part))
    return out


def _shape_message(error: Mapping[str, Any], mode: PeriodMode) -> str:
    kind = error["type"]
    if kind == "missing":
        return "нет поля"
    if kind == "extra_forbidden":
        return f"лишнее поле — в режиме {_MODE_TITLE[mode]} его не присылают"
    if kind == "string_type":
        return "ожидалась строка"
    if kind == "list_type":
        return "ожидался список строк"
    if kind in {"int_type", "int_parsing", "int_from_float"}:
        return "ожидалось целое число"
    if kind in {"model_type", "model_attributes_type", "dict_type"}:
        return "ожидался объект"
    if kind == "too_short":
        return "список пуст"
    if kind == "canon_years":
        return str(error["msg"])  # свой текст канона (`Years`)
    return f"не годится: {error['msg']}"


def _shape_issues(exc: ValidationError, mode: PeriodMode) -> list[BridgeIssue]:
    issues: list[BridgeIssue] = []
    for error in exc.errors(include_url=False):
        path = _path(error["loc"]) or "ответ"
        issues.append(BridgeIssue(path=path, message=f"{path}: {_shape_message(error, mode)}"))
    return issues


def _texts(data: Mapping[str, Any]) -> Iterable[tuple[str, str, str]]:
    """(путь, поле, текст) каждой строки ответа."""
    for field, value in data.items():
        if isinstance(value, str):
            yield field, field, value
        elif isinstance(value, list):
            for index, item in enumerate(value):
                if isinstance(item, str):
                    yield f"{field}[{index}]", field, item


def _content_issues(data: Mapping[str, Any], mode: PeriodMode) -> list[BridgeIssue]:
    """Пустые позиции, кириллица вне подписи, стилевые токены (принцип 13), число запретов."""
    issues: list[BridgeIssue] = []

    def add(path: str, text: str) -> None:
        issues.append(BridgeIssue(path=path, message=f"{path}: {text}"))

    for path, field, text in _texts(data):
        if not text.strip():
            add(path, "пустая строка — заполните или уберите её")
            continue
        if field in _SCREEN_ONLY:
            continue
        if _CYRILLIC_RE.search(text):
            add(path, "написано по-русски — текст эпохи уходит в промпт картинки, нужен английский")
        for token, category in find_style_tokens(text):
            add(
                path,
                f"стилевой токен «{token}» ({category}) — эпоха описывает факты времени и места,"
                " а как выглядит картинка, задаёт стиль канала",
            )
    forbidden = data.get("forbidden")
    if mode == "draft" and isinstance(forbidden, list) and len(forbidden) < FORBIDDEN_MIN:
        add(
            "forbidden",
            f"запретов {len(forbidden)}, а нужно не меньше {FORBIDDEN_MIN} — попросите чат"
            " дописать анахронизмы",
        )
    return issues


def _reject(issues: list[BridgeIssue], mode: PeriodMode) -> BridgeAnswerError:
    count = len(issues)
    what = "Эпоха" if mode == "draft" else "Запреты"
    word = "не прошла" if mode == "draft" else "не прошли"
    return BridgeAnswerError(
        f"{what} из ответа {word} проверку: {count} {errors_word(count)}.",
        HINT_DRAFT if mode == "draft" else HINT_FORBIDDEN,
        issues,
    )


def parse_draft(data: Mapping[str, Any]) -> PeriodProposal:
    """Ответ режима `draft` → эпоха; все ошибки сразу — `BridgeAnswerError` (422)."""
    try:
        proposal = PeriodProposal.model_validate(data)
    except ValidationError as exc:
        raise _reject(_shape_issues(exc, "draft"), "draft") from None
    issues = _content_issues(proposal.model_dump(mode="json", by_alias=True), "draft")
    if issues:
        raise _reject(issues, "draft")
    return proposal


def parse_forbidden(data: Mapping[str, Any]) -> ForbiddenProposal:
    """Ответ режима `forbidden` → новые запреты; ошибки — как у черновика."""
    try:
        proposal = ForbiddenProposal.model_validate(data)
    except ValidationError as exc:
        raise _reject(_shape_issues(exc, "forbidden"), "forbidden") from None
    issues = _content_issues(proposal.model_dump(), "forbidden")
    if issues:
        raise _reject(issues, "forbidden")
    return proposal


# --- слияние с черновиком ------------------------------------------------------------------------


class PeriodConflict(BaseModel):
    """Поле, заполненное человеком, где чат предложил другое: в черновике остаётся `current`."""

    field: str
    current: Any
    proposed: Any


@dataclass(frozen=True)
class DraftMerge:
    period: Period
    filled: list[str]  # поля, которые были пустыми и заполнены из ответа
    conflicts: list[PeriodConflict]


def _empty(value: Any) -> bool:
    return value is None or value == [] or (isinstance(value, str) and not value.strip())


def merge_draft(base: Period, proposal: PeriodProposal) -> DraftMerge:
    """Пустые поля черновика — из ответа; заполненные человеком не затираются, а несовпадения
    уходят в «чат предложил иначе»."""
    data = base.model_dump(mode="json", by_alias=True)
    proposed = proposal.model_dump(mode="json", by_alias=True)
    filled: list[str] = []
    conflicts: list[PeriodConflict] = []
    for field in DRAFT_FIELDS:
        if _empty(data[field]):
            data[field] = proposed[field]
            filled.append(field)
        elif data[field] != proposed[field]:
            conflicts.append(
                PeriodConflict(field=field, current=data[field], proposed=proposed[field])
            )
    return DraftMerge(Period.model_validate(data), filled, conflicts)


def forbidden_key(text: str) -> str:
    """Ключ повтора запрета: без регистра, ведущего артикля, лишних пробелов и точки в конце."""
    key = " ".join(text.lower().split()).rstrip(".;,!")
    return _ARTICLE_RE.sub("", key)


@dataclass(frozen=True)
class ForbiddenMerge:
    period: Period
    added: list[str]
    repeats: list[str]  # уже были в эпохе или повторялись в самом ответе


def merge_forbidden(base: Period, proposal: ForbiddenProposal) -> ForbiddenMerge:
    """Новые запреты в конец списка, без повторов; порядок прежних не меняется."""
    seen = {forbidden_key(item) for item in base.forbidden}
    added: list[str] = []
    repeats: list[str] = []
    for item in proposal.forbidden:
        key = forbidden_key(item)
        if key in seen:
            repeats.append(item)
            continue
        seen.add(key)
        added.append(item.strip())
    period = base.model_copy(update={"forbidden": [*base.forbidden, *added]})
    return ForbiddenMerge(period, added, repeats)


def draft_message(merge: DraftMerge) -> str:
    filled = len(merge.filled)
    conflicts = len(merge.conflicts)
    text = f"Черновик эпохи: заполнено {filled} {plural(filled, 'поле', 'поля', 'полей')}"
    if conflicts:
        text += f", чат предложил иначе для {conflicts} — сравните на экране «Канон»"
    return text + ". Публикует человек."


def forbidden_message(merge: ForbiddenMerge) -> str:
    return f"Добавлено {len(merge.added)}, повторов {len(merge.repeats)}."
