"""План через мост: части, контекст промптов, `canon_ref` и `voice` из кода, приём части.

Чистые функции без диска и HTTP. Журнал обменов, набор частей и импорт — `api/plan.py`; сам
импорт и сборка частей — механизм M2.4 (`api/director.import_plan`). Правила — `docs/bridge.md`,
раздел «План».

Чат пишет в кадрах только id эпох и обликов; `canon_ref` и `voice` строит код (принцип 13): стиль
и версии канона — заготовки `v001`, пока нет модуля канона (устав M4, решение 4).
"""

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from app.models.channel import ChannelProfile
from app.models.director import CanonRef, Director, Section, VoiceCfg
from app.models.formats import FormatPreset
from app.models.project import EpisodeBrief
from app.models.validators import DirectorValidationError, validate_director
from app.pipeline.bridge import BridgeAnswerError, BridgeIssue, json_block
from app.providers.base import Route

PROMPT_FIRST = "plan_first"
PROMPT_NEXT = "plan_next"

# Версия канона, на которую ссылается план до модуля канона: файлы появятся по этим id.
CANON_PLACEHOLDER_VERSION = "v001"
PERIOD_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
APPEARANCE_ID = re.compile(r"^([a-z0-9]+(?:-[a-z0-9]+)*)@([a-z0-9]+(?:-[a-z0-9]+)*)$")
# Блоки частей 2…N, которые сборка M2.4 всё равно берёт из части 1.
FROM_FIRST_PART = ("brief", "thumbnail", "publish")
CLAIM_PREVIEW = 80

HINT_FIX_PART = (
    "Скопируйте ошибки в чат и попросите прислать часть {part} исправленной, целиком одним"
    " блоком ```json."
)


# --- части ---------------------------------------------------------------------------------------


def shot_id(number: int) -> str:
    return f"s{number:03d}"


def shot_number(value: str) -> int:
    return int(value[1:])


@dataclass(frozen=True)
class PartRange:
    part: int
    parts_total: int
    first_shot: str
    last_shot: str


def part_range(
    part: int, parts_total: int, shots_per_part: int, shots_total: int, last_accepted: int
) -> PartRange:
    """Часть начинается за последним принятым кадром и берёт `shots_per_part` кадров; последняя —
    до конца плана по пресету (или чуть дальше, если чат уже вышел за пресет)."""
    first = last_accepted + 1
    if part == parts_total:
        last = max(shots_total, first)
    else:
        last = first + shots_per_part - 1
    return PartRange(part, parts_total, shot_id(first), shot_id(last))


def last_shot_number(parts: Iterable[Director]) -> int:
    numbers = [shot_number(s.id) for d in parts for s in d.shots]
    return max(numbers, default=0)


@dataclass(frozen=True)
class Expected:
    """Какие части сейчас принимаются: `part` — для текста ошибки, `allowed` — все допустимые."""

    part: int
    allowed: frozenset[int]
    # Сколько частей в наборе: у части 1 — по пресету или из открытого обмена, у 2…N — из части 1.
    parts_total: dict[int, int] = field(default_factory=dict)


def expected_part(
    open_run: tuple[int, int] | None, staged: list[Director], preset_total: int
) -> Expected:
    """Открытый обмен (часть, частей) задаёт ожидаемую часть строго: пользователь скопировал её
    промпт. Без него — следующая недостающая, замена уже принятой (после ошибки сборки) или
    часть 1, которая начинает набор заново. Часть угадывается не по содержимому, а по `meta.part`.
    """
    if open_run is not None:
        part, total = open_run
        return Expected(part=part, allowed=frozenset({part}), parts_total={part: total})
    numbers = [d.meta.part for d in staged]
    if 1 not in numbers:
        return Expected(part=1, allowed=frozenset({1}), parts_total={1: preset_total})
    total = staged[0].meta.parts_total
    missing = [n for n in range(1, total + 1) if n not in numbers]
    upto = missing[0] if missing else total
    allowed = {1, *range(2, upto + 1)}
    totals = {n: total for n in allowed} | {1: preset_total}
    return Expected(part=upto, allowed=frozenset(allowed), parts_total=totals)


# --- контекст промптов ---------------------------------------------------------------------------


def _meta(
    profile: ChannelProfile, preset: FormatPreset, episode_id: str, rng: PartRange
) -> dict[str, Any]:
    return {
        "channel": profile.id,
        "episode_id": episode_id,
        "format": profile.format,
        "language": "en",
        "target_minutes": preset.minutes.target,
        "part": rng.part,
        "parts_total": rng.parts_total,
    }


def _brief(brief: EpisodeBrief | None) -> dict[str, Any] | None:
    """Заявка для чата: без внутренних ссылок на идею и референс."""
    if brief is None:
        return None
    return brief.model_dump(
        mode="json", include={"idea", "angle", "hook_promise", "notes", "sources", "reference_mode"}
    )


