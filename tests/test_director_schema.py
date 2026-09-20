import copy
import json
from pathlib import Path
from typing import Any

import pytest

from app.models.director import Director
from app.models.validators import (
    DirectorValidationError,
    find_style_tokens,
    load_stoplist,
    validate_director,
)
from app.tools.gen_schema import SCHEMA_PATH, build_schema, render_schema

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return data


@pytest.fixture
def pirate() -> dict[str, Any]:
    return load("director_pirate_10shots.json")


def errors_of(data: dict[str, Any]) -> list[str]:
    with pytest.raises(DirectorValidationError) as info:
        validate_director(data)
    return info.value.errors


# --- валидная фикстура ---


def test_pirate_fixture_is_valid(pirate: dict[str, Any]) -> None:
    director = validate_director(pirate)
    assert director.schema_version == "studio.director/1"
    assert len(director.shots) == 10
    assert [s.id for s in director.sections] == ["r1", "r2"]
    assert director.meta.part == 1 and director.meta.parts_total == 1
    assert director.canon_ref is not None
    assert director.canon_ref.style == "style/v003"
    assert director.canon_ref.appearances == {
        "you@powder-monkey-11": "characters/you/v004#powder-monkey-11"
    }


def test_roundtrip_keeps_schema_alias(pirate: dict[str, Any]) -> None:
    dumped = validate_director(pirate).model_dump(by_alias=True, mode="json")
    assert dumped["schema"] == "studio.director/1"
    assert "schema_version" not in dumped


# --- битые фикстуры: одна поломка — сообщение с ID кадра и причиной ---


@pytest.mark.parametrize(
    ("name", "fragments"),
    [
        ("duplicate_shot_id", ["кадр s002", "повторяется"]),
        ("motion_strength", ["кадр s002", "motion.strength = 0.4", "≤ 0.25"]),
        ("unknown_section", ["кадр s003", "раздел «r9» не найден", "r1"]),
        ("empty_vo", ["кадр s002", "пустой vo"]),
        ("style_token", ["кадр s003", "«cinematic lighting»", "«8k»", "стиль задаёт канон"]),
    ],
)
def test_broken_fixture_reports_shot_and_reason(name: str, fragments: list[str]) -> None:
    errors = errors_of(load(f"director_broken_{name}.json"))
    joined = "\n".join(errors)
    for fragment in fragments:
        assert fragment in joined, joined
    assert "Traceback" not in joined


def test_all_domain_errors_reported_at_once(pirate: dict[str, Any]) -> None:
    pirate["shots"][0]["vo"] = ""
    pirate["shots"][3]["section"] = "r9"
    pirate["music"][1]["section"] = "r9"
    errors = errors_of(pirate)
    assert len(errors) == 3
    assert errors[0].startswith("кадр s001: пустой vo")
    assert errors[1].startswith("кадр s004: раздел «r9» не найден")
    assert errors[2].startswith("music[1]: раздел «r9» не найден")


def test_all_structural_errors_reported_at_once(pirate: dict[str, Any]) -> None:
    del pirate["shots"][0]["vo"]
    pirate["shots"][1]["extra_field"] = 1
    pirate["shots"][2]["motion"]["type"] = "zoom"
    pirate["meta"]["target_minutes"] = "twenty"
    errors = errors_of(pirate)
    assert errors == [
        "meta: target_minutes = 'twenty' не того типа, ожидалось целое число",
        "кадр s001: нет поля vo, ожидалось обязательное поле",
        "кадр s002: лишнее поле extra_field, ожидалось только поля схемы studio.director/1",
        "кадр s003: motion.type = 'zoom' недопустимо, ожидалось одно из: 'push_in', 'pull_out', "
        "'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'static' или 'drift'",
    ]


# --- правило частей ---


def test_part_two_without_canon_and_voice_is_valid(pirate: dict[str, Any]) -> None:
    pirate["meta"]["part"] = 2
    pirate["meta"]["parts_total"] = 3
    del pirate["canon_ref"]
    del pirate["voice"]
    director = validate_director(pirate)
    assert director.canon_ref is None and director.voice is None


def test_part_one_requires_canon_and_voice(pirate: dict[str, Any]) -> None:
    del pirate["canon_ref"]
    del pirate["voice"]
    errors = errors_of(pirate)
    assert errors == [
        "canon_ref: блок отсутствует, ожидалось обязательный блок в части 1",
        "voice: блок отсутствует, ожидалось обязательный блок в части 1",
    ]


