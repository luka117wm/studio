"""Шаблоны промптов моста: `<каталог>/<id>.md` с front-matter и подстановками `{{name}}`.

Front-matter — простой YAML между строками `---`: `id` (равен имени файла, отсюда уникальность),
`version` (целое; меняется текст — растёт версия), `task`, `model_hint`. `task: image` — шаблон
картинки канона (M5.4: лист опорных портретов, кадры стиля), `task: check` — вопрос о готовом кадре
(M6.6: проверка анахронизмов), а не задача моста. Текст шаблона — на английском. Рендер
детерминирован и строг: каждое имя `{{name}}` должно прийти в контексте, лишний ключ контекста —
тоже ошибка. Значения подставляются как есть, один проход: значение с
`{{…}}` внутри не раскрывается повторно. JSON-фрагменты сериализует код (`json_block`), а не
шаблон. Правила — `docs/bridge.md`.
"""

import hashlib
import json
import logging
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.models.director import StrictModel
from app.providers.base import ConfigError

log = logging.getLogger(__name__)

# Шаблоны приложения; тесты подают загрузчику свой каталог.
PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts"

# Задачи моста (устав M4, решение 1): план частями, идеи, разбор референса; черновик эпохи и
# «Дополнить запреты» (M5.6, устав M5, решение 4). Стиль канала и облики мост не пишет.
BridgeTask = Literal["plan", "ideas", "reference", "canon_period"]
# Шаблон в каталоге — задача моста, промпт картинки канона (`image`, M5.4) или вопрос о готовом
# кадре (`check`, M6.6). Один плоский Literal: у объединения pydantic пишет ошибку по каждому
# члену, и текст отказа теряет смысл.
PromptTask = Literal["plan", "ideas", "reference", "canon_period", "image", "check"]

PROMPT_ID_PATTERN = r"^[a-z][a-z0-9_-]*$"
_PLACEHOLDER = re.compile(r"\{\{([a-z_][a-z0-9_]*)\}\}")
_FRONT_MATTER_FENCE = "---"


class PromptRenderError(ValueError):
    """Контекст не сходится с шаблоном или шаблона нет — ошибка кода, который собирает промпт."""


class FrontMatter(StrictModel):
    id: str = Field(pattern=PROMPT_ID_PATTERN)
    version: Annotated[int, Field(strict=True, ge=1)]
    task: PromptTask
    model_hint: str = Field(min_length=1)


class RenderedPrompt(BaseModel):
    """Готовый промпт: текст и чем он сделан. `sha256` — от текста, в журнал обменов."""

    model_config = ConfigDict(frozen=True)

    text: str
    prompt_id: str
    version: int
    sha256: str


@dataclass(frozen=True)
class PromptTemplate:
    id: str
    version: int
    task: PromptTask
    model_hint: str
    body: str
    placeholders: frozenset[str]
    source: Path

    def render(self, context: Mapping[str, str]) -> RenderedPrompt:
        missing = sorted(self.placeholders - context.keys())
        extra = sorted(context.keys() - self.placeholders)
        problems = []
        if missing:
            problems.append("нет значений для " + ", ".join(f"{{{{{k}}}}}" for k in missing))
        if extra:
            problems.append("лишние ключи контекста: " + ", ".join(extra))
        not_str = sorted(k for k, v in context.items() if not isinstance(v, str))
        if not_str:
            problems.append(
                "значения не строки: " + ", ".join(not_str) + " — JSON сериализует json_block()"
            )
        if problems:
            raise PromptRenderError(f"Шаблон «{self.id}»: " + "; ".join(problems) + ".")

        text = _PLACEHOLDER.sub(lambda m: context[m.group(1)], self.body)
        return RenderedPrompt(
            text=text,
            prompt_id=self.id,
            version=self.version,
            sha256=hashlib.sha256(text.encode("utf-8")).hexdigest(),
        )


