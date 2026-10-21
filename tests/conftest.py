from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import create_app
from app.pipeline.script import approve
from app.settings import Settings


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
