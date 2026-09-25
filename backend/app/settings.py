"""Настройки приложения: читаются из переменных окружения и `backend/.env`.

Секреты живут только здесь (принцип 9): ключи провайдеров — `SecretStr`, не утекают в логи и repr.
"""

from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
ENV_FILE = BACKEND_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        # Пустое значение в `.env` (`STUDIO_DATA_DIR=`) означает «по умолчанию», а не пустой путь.
        env_ignore_empty=True,
        extra="ignore",
    )

    # Рабочие данные: `data/` в репозитории (gitignored), в ФС WSL, не в `/mnt/c` (L-002).
    studio_data_dir: Path = REPO_ROOT / "data"
    log_level: str = "INFO"
    cors_origins: list[str] = ["http://localhost:5173"]

    # Очередь джобов (M2.5, docs/jobs.md). 0 воркеров — очередь без исполнения (тесты API);
    # больше 4 — нельзя: рендер не больше 4 воркеров (принцип 12).
    job_workers: int = Field(default=3, ge=0, le=4)
    job_max_attempts: int = Field(default=3, ge=1)
    job_retry_wait_s: float = Field(default=1.0, ge=0)  # база экспоненты: 1, 2, 4 … с
    sse_heartbeat_s: float = Field(default=15.0, gt=0)

    # Маршруты и цены провайдеров (M2.6, docs/providers.md); тесты подают свой каталог.
    config_dir: Path = REPO_ROOT / "config"
    # Цена, проверенная дольше этого срока назад, — предупреждение в логе и `stale_pricing`.
    pricing_stale_days: int = Field(default=60, gt=0)

    # Ключи провайдеров — пустые по умолчанию; без ключа проверка `-m live` — skip (M2.6).
    gemini_api_key: SecretStr = SecretStr("")
    elevenlabs_api_key: SecretStr = SecretStr("")
    anthropic_api_key: SecretStr = SecretStr("")
    youtube_oauth_client_secret_cursus: SecretStr = SecretStr("")
    youtube_oauth_client_secret_otto: SecretStr = SecretStr("")

    @field_validator("studio_data_dir", mode="after")
    @classmethod
    def _resolve_data_dir(cls, value: Path) -> Path:
        return value.expanduser().resolve()

    @field_validator("log_level", mode="after")
    @classmethod
    def _upper_log_level(cls, value: str) -> str:
        return value.upper()
