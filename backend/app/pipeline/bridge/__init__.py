"""Мост через чат: промпт из шаблона → пользователь копирует его в claude.ai → вставленный ответ
разбирается и применяется. Anthropic API мост не вызывает, расходов не пишет.

`prompts.py` — шаблоны и рендер, `extract.py` — JSON из ответа, `runs.py` — журнал обменов,
`errors.py` — ошибка ответа для пользователя. Контракт — `docs/bridge.md`.
"""

from app.pipeline.bridge.errors import BridgeAnswerError, BridgeError, BridgeIssue
from app.pipeline.bridge.extract import extract_json
from app.pipeline.bridge.prompts import (
    PROMPTS_DIR,
    BridgeTask,
    PromptLibrary,
    PromptRenderError,
    PromptTemplate,
    RenderedPrompt,
    json_block,
    load_templates,
)
from app.pipeline.bridge.runs import (
    BridgeRun,
    RunNotFound,
    close_run,
    latest_runs,
    open_run,
    record_answer,
)

__all__ = [
    "PROMPTS_DIR",
    "BridgeAnswerError",
    "BridgeError",
    "BridgeIssue",
    "BridgeRun",
    "BridgeTask",
    "PromptLibrary",
    "PromptRenderError",
    "PromptTemplate",
    "RenderedPrompt",
    "RunNotFound",
    "close_run",
    "extract_json",
    "json_block",
    "latest_runs",
    "load_templates",
    "open_run",
    "record_answer",
]
