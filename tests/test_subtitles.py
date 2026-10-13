"""M4.10: субтитры референса — SRT, VTT с тегами, расшифровка YouTube в обоих видах, текст без
таймкодов."""

from pathlib import Path

import pytest

from app.pipeline.research.subtitles import (
    NO_TIMECODES,
    SubtitlesError,
    count_words,
    parse_subtitles,
)

FIXTURE = Path(__file__).parent / "fixtures" / "reference_warship.srt"


def test_srt_fixture() -> None:
    cues = parse_subtitles(FIXTURE.read_text(encoding="utf-8"))
    assert len(cues) == 14
    first = cues[0]
    assert (first.start, first.end) == (0.0, 6.5)
    # Две строки реплики — одна строка текста
    assert (
        first.text
        == "You are seventeen, and the first thing the navy hands you is not a sword. It is an oar."
    )
    assert (cues[6].start, cues[6].end) == (52.0, 65.0)
    assert cues[-1].end == 180.0


def test_srt_with_crlf_bom_and_numbers_inside_text() -> None:
    text = (
        "\ufeff1\r\n00:00:01,000 --> 00:00:02,500\r\nIn 1716 the crew\r\n\r\n"
        "2\r\n00:00:02,500 --> 00:00:04,000\r\nvoted.\r\n"
    )
    cues = parse_subtitles(text)
    assert [(c.start, c.end, c.text) for c in cues] == [
        (1.0, 2.5, "In 1716 the crew"),
        (2.5, 4.0, "voted."),
    ]


def test_vtt_tags_notes_and_cue_ids_are_dropped() -> None:
    text = """WEBVTT
Kind: captions
Language: en

NOTE this is a note
that spans two lines

STYLE
::cue { color: lime }

intro
00:00.000 --> 00:04.500 align:start position:0%
<c.colorE5E5E5>You are</c><00:00:01.200><c> seventeen</c>

00:04.500 --> 00:09.000
<v Narrator>and the navy hands you an oar.</v>

01:02:03.250 --> 01:02:05.000
much later
"""
    cues = parse_subtitles(text)
    assert [(c.start, c.end, c.text) for c in cues] == [
        (0.0, 4.5, "You are seventeen"),
        (4.5, 9.0, "and the navy hands you an oar."),
        (3723.25, 3725.0, "much later"),
    ]


def test_youtube_transcript_timecode_on_its_own_line() -> None:
    text = "0:00\nYou are seventeen\n0:06\nand the navy hands you\nan oar\n1:02:03\nmuch later on\n"
    cues = parse_subtitles(text)
    assert [(c.start, c.text) for c in cues] == [
        (0.0, "You are seventeen"),
        (6.0, "and the navy hands you an oar"),
        (3723.0, "much later on"),
    ]
    # Конец — начало следующей; у последней — время её слов при 150 в минуту (3 слова → 2 с)
    assert [c.end for c in cues] == [6.0, 3723.0, 3725.0]


def test_youtube_transcript_timecode_at_line_start() -> None:
    text = "0:00 You are seventeen\n0:06 and the navy hands you\nan oar\n2:10 the end\n"
    cues = parse_subtitles(text)
    assert [(c.start, c.end, c.text) for c in cues] == [
        (0.0, 6.0, "You are seventeen"),
        (6.0, 130.0, "and the navy hands you an oar"),
        (130.0, 131.0, "the end"),
    ]


@pytest.mark.parametrize(
    "text",
    [
        "You are seventeen, and the navy hands you an oar.",
        "",
        "WEBVTT\n\nNOTE nothing here\n",
        "1\n00:00:01,000 --> 00:00:02,000\n\n",
    ],
)
def test_text_without_timecodes_is_an_error(text: str) -> None:
    with pytest.raises(SubtitlesError) as exc:
        parse_subtitles(text)
    assert str(exc.value) == NO_TIMECODES


def test_count_words_keeps_inner_apostrophes() -> None:
    assert count_words("The captain's chair — don't sit, 1716!") == 6