def test_part_cannot_exceed_parts_total(pirate: dict[str, Any]) -> None:
    pirate["meta"]["part"] = 2
    assert errors_of(pirate) == [
        "meta: part = 2 больше parts_total = 1, ожидалось part ≤ parts_total"
    ]


# --- прочие доменные проверки ---


def test_animate_recommended_requires_prompt(pirate: dict[str, Any]) -> None:
    pirate["shots"][2]["animate"]["prompt"] = None
    (error,) = errors_of(pirate)
    assert error.startswith("кадр s003: animate.recommended = true без animate.prompt")


def test_period_and_appearance_must_exist_in_canon_ref(pirate: dict[str, Any]) -> None:
    pirate["shots"][0]["image"]["period"] = "england-1347"
    pirate["shots"][1]["image"]["appearances"] = ["you@captain-35"]
    errors = errors_of(pirate)
    assert errors == [
        "кадр s001: image.period «england-1347» нет в canon_ref.periods, "
        "ожидалось один из caribbean-1716",
        "кадр s002: облик «you@captain-35» нет в canon_ref.appearances, "
        "ожидалось один из you@powder-monkey-11",
    ]


def test_canon_ref_values_follow_version_format(pirate: dict[str, Any]) -> None:
    pirate["canon_ref"]["periods"]["caribbean-1716"] = "caribbean-1716"
    pirate["canon_ref"]["appearances"]["you@powder-monkey-11"] = "characters/you/v004"
    errors = errors_of(pirate)
    assert errors[0].startswith("canon_ref: periods[caribbean-1716] = «caribbean-1716», ожидалось")
    assert errors[1].startswith(
        "canon_ref: appearances[you@powder-monkey-11] = «characters/you/v004»"
    )


def test_duplicate_section_id(pirate: dict[str, Any]) -> None:
    pirate["sections"].append(copy.deepcopy(pirate["sections"][0]))
    assert errors_of(pirate) == ["раздел r1: id повторяется, ожидалось уникальный id раздела"]


def test_overlay_is_reserved_null(pirate: dict[str, Any]) -> None:
    pirate["shots"][0]["overlay"] = {"text": "x"}
    (error,) = errors_of(pirate)
    assert error == "кадр s001: overlay = {'text': 'x'}, ожидалось null (поле зарезервировано)"


def test_model_validate_also_enforces_domain_rules(pirate: dict[str, Any]) -> None:
    # Доменные проверки живут в самой модели — обойти их через model_validate нельзя.
    pirate["shots"][0]["vo"] = " "
    with pytest.raises(ValueError, match="кадр s001: пустой vo"):
        Director.model_validate(pirate)


# --- стоп-лист ---


def test_stoplist_matches_whole_words_case_insensitively() -> None:
    stoplist = load_stoplist()
    assert find_style_tokens("An Anime-style boy runs, Cinematic Lighting", stoplist) == [
        ("anime", "medium"),
        ("cinematic lighting", "lighting"),
    ]
    assert find_style_tokens("an animated crowd, 18k of them, at a hearth", stoplist) == []


def test_stoplist_has_principle_13_tokens() -> None:
    tokens = {token for token, _ in load_stoplist()}
    assert {"photorealistic", "cinematic lighting", "8k", "anime", "oil painting", "35mm"} <= tokens
    assert any(category == "artists" for _, category in load_stoplist())


# --- JSON Schema ---


def test_schema_file_is_up_to_date() -> None:
    assert SCHEMA_PATH.read_text(encoding="utf-8") == render_schema(), (
        "перегенерируйте: PYTHONPATH=backend uv run python -m app.tools.gen_schema"
    )


def test_schema_header_and_root_fields() -> None:
    schema = build_schema()
    assert schema["$id"] == "studio.director/1"
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert schema["properties"]["schema"] == {
        "const": "studio.director/1",
        "title": "Schema",
        "type": "string",
    }
    assert list(schema["properties"]) == [
        "schema", "meta", "brief", "canon_ref", "voice", "sections", "shots",
        "music", "thumbnail", "publish", "facts",
    ]  # fmt: skip
    assert schema["additionalProperties"] is False
    assert schema["$defs"]["Shot"]["properties"]["overlay"]["type"] == "null"
