from collections.abc import Callable, Iterator
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import create_app
from app.models.project import Asset
from app.pipeline.images.shot_assets import Drawing, add_image_version
from app.pipeline.script import approve
from app.settings import Settings
from app.storage.paths import StudioPaths

DrawShot = Callable[..., Asset]


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    # `_env_file=None` — не читать реальный backend/.env разработчика; данные во временном каталоге.
    return Settings(_env_file=None, studio_data_dir=tmp_path / "data")


@pytest.fixture
def app(settings: Settings) -> FastAPI:
    return create_app(settings)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    # Контекстный менеджер запускает lifespan — так же, как uvicorn при старте.
    with TestClient(app) as client:
        yield client


@pytest.fixture
def no_canon_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    """«Утвердить план» без проверки канона (M5.2) — для тестов о других проверках: канон к их
    планам не публикуется. Сама проверка — `tests/test_plan_approve.py`, раздел «Канон»."""
    checks = [check for check in approve.CHECKS if check is not approve.canon_ready]
    monkeypatch.setattr(approve, "CHECKS", checks)


@pytest.fixture
def draw(settings: Settings) -> DrawShot:
    """Версия картинки кадра — так, как её положит джоб кадра (M6.2): PNG 64×36, файл, миниатюры
    и строка `assets`; первая версия кадра выбирается сама."""
    paths = StudioPaths(settings.studio_data_dir)

    def _draw(
        episode: str,
        shot_id: str,
        *,
        channel: str = "cursus",
        data: bytes | None = None,
        variant: int = 1,
        cached: bool = False,
    ) -> Asset:
        if data is None:
            ok, encoded = cv2.imencode(".png", np.full((36, 64, 3), 128, dtype=np.uint8))
            assert ok
            data = encoded.tobytes()
        drawing = Drawing(
            input_hash=f"sha256:{shot_id}-{variant}",
            model="nb2",
            seed=1000 + variant,
            variant=variant,
            usd_micro=0 if cached else 67_000,
            cached=cached,
        )
        return add_image_version(paths, channel, episode, shot_id, data, drawing)

    return _draw
