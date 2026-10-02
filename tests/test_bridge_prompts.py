"""Шаблоны промптов моста: загрузка, проверка front-matter, строгий детерминированный рендер."""

import hashlib
from pathlib import Path

import pytest

from app import main as app_main
from app.main import create_app
from app.pipeline.bridge import (
    PROMPTS_DIR,
    PromptRenderError,
    json_block,
    load_templates,
)
from app.providers.base import ConfigError
from app.settings import Settings

FIXTURE_PROMPTS = Path(__file__).parent / "fixtures" / "prompts"

CONTEXT = {
    "channel": "Cursus",
    "idea": "Every rank on a pirate ship",
    "brief_json": json_block({"angle": "Ранги глазами юнги", "sources": []}),
}

EXPECTED_TEXT = """You are helping with the channel Cursus.

Idea: Every rank on a pirate ship

Brief:
{
  "angle": "Ранги глазами юнги",
  "sources": []
}

Answer with exactly one ```json block.
"""


def test_fixture_template_loads() -> None:
    library = load_templates(FIXTURE_PROMPTS)
    assert library.ids() == ["echo"]
    template = library.get("echo")
    assert (template.id, template.version, template.task, template.model_hint) == (
        "echo",
        3,
        "ideas",
        "opus",
    )
    assert template.placeholders == {"channel", "idea", "brief_json"}


def test_render_is_deterministic() -> None:
    first = load_templates(FIXTURE_PROMPTS).render("echo", CONTEXT)
    second = load_templates(FIXTURE_PROMPTS).render("echo", dict(reversed(CONTEXT.items())))
    assert first == second
    assert first.text == EXPECTED_TEXT
    assert (first.prompt_id, first.version) == ("echo", 3)
    assert first.sha256 == hashlib.sha256(EXPECTED_TEXT.encode("utf-8")).hexdigest()

    other = load_templates(FIXTURE_PROMPTS).render("echo", {**CONTEXT, "idea": "Monastery"})
    assert other.sha256 != first.sha256


def test_values_are_inserted_once_as_is() -> None:
    """Значение с `{{…}}` внутри не раскрывается повторно, пробелы и переносы не трогаются."""
    rendered = load_templates(FIXTURE_PROMPTS).render(
        "echo", {**CONTEXT, "idea": "  {{channel}}\n"}
    )
    assert "Idea:   {{channel}}\n\n" in rendered.text


def test_missing_key_is_named() -> None:
    library = load_templates(FIXTURE_PROMPTS)
    with pytest.raises(PromptRenderError) as caught:
        library.render("echo", {"channel": "Cursus"})
    assert str(caught.value) == "Шаблон «echo»: нет значений для {{brief_json}}, {{idea}}."


def test_extra_key_is_named() -> None:
    library = load_templates(FIXTURE_PROMPTS)
    with pytest.raises(PromptRenderError) as caught:
        library.render("echo", {**CONTEXT, "angle": "x"})
    assert str(caught.value) == "Шаблон «echo»: лишние ключи контекста: angle."


def test_non_string_value_is_an_error() -> None:
    library = load_templates(FIXTURE_PROMPTS)
    bad = {**CONTEXT, "brief_json": {"angle": "x"}}
    with pytest.raises(PromptRenderError, match="значения не строки: brief_json"):
        library.render("echo", bad)  # type: ignore[arg-type]


def test_unknown_template() -> None:
    with pytest.raises(PromptRenderError, match="Шаблона «plan» нет. Есть: echo."):
        load_templates(FIXTURE_PROMPTS).render("plan", {})


def test_missing_directory_is_empty_library(tmp_path: Path) -> None:
    assert len(load_templates(tmp_path / "nope")) == 0


GOOD_HEADER = "---\nid: {id}\nversion: 1\ntask: plan\nmodel_hint: opus\n---\n"


@pytest.mark.parametrize(
    ("name", "content", "message"),
    [
        ("plan", "Just text {{x}}\n", "шаблон начинается со строки `---`"),
        ("plan", "---\nid: plan\nversion: 1\n", "front-matter не закрыт строкой `---`"),
        ("plan", "---\nid: [plan\n---\nText\n", "front-matter не разобран как YAML"),
        ("plan", "---\n- plan\n---\nText\n", "front-matter должен быть словарём"),
        ("plan", "---\nid: plan\ntask: plan\nmodel_hint: opus\n---\n", "нет поля «version»"),
        ("plan", "---\nid: plan\nversion: '2'\ntask: plan\nmodel_hint: x\n---\n", "«version»"),
        ("plan", "---\nid: plan\nversion: 1\ntask: script\nmodel_hint: x\n---\n", "«task»"),
        (
            "plan",
            GOOD_HEADER.format(id="plan") + "Idea: {{ idea }}\n",
            "непонятная подстановка в строках текста [1]",
        ),
        ("plan", GOOD_HEADER.format(id="plan").replace("---\n", "---\nmodel: x\n", 1), "«model»"),
        ("ideas", GOOD_HEADER.format(id="plan"), "id «plan» не совпадает с именем файла"),
    ],
)
def test_broken_template_is_config_error(
    tmp_path: Path, name: str, content: str, message: str
) -> None:
    (tmp_path / f"{name}.md").write_text(content, encoding="utf-8")
    with pytest.raises(ConfigError) as caught:
        load_templates(tmp_path)
    assert message in str(caught.value)
    assert f"{name}.md" in str(caught.value)


def test_app_checks_templates_at_start(
    tmp_path: Path, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Каталог шаблонов приложения проверяется в `create_app`: битый шаблон — бэкенд не стартует."""
    create_app(settings)
    (tmp_path / "plan.md").write_text("no front-matter\n", encoding="utf-8")
    monkeypatch.setattr(app_main, "PROMPTS_DIR", tmp_path)
    with pytest.raises(ConfigError, match="plan.md"):
        create_app(settings)


def test_app_templates_are_valid() -> None:
    """Шаблоны в `backend/app/prompts/` (появляются с M4.2) проходят проверку."""
    load_templates(PROMPTS_DIR)