def first_context(
    profile: ChannelProfile,
    preset: FormatPreset,
    episode_id: str,
    brief: EpisodeBrief | None,
    rng: PartRange,
) -> dict[str, str]:
    preset_view = {
        "minutes": preset.minutes.model_dump(),
        "sections": preset.sections,
        "shots": preset.shots,
        "words_per_minute": preset.words_per_minute,
    }
    return {
        "channel_name": profile.name,
        "format": profile.format,
        "preset_json": json_block(preset_view),
        "brief_json": json_block(_brief(brief)),
        # Структура референса наполнится в M4.10; пока референса нет.
        "reference_json": json_block(None),
        "meta_json": json_block(_meta(profile, preset, episode_id, rng)),
        "part": str(rng.part),
        "parts_total": str(rng.parts_total),
        "first_shot": rng.first_shot,
        "last_shot": rng.last_shot,
    }


def next_context(
    profile: ChannelProfile,
    preset: FormatPreset,
    episode_id: str,
    brief: EpisodeBrief | None,
    rng: PartRange,
    accepted: list[Director],
) -> dict[str, str]:
    """Часть k: конспект принятых частей, чтобы продолжить мог и новый чат."""
    first = accepted[0]
    meta = {**_meta(profile, preset, episode_id, rng), "working_title": first.meta.working_title}
    shots = [s for d in accepted for s in d.shots]
    last = shots[-1] if shots else None
    # Id эпох и обликов — чтобы новый чат не придумал другие для тех же (канон один на план).
    canon = build_canon_ref(s.model_dump(mode="json") for s in shots)
    summary = {
        "parts_received": [d.meta.part for d in accepted],
        "shots_so_far": len(shots),
        "last_shot": None
        if last is None
        else {"id": last.id, "section": last.section, "vo": last.vo},
        "sections": [s.model_dump(mode="json") for s in _sections(accepted)],
        "periods": list(canon.periods),
        "appearances": list(canon.appearances),
    }
    return {
        "channel_name": profile.name,
        "format": profile.format,
        "brief_json": json_block(_brief(brief)),
        "accepted_json": json_block(summary),
        "meta_json": json_block(meta),
        "part": str(rng.part),
        "parts_total": str(rng.parts_total),
        "first_shot": rng.first_shot,
        "last_shot": rng.last_shot,
    }


def _sections(parts: list[Director]) -> list[Section]:
    seen: dict[str, Section] = {}
    for d in parts:
        for section in d.sections:
            seen.setdefault(section.id, section)
    return list(seen.values())


# --- canon_ref и voice ---------------------------------------------------------------------------


def build_canon_ref(shots: Iterable[Mapping[str, Any]]) -> CanonRef:
    """Ссылки на канон из кадров: стиль, эпохи и облики — заготовки `v001` (принцип 13)."""
    periods: set[str] = set()
    appearances: set[str] = set()
    for image in _images(shots):
        period = image.get("period")
        if isinstance(period, str) and PERIOD_ID.fullmatch(period):
            periods.add(period)
        for appearance in _appearances(image):
            if APPEARANCE_ID.fullmatch(appearance):
                appearances.add(appearance)
    version = CANON_PLACEHOLDER_VERSION
    return CanonRef(
        style=f"style/{version}",
        periods={p: f"periods/{p}/{version}" for p in sorted(periods)},
        appearances={a: _appearance_ref(a, version) for a in sorted(appearances)},
    )


def _appearance_ref(appearance: str, version: str) -> str:
    character, look = appearance.split("@", 1)
    return f"characters/{character}/{version}#{look}"


def ref_errors(shots: Iterable[Mapping[str, Any]]) -> list[str]:
    """Id эпох и обликов не по формату — их нельзя превратить в ссылки на канон."""
    errors: list[str] = []
    for shot in shots:
        image = shot.get("image")
        if not isinstance(image, Mapping):
            continue
        prefix = f"кадр {shot.get('id')}"
        period = image.get("period")
        if isinstance(period, str) and not PERIOD_ID.fullmatch(period):
            errors.append(
                f"{prefix}: эпоха «{period}» не по формату, ожидалось строчные латинские буквы,"
                " цифры и дефис, например caribbean-1716"
            )
        for appearance in _appearances(image):
            if not APPEARANCE_ID.fullmatch(appearance):
                errors.append(
                    f"{prefix}: облик «{appearance}» не по формату, ожидалось"
                    " <персонаж>@<облик>, например you@powder-monkey-11"
                )
    return errors


def _images(shots: Iterable[Mapping[str, Any]]) -> Iterable[Mapping[str, Any]]:
    for shot in shots:
        image = shot.get("image") if isinstance(shot, Mapping) else None
        if isinstance(image, Mapping):
            yield image


def _appearances(image: Mapping[str, Any]) -> list[str]:
    values = image.get("appearances")
    if not isinstance(values, list):
        return []
    return [v for v in values if isinstance(v, str)]


def voice_for(profile: ChannelProfile, preset: FormatPreset, route: Route) -> VoiceCfg:
    """Голос канала из профиля; провайдер и модель — маршрут `voice` (принцип 5)."""
    return VoiceCfg(
        provider=route.provider,
        voice_id=profile.voice.voice_id,
        model=route.model,
        pace_wpm=profile.voice.pace_wpm or preset.words_per_minute,
    )