class PromptLibrary:
    """Шаблоны, проверенные при загрузке; ключ — `id`."""

    def __init__(self, templates: Mapping[str, PromptTemplate]) -> None:
        self._templates = dict(templates)

    def __len__(self) -> int:
        return len(self._templates)

    def ids(self) -> list[str]:
        return sorted(self._templates)

    def get(self, prompt_id: str) -> PromptTemplate:
        template = self._templates.get(prompt_id)
        if template is None:
            known = ", ".join(self.ids()) or "шаблонов нет"
            raise PromptRenderError(f"Шаблона «{prompt_id}» нет. Есть: {known}.")
        return template

    def render(self, prompt_id: str, context: Mapping[str, str]) -> RenderedPrompt:
        return self.get(prompt_id).render(context)


def json_block(value: Any) -> str:
    """JSON-фрагмент контекста: одна сериализация на все шаблоны, детерминированная."""
    return json.dumps(value, indent=2, ensure_ascii=False)


def load_templates(directory: Path) -> PromptLibrary:
    """Все `*.md` каталога. Любая ошибка шаблона — `ConfigError`: бэкенд не стартует.

    Каталога нет — библиотека пустая: шаблоны появляются вместе с задачами моста (M4.2+).
    """
    templates: dict[str, PromptTemplate] = {}
    if directory.is_dir():
        for path in sorted(directory.glob("*.md")):
            template = parse_template(path)
            templates[template.id] = template
    log.info("prompts: %d templates in %s", len(templates), directory)
    return PromptLibrary(templates)


def parse_template(path: Path) -> PromptTemplate:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ConfigError(f"Не прочитать шаблон промпта {path}: {exc}") from exc

    header, body = _split_front_matter(path, raw)
    try:
        data = yaml.safe_load(header)
    except yaml.YAMLError as exc:
        raise ConfigError(f"{path}: front-matter не разобран как YAML: {exc}") from exc
    if not isinstance(data, dict):
        raise ConfigError(f"{path}: front-matter должен быть словарём полей id, version, task.")
    try:
        meta = FrontMatter.model_validate(data)
    except ValidationError as exc:
        raise ConfigError(f"{path}: front-matter: {_describe(exc)}.") from exc
    if meta.id != path.stem:
        raise ConfigError(
            f"{path}: id «{meta.id}» не совпадает с именем файла — шаблон лежит в {meta.id}.md."
        )

    bad = [
        line_no
        for line_no, line in enumerate(body.splitlines(), start=1)
        if line.count("{{") != len(_PLACEHOLDER.findall(line))
    ]
    if bad:
        raise ConfigError(
            f"{path}: непонятная подстановка в строках текста {bad} — пишется {{{{name}}}}:"
            " строчные латинские буквы, цифры и _, без пробелов."
        )

    return PromptTemplate(
        id=meta.id,
        version=meta.version,
        task=meta.task,
        model_hint=meta.model_hint,
        body=body,
        placeholders=frozenset(_PLACEHOLDER.findall(body)),
        source=path,
    )


def _split_front_matter(path: Path, raw: str) -> tuple[str, str]:
    """Текст после закрывающей `---` — тело шаблона, как есть."""
    lines = raw.splitlines(keepends=True)
    if not lines or lines[0].rstrip("\r\n") != _FRONT_MATTER_FENCE:
        raise ConfigError(f"{path}: шаблон начинается со строки `---` и front-matter.")
    for index in range(1, len(lines)):
        if lines[index].rstrip("\r\n") == _FRONT_MATTER_FENCE:
            return "".join(lines[1:index]), "".join(lines[index + 1 :])
    raise ConfigError(f"{path}: front-matter не закрыт строкой `---`.")


def _describe(exc: ValidationError) -> str:
    parts = []
    for error in exc.errors(include_url=False):
        field = ".".join(str(p) for p in error["loc"]) or "front-matter"
        if error["type"] == "missing":
            parts.append(f"нет поля «{field}»")
        elif error["type"] == "extra_forbidden":
            parts.append(f"лишнее поле «{field}»")
        else:
            parts.append(f"поле «{field}»: {error['msg']}")
    return "; ".join(parts)
