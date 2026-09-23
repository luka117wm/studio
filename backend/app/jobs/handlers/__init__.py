"""Обработчики джобов по типу. Новый тип — модуль со `SPEC` и строка в `builtin_handlers()`."""

from app.jobs.handlers import sleep
from app.jobs.worker import HandlerSpec


def builtin_handlers() -> dict[str, HandlerSpec]:
    specs = [sleep.SPEC]
    return {spec.kind: spec for spec in specs}
