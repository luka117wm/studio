"""Субтитры референса → реплики `Cue {start, end, text}` (M4.10). Сеть не используется: текст
вставляется руками.

Форматы:
- SRT и VTT — строки времени `00:01:02,500 --> 00:01:05,000` (у VTT — точка и можно без часов);
  у VTT вырезаются теги (`<c>`, `<00:00:01.000>`, `<v Имя>`), блоки `NOTE`, `STYLE`, `REGION`
  пропускаются;
- расшифровка YouTube — таймкод `0:00` / `1:02:03` отдельной строкой перед текстом или в начале
  строки.

Конец без явного значения — начало следующей реплики; у последней — начало плюс время её слов при
150 словах в минуту (`LAST_CUE_WPM`). Длительность референса — конец последней реплики. Таймкодов
нет вовсе — `SubtitlesError` с текстом для пользователя. Правила — `docs/research.md`, «Референс».
"""

import math
import re
from dataclasses import dataclass

from app.models.reference import Cue

NO_TIMECODES = "Не похоже на субтитры: нет таймкодов. Вставьте SRT, VTT или расшифровку с YouTube."
# Темп для конца последней реплики расшифровки, у которой конца нет: слова при 150 в минуту.
LAST_CUE_WPM = 150

_STAMP = r"(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?"
_TIMING = re.compile(rf"^\s*{_STAMP}\s*-->\s*{_STAMP}")
_TRANSCRIPT = re.compile(r"^\s*(?:(\d+):)?(\d{1,2}):(\d{2})(?:\s+(.*))?$")
_TAG = re.compile(r"<[^>]*>")
_WORD = re.compile(r"[^\W_]+(?:['’][^\W_]+)*")


class SubtitlesError(ValueError):
    """Текст не разобран как субтитры; сообщение — для пользователя."""


def count_words(text: str) -> int:
    return len(_WORD.findall(text))


def _seconds(hours: str | None, minutes: str, seconds: str, fraction: str | None = None) -> float:
    value = int(hours or 0) * 3600 + int(minutes) * 60 + int(seconds)
    return value + (int(fraction.ljust(3, "0")) / 1000 if fraction else 0.0)


def _clean(line: str) -> str:
    return " ".join(_TAG.sub("", line).split())


@dataclass
class _Draft:
    start: float
    end: float | None
    lines: list[str]


def parse_subtitles(text: str) -> list[Cue]:
    """Реплики по порядку начала; пустые реплики (только теги, номера) выбрасываются."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").replace("\ufeff", "").split("\n")
    drafts = _timed(lines) if any(_TIMING.match(line) for line in lines) else _transcript(lines)
    drafts = [d for d in drafts if " ".join(d.lines).strip()]
    if not drafts:
        raise SubtitlesError(NO_TIMECODES)
    drafts.sort(key=lambda d: d.start)
    cues: list[Cue] = []
    for index, draft in enumerate(drafts):
        body = " ".join(draft.lines)
        if draft.end is not None and draft.end > draft.start:
            end = draft.end
        elif index + 1 < len(drafts):
            end = max(drafts[index + 1].start, draft.start)
        else:
            end = draft.start + max(1.0, math.ceil(count_words(body) * 60 / LAST_CUE_WPM))
        cues.append(Cue(start=draft.start, end=end, text=body))
    return cues


def _timed(lines: list[str]) -> list[_Draft]:
    """SRT и VTT: блок начинается строкой времени; номер блока SRT и служебные блоки VTT
    пропускаются."""
    drafts: list[_Draft] = []
    current: _Draft | None = None
    skipping = False
    for raw in lines:
        line = raw.strip()
        timing = _TIMING.match(line)
        if timing:
            groups = timing.groups()
            current = _Draft(_seconds(*groups[:4]), _seconds(*groups[4:]), [])
            drafts.append(current)
            skipping = False
            continue
        if not line:
            current = None
            skipping = False
            continue
        if current is None:
            # Вне реплики: WEBVTT, номер блока SRT, NOTE / STYLE / REGION до пустой строки
            if line.split(" ", 1)[0] in ("NOTE", "STYLE", "REGION"):
                skipping = True
            continue
        if skipping:
            continue
        cleaned = _clean(line)
        if cleaned:
            current.lines.append(cleaned)
    return drafts


def _transcript(lines: list[str]) -> list[_Draft]:
    """Расшифровка YouTube: `0:00` отдельной строкой или `0:00 текст`; строки без таймкода — к
    текущей реплике."""
    drafts: list[_Draft] = []
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        match = _TRANSCRIPT.match(line)
        if match:
            hours, minutes, seconds, rest = match.groups()
            drafts.append(_Draft(_seconds(hours, minutes, seconds), None, []))
            if rest and _clean(rest):
                drafts[-1].lines.append(_clean(rest))
        elif drafts:
            drafts[-1].lines.append(_clean(line))
    return drafts
