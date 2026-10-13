"""Сходство VO плана с текстом референса (принцип 11, устав M4, решение 10).

Текст нормализуется: нижний регистр, без пунктуации, слова. Доля — сколько n-грамм VO плана (с
повторами) встречается среди n-грамм субтитров. n-граммы плана берутся по кадру, через границу
кадров не склеиваются; субтитры — одним текстом: в ролике фраза часто переходит через границу
реплики. Совпавшие n-граммы подряд склеиваются во фразу; в ответе — до пяти самых длинных.
Множество кортежей слов, без `rapidfuzz`. `n` и порог — `config/reference.yaml`.
"""

import re
from collections.abc import Sequence

from app.models.reference import Similarity

MAX_PHRASES = 5
_WORD = re.compile(r"[^\W_]+(?:['’][^\W_]+)*")


def words(text: str) -> list[str]:
    """Слова в нижнем регистре; апостроф внутри слова — часть слова (`don't`)."""
    return [w.replace("’", "'") for w in _WORD.findall(text.lower())]


def ngrams(tokens: Sequence[str], n: int) -> list[tuple[str, ...]]:
    return [tuple(tokens[i : i + n]) for i in range(len(tokens) - n + 1)]


def reference_grams(reference_text: str, n: int) -> set[tuple[str, ...]]:
    """n-граммы субтитров одним текстом — множество для проверок одного референса."""
    return set(ngrams(words(reference_text), n))


def _matches(
    tokens: Sequence[str], reference: set[tuple[str, ...]], n: int
) -> tuple[list[bool], list[list[str]]]:
    """Совпадения n-грамм текста с субтитрами и фразы из них: подряд идущие совпадения i…j — одна
    фраза из слов i…j+n−1."""
    hits = [gram in reference for gram in ngrams(tokens, n)]
    phrases: list[list[str]] = []
    start: int | None = None
    for i, hit in enumerate([*hits, False]):
        if hit and start is None:
            start = i
        elif not hit and start is not None:
            phrases.append(list(tokens[start : i - 1 + n]))
            start = None
    return hits, phrases


def quotes(text: str, reference: set[tuple[str, ...]], n: int) -> list[str]:
    """Фразы текста из `n` и больше слов, которые есть в субтитрах; пусто — написано своими словами.
    Для полей разбора чата (`topic`, подписи, приёмы): они уходят в промпт плана (принцип 11)."""
    return [" ".join(p) for p in _matches(words(text), reference, n)[1]]


def similarity(plan_vo: Sequence[str], reference_text: str, n: int, threshold: float) -> Similarity:
    """`plan_vo` — VO кадров действующего плана по порядку, `reference_text` — текст реплик."""
    reference = reference_grams(reference_text, n)
    total = 0
    matched = 0
    phrases: list[list[str]] = []
    for vo in plan_vo:
        hits, found = _matches(words(vo), reference, n)
        total += len(hits)
        matched += sum(hits)
        phrases.extend(found)
    ratio = matched / total if total else 0.0
    unique = list(dict.fromkeys(" ".join(p) for p in phrases))
    longest = sorted(unique, key=lambda p: len(p.split()), reverse=True)[:MAX_PHRASES]
    return Similarity(
        ratio=round(ratio, 4),
        threshold=threshold,
        ngram=n,
        ok=ratio <= threshold,
        matched=matched,
        total=total,
        phrases=longest,
    )


def percent(value: float) -> str:
    """0.14 → «14 %», 0.104 → «10.4 %»: дробная часть — только когда она есть."""
    rounded = round(value * 100, 1)
    return f"{rounded:g} %"
