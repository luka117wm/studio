"""Референс через мост (M4.10): контекст промпта разбора, приём разбора чата, метрики, структура
для плана.

Чистые функции без диска и HTTP; таблица и журнал обменов — `api/references.py`. Принцип 11:
`reference_structure` — единственное, что от референса уходит в промпт плана, и текста реплик в ней
нет: виды и подписи сегментов (подписи пишет чат своими словами), длительности, темп, приёмы.
Правила — `docs/research.md`, «Референс».
"""

from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from app.models.channel import ChannelProfile
from app.models.formats import FormatPreset
from app.models.reference import (
    SEGMENT_KINDS,
    AnalysisSegment,
    Cue,
    ReferenceAnalysis,
    ReferenceMetrics,
    ReferenceMode,
    SegmentMetrics,
    Technique,
)
from app.pipeline.bridge import BridgeAnswerError, BridgeIssue, json_block
from app.pipeline.research.similarity import quotes, reference_grams
from app.pipeline.research.subtitles import count_words
from app.pipeline.script.plan_bridge import errors_word

PROMPT_REFERENCE = "reference"
# Первый сегмент — не позже этой секунды: иначе разбор пропустил начало ролика.
FIRST_SEGMENT_MAX_S = 30
# «Держится до»: сегмент, где плотность фактов не ниже этой доли средней.
DENSITY_HOLD = 0.7

HINT_FIX_ANALYSIS = (
    "Скопируйте ошибки в чат и попросите прислать разбор исправленным, целиком одним блоком"
    " ```json."
)


def clock(seconds: float) -> str:
    """Секунды → «03:31», от часа — «1:02:03»."""
    total = int(seconds)
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes:02d}:{secs:02d}"


def reference_context(
    profile: ChannelProfile, preset: FormatPreset, cues: list[Cue], duration_s: float, ngram: int
) -> dict[str, str]:
    """Контекст шаблона `reference`: наш канал (для чего разбор), длительность, реплики
    `[03:31] text`, длина фразы, которую приём разбора считает цитатой (`config/reference.yaml`)."""
    preset_view = {
        "minutes": preset.minutes.model_dump(),
        "words_per_minute": preset.words_per_minute,
    }
    return {
        "channel_name": profile.name,
        "format": profile.format,
        "preset_json": json_block(preset_view),
        "duration": clock(duration_s),
        "duration_s": str(round(duration_s)),
        "cues": "\n".join(f"[{clock(cue.start)}] {cue.text}" for cue in cues),
        "ngram": str(ngram),
    }


# --- приём разбора --------------------------------------------------------------------------------


def review_analysis(
    data: Mapping[str, Any], duration_s: float, subtitles_text: str, ngram: int
) -> ReferenceAnalysis:
    """Ответ чата → разбор или `BridgeAnswerError` (422) со всеми ошибками по-русски, с номером
    сегмента.

    Проверки: поля и типы; хотя бы два сегмента; начала по возрастанию, первое — не позже 30 с,
    все — в пределах длительности; у приёма `count ≥ 1`; тема, подписи сегментов и приёмы — без
    фраз субтитров из `ngram` слов: они уходят в промпт плана (принцип 11, L-036).
    """
    issues: list[BridgeIssue] = []
    topic = data.get("topic")
    if not isinstance(topic, str) or not topic.strip():
        issues.append(
            BridgeIssue(path="topic", message="нет темы «topic» — одной строкой своими словами")
        )

    raw_segments = data.get("segments")
    segments: list[AnalysisSegment] = []
    if not isinstance(raw_segments, list):
        issues.append(BridgeIssue(path="segments", message="нет списка сегментов «segments»"))
        raw_segments = []
    for index, item in enumerate(raw_segments, start=1):
        path = f"segments[{index - 1}]"
        if not isinstance(item, Mapping):
            issues.append(BridgeIssue(path=path, message=f"сегмент {index}: ожидался объект {{…}}"))
            continue
        try:
            segments.append(AnalysisSegment.model_validate(item))
        except ValidationError as exc:
            issues.extend(_segment_issues(exc, index, path, item))
    if isinstance(data.get("segments"), list) and len(raw_segments) < 2:
        issues.append(
            BridgeIssue(path="segments", message="сегментов меньше двух — разбор слишком грубый")
        )
    if len(segments) == len(raw_segments):
        issues.extend(_order_issues(segments, duration_s))

    raw_techniques = data.get("techniques", [])
    if not isinstance(raw_techniques, list):
        issues.append(BridgeIssue(path="techniques", message="«techniques» — список приёмов"))
        raw_techniques = []
    for index, item in enumerate(raw_techniques, start=1):
        try:
            Technique.model_validate(item)
        except ValidationError:
            issues.append(
                BridgeIssue(
                    path=f"techniques[{index - 1}]",
                    message=f"приём {index}: нужны «text» — приём своими словами и «count» ≥ 1",
                )
            )

    issues.extend(_quote_issues(data, subtitles_text, ngram))

    if issues:
        raise BridgeAnswerError(
            f"Разбор не прошёл проверку: {len(issues)} {errors_word(len(issues))}.",
            HINT_FIX_ANALYSIS,
            issues,
        )
    return ReferenceAnalysis.model_validate(data)


