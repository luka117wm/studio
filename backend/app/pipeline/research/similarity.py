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


def similarity(plan_vo: Sequence[str], reference_text: str, n: int, threshold: float) -> Similarity:
    """`plan_vo` — VO кадров действующего плана по порядку, `reference_text` — текст реплик."""
    reference = set(ngrams(words(reference_text), n))
    total = 0
    matched = 0
    phrases: list[list[str]] = []
    for vo in plan_vo:
        tokens = words(vo)
        hits = [gram in reference for gram in ngrams(tokens, n)]
        total += len(hits)
        matched += sum(hits)
        # Подряд идущие совпадения i…j — одна фраза из слов i…j+n−1
        start: int | None = None
        for i, hit in enumerate([*hits, False]):
            if hit and start is None:
                start = i
            elif not hit and start is not None:
                phrases.append(tokens[start : i - 1 + n])
                start = None
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
