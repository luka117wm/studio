"""Выгрузка JSON Schema моделей API — источник TS-типов фронта (`pnpm -C frontend typegen`).

Контракт director.json — `docs/director.schema.json`; модели ответов и тел запросов API — по
группе в `docs/schema/<группа>.schema.json`. Запуск:
`PYTHONPATH=backend uv run python -m app.tools.gen_schema` пишет файлы; `--stdout` печатает
`{путь от корня репозитория: содержимое}` одним JSON и ничего не пишет (так `typegen:check`
сверяет без записи). Вывод детерминирован: порядок полей — как в моделях, повторная генерация на
том же коде не даёт диффа (есть тест).
"""

import json
import logging
import sys
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel
from pydantic.json_schema import GenerateJsonSchema, models_json_schema
from pydantic_core import core_schema

from app.api.cost import CostSummary, LedgerPage
from app.api.episodes import Episode, EpisodeCreate
from app.api.jobs import JobCreate, JobList
from app.cost.budget import BudgetRefusal
from app.jobs.queue import Job, JobEventData, JobSummary
from app.log import configure_logging
from app.models.channel import ChannelProfile
from app.models.director import SCHEMA_VERSION, Director
from app.models.project import DirectorVersionInfo, Project
from app.pipeline.director_import import ImportResult
from app.providers.base import Cost, KeyStatus
from app.settings import REPO_ROOT

SCHEMA_PATH = REPO_ROOT / "docs" / "director.schema.json"
API_SCHEMA_DIR = REPO_ROOT / "docs" / "schema"
JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema"

Mode = Literal["validation", "serialization"]

# Группа → модели. Ответы — режим serialization: поле со значением по умолчанию сервер отдаёт
# всегда, в TS оно обязательное. Тела запросов — validation: такое поле можно не присылать.
API_GROUPS: dict[str, list[tuple[type[BaseModel], Mode]]] = {
    "project": [
        (Project, "serialization"),
        (DirectorVersionInfo, "serialization"),
        (ImportResult, "serialization"),
    ],
    "channel": [(ChannelProfile, "serialization")],
    "episode": [(Episode, "serialization"), (EpisodeCreate, "validation")],
    "job": [
        (Job, "serialization"),
        (JobList, "serialization"),
        (JobSummary, "serialization"),
        (JobEventData, "serialization"),
        (JobCreate, "validation"),
    ],
    "cost": [
        (CostSummary, "serialization"),
        (LedgerPage, "serialization"),
        (Cost, "serialization"),
        (BudgetRefusal, "serialization"),
    ],
    "provider": [(KeyStatus, "serialization")],
}

log = logging.getLogger(__name__)


class ApiJsonSchema(GenerateJsonSchema):
    """Ответ сервера содержит каждое поле модели, даже со значением по умолчанию: в режиме
    serialization такое поле обязательное (по умолчанию pydantic делает его необязательным)."""

    def field_is_required(
        self,
        field: core_schema.ModelField | core_schema.DataclassField | core_schema.TypedDictField,
        total: bool,
    ) -> bool:
        if self.mode == "serialization" and field["type"] != "typed-dict-field":
            return field.get("serialization_exclude_if") is None
        return super().field_is_required(field, total)


def build_schema() -> dict[str, Any]:
    schema = Director.model_json_schema(by_alias=True)
    # `$schema` и `$id` — первыми, дальше — как отдаёт pydantic.
    return {
        "$schema": JSON_SCHEMA_DIALECT,
        "$id": SCHEMA_VERSION,
        "title": "Director",
        "description": f"Режиссёрский план эпизода Studio, версия {SCHEMA_VERSION}.",
        **{k: v for k, v in schema.items() if k not in ("title", "description")},
    }


def build_api_schema(group: str) -> dict[str, Any]:
    """Все модели группы — в `$defs`. `$id` — на файл: `$id` внутри `$defs` сменил бы базовый
    URI подсхемы, и ссылки `#/$defs/…` в ней перестали бы находиться."""
    models = API_GROUPS[group]
    _, top = models_json_schema(
        models, ref_template="#/$defs/{model}", schema_generator=ApiJsonSchema
    )
    return {
        "$schema": JSON_SCHEMA_DIALECT,
        "$id": f"studio.api/{group}",
        "title": group,
        "description": f"Модели API Studio, группа «{group}». Сгенерировано из Pydantic.",
        "$defs": top["$defs"],
    }


def _dump(schema: dict[str, Any]) -> str:
    return json.dumps(schema, indent=2, ensure_ascii=False) + "\n"


def render_schema() -> str:
    return _dump(build_schema())


def render_all() -> dict[Path, str]:
    """Путь → содержимое всех файлов схем: director и группы API."""
    files = {SCHEMA_PATH: render_schema()}
    for group in API_GROUPS:
        files[API_SCHEMA_DIR / f"{group}.schema.json"] = _dump(build_api_schema(group))
    return files


def main(argv: list[str]) -> None:
    files = render_all()
    if "--stdout" in argv:
        out = {path.relative_to(REPO_ROOT).as_posix(): text for path, text in files.items()}
        sys.stdout.write(json.dumps(out, ensure_ascii=False))
        return
    configure_logging("INFO")
    for path, text in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        log.info("schema written: %s", path)


if __name__ == "__main__":
    main(sys.argv[1:])
