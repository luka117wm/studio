"""Идеи через мост (M4.8): контекст промпта идей и разбор ответа чата.

Чистые функции без диска и HTTP; журнал обменов и запись в `ideas` — `api/ideas.py`. Ответ чата —
`{"ideas": [...]}`: идея с ошибкой или дубль названия пропускаются с причиной, остальные
принимаются — одна битая идея не роняет ответ. Правила — `docs/research.md`, «Идеи».
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from app.models.channel import ChannelProfile
from app.models.formats import FormatPreset
from app.models.idea import IdeaProposal
from app.pipeline.bridge import BridgeAnswerError, json_block

PROMPT_IDEAS = "ideas"
DEFAULT_COUNT = 6
MAX_COUNT = 20

HINT_IDEAS = 'Попросите чат прислать идеи целиком одним блоком ```json вида {"ideas": [...]}.'


def title_key(title: str) -> str:
    """Название для сравнения: без регистра и лишних пробелов."""
    return " ".join(title.casefold().split())


def ideas_context(
    profile: ChannelProfile, preset: FormatPreset, avoid: list[str], count: int
) -> dict[str, str]:
    """Контекст шаблона `ideas`: канал и формат, пресет, семена, что не повторять, сколько идей."""
    preset_view = {
        "minutes": preset.minutes.model_dump(),
        "sections": preset.sections,
        "words_per_minute": preset.words_per_minute,
    }
    return {
        "channel_name": profile.name,
        "format": profile.format,
        "preset_json": json_block(preset_view),
        "seeds_json": json_block(profile.seeds),
        "avoid_json": json_block(avoid),
        "count": str(count),
    }


def avoid_titles(*groups: list[str]) -> list[str]:
    """Названия «не повторять» по порядку групп, без повторов без учёта регистра."""
    seen: set[str] = set()
    titles: list[str] = []
    for title in (t for group in groups for t in group):
        key = title_key(title)
        if key and key not in seen:
            seen.add(key)
            titles.append(title)
    return titles


@dataclass(frozen=True)
class Skipped:
    """Пропущенная идея ответа: номер с 1, название, если разобралось, и почему."""

    index: int
    title: str | None
    reason: str


@dataclass(frozen=True)
class Review:
    accepted: list[IdeaProposal]
    skipped: list[Skipped]


def review_proposals(data: Mapping[str, Any], taken: Mapping[str, str]) -> Review:
    """Идеи ответа: проверка каждой и дубли. `taken` — ключ названия (`title_key`) → чем оно уже
    занято («уже в бэклоге», «уже есть выпуск с таким названием»). Списка идей нет —
    `BridgeAnswerError` (422): тут нечего принимать."""
    raw = data.get("ideas")
    if not isinstance(raw, list) or not raw:
        raise BridgeAnswerError('В ответе нет списка идей: ожидался {"ideas": [...]}.', HINT_IDEAS)
    seen = dict(taken)
    accepted: list[IdeaProposal] = []
    skipped: list[Skipped] = []
    for index, item in enumerate(raw, start=1):
        if not isinstance(item, Mapping):
            skipped.append(Skipped(index, None, "ожидался объект идеи {…}"))
            continue
        try:
            proposal = IdeaProposal.model_validate(item)
        except ValidationError as exc:
            title = item.get("title")
            skipped.append(Skipped(index, title if isinstance(title, str) else None, describe(exc)))
            continue
        key = title_key(proposal.title)
        if key in seen:
            skipped.append(Skipped(index, proposal.title, f"«{proposal.title}» — {seen[key]}"))
            continue
        seen[key] = f"повторяет идею {index} этого ответа"
        accepted.append(proposal)
    return Review(accepted, skipped)


def describe(exc: ValidationError) -> str:
    """Ошибки одной идеи одной строкой по-русски: нет поля, наши тексты (`PydanticCustomError`)
    как есть — они сами называют поле, остальное — с именем поля."""
    parts: list[str] = []
    for error in exc.errors(include_url=False):
        field = ".".join(str(p) for p in error["loc"]) or "идея"
        if error["type"] == "missing":
            parts.append(f"нет поля «{field}»")
        elif error["type"] in {"title_empty", "title_too_long", "score_invalid"}:
            parts.append(str(error["msg"]))
        else:
            parts.append(f"«{field}»: {error['msg']}")
    return "; ".join(parts)
