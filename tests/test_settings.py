from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.settings import REPO_ROOT, Settings


def test_default_data_dir_is_repo_data() -> None:
    assert Settings(_env_file=None).studio_data_dir == REPO_ROOT / "data"


def test_env_var_overrides_and_expands_home(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("STUDIO_DATA_DIR", "~/studio-data")
    assert Settings(_env_file=None).studio_data_dir == (tmp_path / "studio-data").resolve()


def test_env_file_is_read(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("STUDIO_DATA_DIR", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text(f"STUDIO_DATA_DIR={tmp_path / 'from-env'}\nLOG_LEVEL=debug\n")
    settings = Settings(_env_file=env_file)
    assert settings.studio_data_dir == tmp_path / "from-env"
    assert settings.log_level == "DEBUG"


def test_empty_env_value_means_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STUDIO_DATA_DIR", "")
    assert Settings(_env_file=None).studio_data_dir == REPO_ROOT / "data"


def test_data_dir_created_on_startup(client: TestClient, settings: Settings) -> None:
    assert settings.studio_data_dir.is_dir()


def test_secrets_do_not_leak_in_repr(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-secret")
    settings = Settings(_env_file=None)
    assert "sk-secret" not in repr(settings)
    assert settings.anthropic_api_key.get_secret_value() == "sk-secret"