def _quote_issues(data: Mapping[str, Any], subtitles_text: str, ngram: int) -> list[BridgeIssue]:
    """Поля разбора, которые уходят в промпт плана, — своими словами: чат цитирует субтитры
    вопреки промпту, а тема для «Своей версии» становится идеей заявки (L-036)."""
    grams = reference_grams(subtitles_text, ngram)
    issues: list[BridgeIssue] = []

    def check(value: object, path: str, who: str) -> None:
        if not isinstance(value, str):
            return
        found = sorted(quotes(value, grams, ngram), key=lambda p: len(p.split()), reverse=True)
        if found:
            issues.append(
                BridgeIssue(
                    path=path,
                    message=f"{who} повторяет субтитры «{found[0]}» — перескажите своими словами",
                )
            )

    check(data.get("topic"), "topic", "тема «topic»")
    raw_segments = data.get("segments")
    for index, item in enumerate(raw_segments if isinstance(raw_segments, list) else [], start=1):
        if isinstance(item, Mapping):
            check(item.get("label"), f"segments[{index - 1}].label", f"сегмент {index}: подпись")
    raw_techniques = data.get("techniques")
    for index, item in enumerate(
        raw_techniques if isinstance(raw_techniques, list) else [], start=1
    ):
        if isinstance(item, Mapping):
            check(item.get("text"), f"techniques[{index - 1}].text", f"приём {index}: текст")
    return issues


def _segment_issues(
    exc: ValidationError, index: int, path: str, item: Mapping[str, Any]
) -> list[BridgeIssue]:
    issues: list[BridgeIssue] = []
    for error in exc.errors(include_url=False):
        field = str(error["loc"][0]) if error["loc"] else ""
        where = f"{path}.{field}" if field else path
        if error["type"] == "missing":
            text = f"сегмент {index}: нет поля «{field}»"
        elif field == "kind":
            kinds = ", ".join(SEGMENT_KINDS)
            text = (
                f"сегмент {index}: вид «{item.get('kind')}» неизвестен, ожидалось одно из: {kinds}"
            )
        elif field == "start":
            text = f"сегмент {index}: начало «{item.get('start')}» — ожидались секунды или mm:ss"
        elif field == "facts":
            text = f"сегмент {index}: «facts» — целое число фактов, не меньше 0"
        elif field == "label":
            text = f"сегмент {index}: пустая подпись «label»"
        else:
            text = f"сегмент {index}: «{field}» — {error['msg']}"
        issues.append(BridgeIssue(path=where, message=text))
    return issues


