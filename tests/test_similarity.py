"""M4.10: сходство VO плана с текстом референса — n-граммы слов, порог, совпавшие фразы."""

from pathlib import Path

from app.pipeline.research.similarity import ngrams, percent, similarity, words
from app.pipeline.research.subtitles import parse_subtitles

FIXTURE = Path(__file__).parent / "fixtures" / "reference_warship.srt"
REFERENCE = " ".join(cue.text for cue in parse_subtitles(FIXTURE.read_text(encoding="utf-8")))
OWN = [
    "Our film follows a cook through the galley kitchens of Venice in winter.",
    "She feeds four hundred sailors with one cauldron and a ladle older than her.",
]


def test_words_are_lowercase_without_punctuation() -> None:
    assert words("Captain's CHAIR, — don't! 1716") == ["captain's", "chair", "don't", "1716"]
    assert ngrams(["a", "b", "c"], 2) == [("a", "b"), ("b", "c")]


def test_own_phrases_are_below_threshold() -> None:
    found = similarity(OWN, REFERENCE, 5, 0.10)
    assert found.ok
    assert found.ratio == 0.0
    assert found.phrases == []
    assert found.total == len(words(OWN[0])) - 4 + len(words(OWN[1])) - 4


def test_copied_phrases_are_above_threshold_and_listed() -> None:
    copied = (
        "THREE hundred men pull together, below deck — and none of them can see where the ship"
        " is going!"
    )
    found = similarity([copied, OWN[0]], REFERENCE, 5, 0.10)
    copied_words = len(words(copied))
    own_words = len(words(OWN[0]))
    assert (found.matched, found.total) == (copied_words - 4, copied_words - 4 + own_words - 4)
    assert found.ratio == round((copied_words - 4) / (copied_words - 4 + own_words - 4), 4)
    assert not found.ok
    assert found.phrases == [
        "three hundred men pull together below deck and none of them can see where the ship is"
        " going"
    ]


def test_ngrams_do_not_cross_shot_boundaries() -> None:
    # Вместе — фраза субтитров «on the stern and give the order», по кадрам — по 4 слова
    apart = similarity(["on the stern and", "give the order to"], REFERENCE, 5, 0.10)
    assert (apart.matched, apart.total, apart.ok) == (0, 0, True)
    together = similarity(["on the stern and give the order to"], REFERENCE, 5, 0.10)
    assert together.matched == together.total == 4


def test_phrases_are_the_five_longest_distinct() -> None:
    shots = [
        "the rower sits on a narrow bench",  # 7 слов
        "he earns more than the rower, eats meat twice a week",  # 11
        "the helmsman holds two steering oars at the stern",  # 9
        "the first thing the navy hands you",  # 7
        "every rank on a roman warship",  # 6
        "the marine stands on that deck in armour",  # 8
        "the helmsman holds two steering oars at the stern",  # повтор
    ]
    found = similarity(shots, REFERENCE, 5, 0.10)
    assert found.ratio == 1.0
    assert [len(p.split()) for p in found.phrases] == [11, 9, 8, 7, 7]


def test_percent() -> None:
    assert (percent(0.14), percent(0.104), percent(0.1), percent(0.0)) == (
        "14 %",
        "10.4 %",
        "10 %",
        "0 %",
    )
