"""Обработчики джобов по типу. Новый тип — модуль со `SPEC` и строка в `builtin_handlers()`."""

from app.jobs.handlers import anchors, shots, sleep
from app.jobs.worker import HandlerSpec
from app.settings import Settings


def builtin_handlers(settings: Settings | None = None) -> dict[str, HandlerSpec]:
    """Встроенные виды; лимиты видов — из настроек (по умолчанию — как у `Settings()`)."""
    settings = settings or Settings(_env_file=None)
    specs = [sleep.SPEC, *anchors.SPECS, shots.spec(settings.images_parallel)]
    return {spec.kind: spec for spec in specs}