def _order_issues(segments: list[AnalysisSegment], duration_s: float) -> list[BridgeIssue]:
    issues: list[BridgeIssue] = []
    if segments and segments[0].start > FIRST_SEGMENT_MAX_S:
        issues.append(
            BridgeIssue(
                path="segments[0].start",
                message=f"сегмент 1: начинается в {clock(segments[0].start)}, а должен — в первые"
                f" {FIRST_SEGMENT_MAX_S} секунд ролика",
            )
        )
    for index, segment in enumerate(segments, start=1):
        path = f"segments[{index - 1}].start"
        if index > 1 and segment.start <= segments[index - 2].start:
            issues.append(
                BridgeIssue(
                    path=path,
                    message=f"сегмент {index}: начало {clock(segment.start)} не позже предыдущего"
                    f" {clock(segments[index - 2].start)} — сегменты идут по порядку",
                )
            )
        if segment.start >= duration_s:
            issues.append(
                BridgeIssue(
                    path=path,
                    message=f"сегмент {index}: начало {clock(segment.start)} за концом ролика"
                    f" {clock(duration_s)}",
                )
            )
    return issues


# --- метрики --------------------------------------------------------------------------------------


def metrics(
    cues: list[Cue], analysis: ReferenceAnalysis, duration_s: float, norm_wpm: int
) -> ReferenceMetrics:
    """Метрики по репликам и разбору. Реплика относится к сегменту, в котором начинается; сегмент
    длится до начала следующего, последний — до конца ролика."""
    segments = analysis.segments
    bounds = [s.start for s in segments[1:]] + [duration_s]
    total_words = sum(count_words(cue.text) for cue in cues)
    facts_total = sum(s.facts for s in segments)
    minutes = duration_s / 60
    facts_per_min = facts_total / minutes if minutes else 0.0

    rows: list[SegmentMetrics] = []
    for index, (segment, end) in enumerate(zip(segments, bounds, strict=True), start=1):
        length = max(end - segment.start, 0.0)
        seg_words = sum(count_words(c.text) for c in cues if segment.start <= c.start < end)
        seg_minutes = length / 60
        rows.append(
            SegmentMetrics(
                index=index,
                kind=segment.kind,
                label=segment.label,
                start_s=segment.start,
                duration_s=round(length, 3),
                words=seg_words,
                pace_wpm=round(seg_words / seg_minutes, 1) if seg_minutes else 0.0,
                facts=segment.facts,
                facts_per_min=round(segment.facts / seg_minutes, 2) if seg_minutes else 0.0,
            )
        )
    floor = DENSITY_HOLD * facts_per_min
    holding = [row for row in rows if facts_per_min and _density(row) >= floor]
    pace = total_words / minutes if minutes else 0.0
    return ReferenceMetrics(
        duration_s=duration_s,
        words=total_words,
        pace_wpm=round(pace, 1),
        norm_wpm=norm_wpm,
        pace_delta=round((pace - norm_wpm) / norm_wpm, 3) if norm_wpm else 0.0,
        facts_total=facts_total,
        facts_per_min=round(facts_per_min, 2),
        holds_until_s=round(holding[-1].start_s + holding[-1].duration_s, 3) if holding else None,
        retention_hooks_s=[s.start for s in segments if s.kind == "retention"],
        segments_total=len(segments),
        ranks_total=sum(1 for s in segments if s.kind == "rank"),
        segments=rows,
    )


def _density(row: SegmentMetrics) -> float:
    """Факты сегмента в минуту без округления — для «держится до»."""
    return row.facts / (row.duration_s / 60) if row.duration_s else 0.0


def reference_structure(
    analysis: ReferenceAnalysis, measured: ReferenceMetrics, mode: ReferenceMode
) -> dict[str, Any]:
    """Структура референса для промпта плана (принцип 11): ни одной реплики, только форма ролика."""
    return {
        "mode": mode,
        "segments": [
            {"kind": row.kind, "label": row.label, "seconds": round(row.duration_s)}
            for row in measured.segments
        ],
        "pace_wpm": round(measured.pace_wpm),
        "techniques": [t.model_dump() for t in analysis.techniques],
    }
