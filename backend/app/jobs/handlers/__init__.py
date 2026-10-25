"""Обработчики джобов по типу. Новый тип — модуль со `SPEC` и строка в `builtin_handlers()`."""

from app.jobs.handlers import anchors, shots, sleep
from app.jobs.worker import HandlerSpec
from app.models.checks_config import load_checks_config
from app.pipeline.checks.anachronism import AnachronismChecker
from app.pipeline.checks.face import FaceChecker
from app.pipeline.checks.shot_check import ShotChecks
from app.settings import Settings
from app.storage.paths import StudioPaths


def builtin_handlers(settings: Settings | None = None) -> dict[str, HandlerSpec]:
    """Встроенные виды; лимиты видов — из настроек (по умолчанию — как у `Settings()`). Проверка
    кадров — по `config/checks.yaml` (ошибка файла — `ConfigError`, бэкенд не стартует): веса
    лица — из `data/models/`, грузятся при первой проверке; вопрос об анахронизмах — этап `check`
    шлюза."""
    settings = settings or Settings(_env_file=None)
    checks = load_checks_config(settings.config_dir / "checks.yaml")
    shot_checks = ShotChecks(
        face=FaceChecker(checks.face, StudioPaths(settings.studio_data_dir).models_dir),
        anachronism=AnachronismChecker(checks.anachronism),
    )
    specs = [sleep.SPEC, *anchors.SPECS, *shots.specs(settings.images_parallel, shot_checks)]
    return {spec.kind: spec for spec in specs}
