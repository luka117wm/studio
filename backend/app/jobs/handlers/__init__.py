"""Обработчики джобов по типу. Новый тип — модуль со `SPEC` и строка в `builtin_handlers()`."""

from app.jobs.handlers import anchors, shots, sleep
from app.jobs.worker import HandlerSpec
from app.models.checks_config import load_checks_config
from app.pipeline.checks.face import FaceChecker
from app.settings import Settings
from app.storage.paths import StudioPaths


def builtin_handlers(settings: Settings | None = None) -> dict[str, HandlerSpec]:
    """Встроенные виды; лимиты видов — из настроек (по умолчанию — как у `Settings()`). Проверка
    лица — по `config/checks.yaml` (ошибка файла — `ConfigError`, бэкенд не стартует), веса — из
    `data/models/`, грузятся при первой проверке."""
    settings = settings or Settings(_env_file=None)
    checks = load_checks_config(settings.config_dir / "checks.yaml")
    checker = FaceChecker(checks.face, StudioPaths(settings.studio_data_dir).models_dir)
    specs = [sleep.SPEC, *anchors.SPECS, *shots.specs(settings.images_parallel, checker)]
    return {spec.kind: spec for spec in specs}