# --- приём части ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class PreparedPart:
    director: Director
    warnings: list[str]


def prepare_part(
    data: dict[str, Any],
    *,
    episode_id: str,
    channel: str,
    expected: Expected,
    voice: VoiceCfg,
    first_part: Director | None,
) -> PreparedPart:
    """Ответ чата (уже JSON) → проверенная часть: сверка, подстановка, `validate_director`.

    Ошибки — `BridgeAnswerError` с текстом для пользователя; ничего не пишет.
    """
    meta = data.get("meta")
    part = 1
    if isinstance(meta, dict):
        _check_meta(meta, episode_id=episode_id, channel=channel, expected=expected)
        if isinstance(meta.get("part"), int):
            part = meta["part"]

    shots = data.get("shots")
    shot_list = [s for s in shots if isinstance(s, Mapping)] if isinstance(shots, list) else []
    bad_refs = ref_errors(shot_list)
    if bad_refs:
        raise _invalid(bad_refs, part)

    data = dict(data)
    warnings: list[str] = []
    for block, what in (("canon_ref", "ссылки на канон"), ("voice", "голос канала")):
        if data.get(block) is not None:
            warnings.append(
                f"Чат прислал {block} — заменён: {what} подставляет приложение, не чат."
            )
    if part == 1:
        data["canon_ref"] = build_canon_ref(shot_list).model_dump(mode="json")
        data["voice"] = voice.model_dump(mode="json")
    else:
        data.pop("canon_ref", None)
        data.pop("voice", None)
        if first_part is not None:
            source = first_part.model_dump(mode="json", by_alias=True)
            for block in FROM_FIRST_PART:
                if data.get(block) is None:
                    data[block] = source[block]

    try:
        director = validate_director(data)
    except DirectorValidationError as exc:
        raise _invalid(exc.errors, part) from None

    for fact in director.facts:
        if not fact.source_url:
            claim = fact.claim
            if len(claim) > CLAIM_PREVIEW:
                claim = claim[:CLAIM_PREVIEW] + "…"
            warnings.append(f"Факт без источника ({fact.status}): «{claim}»")
    return PreparedPart(director=director, warnings=warnings)


def _check_meta(meta: dict[str, Any], *, episode_id: str, channel: str, expected: Expected) -> None:
    got_episode = meta.get("episode_id")
    if isinstance(got_episode, str) and got_episode != episode_id:
        raise BridgeAnswerError(
            f"Это план выпуска «{got_episode}», а открыт выпуск «{episode_id}».",
            "Скопируйте промпт этого выпуска и вставьте ответ на него.",
        )
    got_channel = meta.get("channel")
    if isinstance(got_channel, str) and got_channel != channel:
        raise BridgeAnswerError(
            f"Это план канала «{got_channel}», а выпуск — канала «{channel}».",
            "Скопируйте промпт этого выпуска и вставьте ответ на него.",
        )
    part = meta.get("part", 1)
    if isinstance(part, int) and part not in expected.allowed:
        raise BridgeAnswerError(
            f"Это часть {part}, ожидалась часть {expected.part} — скопируйте промпт части"
            f" {expected.part}.",
            "Части вставляются по порядку: ответ на промпт части "
            f"{expected.part} из этого чата или нового.",
        )
    total = meta.get("parts_total", 1)
    want = expected.parts_total.get(part) if isinstance(part, int) else None
    if isinstance(total, int) and want is not None and total != want:
        raise BridgeAnswerError(
            f"В ответе parts_total = {total}, а план делится на {want} {parts_word(want)}.",
            f"Скопируйте промпт части {part} заново и вставьте ответ на него.",
        )


def _invalid(errors: list[str], part: int) -> BridgeAnswerError:
    count = len(errors)
    return BridgeAnswerError(
        f"Часть {part} не прошла проверку: {count} {errors_word(count)}.",
        HINT_FIX_PART.format(part=part),
        [BridgeIssue(path=issue_path(e), message=e) for e in errors],
    )


_PREFIX = re.compile(r"^(?:кадр|раздел) ([^:\s]+):|^([^:\s]+):")


def issue_path(message: str) -> str:
    """Где ошибка: «кадр s003: …» → `s003`, «раздел r1: …» → `r1`, «meta: …» → `meta`."""
    match = _PREFIX.match(message)
    if match is None:
        return ""
    return match.group(1) or match.group(2)


def plural(count: int, one: str, few: str, many: str) -> str:
    """Русское склонение по числу: 1 часть, 2 части, 5 частей."""
    if count % 10 == 1 and count % 100 != 11:
        return one
    if count % 10 in (2, 3, 4) and count % 100 // 10 != 1:
        return few
    return many


def errors_word(count: int) -> str:
    return plural(count, "ошибка", "ошибки", "ошибок")


def parts_word(count: int) -> str:
    return plural(count, "часть", "части", "частей")
