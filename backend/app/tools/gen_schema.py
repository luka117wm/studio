"""Выгрузка JSON Schema контракта director.json в `docs/director.schema.json`.

Запуск: `PYTHONPATH=backend uv run python -m app.tools.gen_schema`. Вывод детерминирован:
порядок полей — как в моделях, повторная генерация на том же коде не даёт диффа (есть тест).
"""

import json
import logging
from pathlib import Path
from typing import Any

from app.log import configure_logging
from app.models.director import SCHEMA_VERSION, Director
from app.settings import REPO_ROOT

SCHEMA_PATH = REPO_ROOT / "docs" / "director.schema.json"
JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema"

log = logging.getLogger(__name__)


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


def render_schema() -> str:
    return json.dumps(build_schema(), indent=2, ensure_ascii=False) + "\n"


def main(path: Path = SCHEMA_PATH) -> None:
    configure_logging("INFO")
    path.write_text(render_schema(), encoding="utf-8")
    log.info("schema written: %s", path)


if __name__ == "__main__":
    main()
