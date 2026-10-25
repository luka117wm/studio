"""Скачивает веса локальных моделей в `data/models/` и сверяет sha256 (M6.5: проверка лица).

Запуск — `FETCH_COMMAND` из корня репозитория. Что качать — `config/checks.yaml`: имя файла,
sha256, зеркала по порядку. Файл на месте с верным хэшем — ничего не качает; хэш не тот —
качает заново. Запись — во временный файл рядом, потом rename: прерванная загрузка не оставит
обрезка под именем весов (L-003). Хэш скачанного не совпал — файла нет, следующее зеркало.
"""

import hashlib
import logging
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import httpx

from app.log import configure_logging
from app.models.checks_config import ChecksConfig, WeightFile, load_checks_config
from app.pipeline.checks.face import FETCH_COMMAND, file_sha256, weight_path
from app.settings import Settings
from app.storage.paths import StudioPaths

log = logging.getLogger(__name__)

TIMEOUT = httpx.Timeout(30.0, read=120.0)


@dataclass(frozen=True)
class Fetched:
    file: str
    status: Literal["present", "downloaded", "failed"]
    detail: str = ""


def weights_of(config: ChecksConfig) -> list[WeightFile]:
    return [config.face.models.detector, config.face.models.recognizer]


def fetch_all(config: ChecksConfig, models_dir: Path, client: httpx.Client) -> list[Fetched]:
    models_dir.mkdir(parents=True, exist_ok=True)
    return [fetch_one(weight, models_dir, client) for weight in weights_of(config)]


def fetch_one(weight: WeightFile, models_dir: Path, client: httpx.Client) -> Fetched:
    target = weight_path(models_dir, weight)
    if target.is_file() and file_sha256(target) == weight.sha256:
        return Fetched(weight.file, "present")
    errors: list[str] = []
    for url in weight.urls:
        try:
            got = _download(client, url, target, weight.sha256)
        except httpx.HTTPError as exc:
            errors.append(f"{url}: {type(exc).__name__}: {exc}")
            continue
        if got == weight.sha256:
            return Fetched(weight.file, "downloaded", url)
        errors.append(f"{url}: sha256 {got} вместо {weight.sha256}")
    return Fetched(weight.file, "failed", "; ".join(errors))


def _download(client: httpx.Client, url: str, target: Path, expected: str) -> str:
    """Качает `url` во временный файл рядом с `target`; хэш совпал — rename, иначе файл удаляется.
    Возвращает sha256 скачанного."""
    temp = target.with_name(f".{target.name}.part")
    digest = hashlib.sha256()
    try:
        with client.stream("GET", url, follow_redirects=True) as response:
            response.raise_for_status()
            with temp.open("wb") as fh:
                for chunk in response.iter_bytes(1 << 20):
                    fh.write(chunk)
                    digest.update(chunk)
                fh.flush()
                os.fsync(fh.fileno())
        got = digest.hexdigest()
        if got == expected:
            os.replace(temp, target)
        return got
    finally:
        temp.unlink(missing_ok=True)


def main() -> int:
    settings = Settings()
    configure_logging(settings.log_level)
    config = load_checks_config(settings.config_dir / "checks.yaml")
    models_dir = StudioPaths(settings.studio_data_dir).models_dir
    with httpx.Client(timeout=TIMEOUT) as client:
        results = fetch_all(config, models_dir, client)
    for result in results:
        if result.status == "present":
            log.info("%s: на месте, sha256 совпал — не качаю", result.file)
        elif result.status == "downloaded":
            log.info("%s: скачан из %s, sha256 совпал", result.file, result.detail)
        else:
            log.error("%s: не скачан — %s", result.file, result.detail)
    failed = [r.file for r in results if r.status == "failed"]
    if failed:
        log.error(
            "Не скачаны %s — проверьте сеть и URL в config/checks.yaml, потом `%s`.",
            ", ".join(failed),
            FETCH_COMMAND,
        )
        return 1
    log.info("Веса проверки лица в %s", models_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
