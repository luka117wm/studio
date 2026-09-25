"""Провайдеры без сети (M2.6): проверка ключа на подменённом транспорте, разбор ошибок, единицы."""

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
import httpx2
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.jobs.worker import TransientError, is_retryable, retry_after_s
from app.providers.anthropic import AnthropicProvider
from app.providers.base import (
    CharQuota,
    ImageRequest,
    KeyStatus,
    ProviderError,
    RateLimited,
    Route,
    RouteError,
    SpeechRequest,
    TextRequest,
    status_error,
)
from app.providers.elevenlabs import ElevenLabsProvider
from app.providers.gateway import Gateway, build_gateway
from app.providers.gemini import GeminiProvider
from app.settings import Settings
from app.storage.paths import StudioPaths

KEY = SecretStr("test-key")
NO_KEY = SecretStr("")


def _json(status: int, body: Any, **headers: str) -> dict[str, Any]:
    return {"status_code": status, "content": json.dumps(body), "headers": headers}


# --- ошибки ------------------------------------------------------------------------------------


def test_status_error_maps_to_queue_behaviour() -> None:
    limited = status_error("Gemini", 429, "quota", retry_after=12)
    assert isinstance(limited, RateLimited) and limited.retry_after == 12
    assert is_retryable(limited) and retry_after_s(limited) == 12
    assert "через 12 с" in str(limited)

    overloaded = status_error("Gemini", 503, "overloaded")
    assert isinstance(overloaded, TransientError) and is_retryable(overloaded)

    for status in (401, 402, 403, 400):
        error = status_error("ElevenLabs", status, "nope")
        assert isinstance(error, ProviderError) and error.status_code == status
        assert not is_retryable(error), status
    assert "Проверьте ключ в backend/.env — см. docs/api_keys.md." in str(
        status_error("ElevenLabs", 401, "invalid_api_key")
    )


def test_usage_rejects_foreign_request_kinds() -> None:
    route = Route(stage="images", key="k", kind="image", provider="anthropic", model="m")
    with pytest.raises(RouteError):
        AnthropicProvider(KEY).usage(route, ImageRequest(prompt="deck"))
    with pytest.raises(RouteError):
        GeminiProvider(KEY).usage(route, SpeechRequest(text="hi", voice_id="v"))
    with pytest.raises(RouteError):
        ElevenLabsProvider(KEY).usage(route, TextRequest(prompt="hi", max_output_tokens=1))
    speech = ElevenLabsProvider(KEY).usage(route, SpeechRequest(text="hello", voice_id="v"))
    assert [(u.unit, u.quantity) for u in speech] == [("char", 5)]


# --- проверка ключей ---------------------------------------------------------------------------


def test_missing_keys_are_reported_without_network(tmp_path: Path) -> None:
    settings = Settings(_env_file=None, studio_data_dir=tmp_path / "data")
    gateway = build_gateway(settings, StudioPaths(settings.studio_data_dir))
    statuses = asyncio.run(gateway.check_keys())
    assert [s.provider for s in statuses] == ["anthropic", "elevenlabs", "gemini"]
    assert all(not s.configured and not s.ok for s in statuses)
    assert all("docs/api_keys.md" in s.message for s in statuses)


def test_elevenlabs_check_reports_quota() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            **_json(
                200,
                {
                    "tier": "creator",
                    "character_count": 21_000,
                    "character_limit": 121_000,
                    "next_character_count_reset_unix": 1_791_000_000,
                },
            )
        )

    provider = ElevenLabsProvider(KEY, transport=httpx.MockTransport(handler))
    status = asyncio.run(provider.check())
    assert status.ok and status.quota is not None
    assert status.quota.remaining_chars == 100_000 and status.quota.tier == "creator"
    assert status.quota.resets_at == "2026-10-03T04:00:00+00:00"
    assert "осталось 100000 из 121000 символов" in status.message
    assert seen[0].url.path == "/v1/user/subscription"
    assert seen[0].headers["xi-api-key"] == "test-key"


def test_elevenlabs_check_explains_rejected_key() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = {"detail": {"status": "invalid_api_key", "message": "Invalid API key"}}
        return httpx.Response(**_json(401, body))

    status = asyncio.run(ElevenLabsProvider(KEY, transport=httpx.MockTransport(handler)).check())
    assert status.configured and not status.ok
    assert "401" in status.message and "invalid_api_key" in status.message
    assert asyncio.run(ElevenLabsProvider(NO_KEY).check()).configured is False


def test_anthropic_check_lists_models_and_missing_ones() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        assert request.url.path == "/v1/models"
        assert request.headers["x-api-key"] == "test-key"
        models = [
            {
                "id": model_id,
                "type": "model",
                "display_name": model_id,
                "created_at": "2026-01-01T00:00:00Z",
            }
            for model_id in ("claude-opus-5", "claude-sonnet-5")
        ]
        body = {"data": models, "has_more": False, "first_id": None, "last_id": None}
        return httpx2.Response(200, json=body)

    client = httpx2.AsyncClient(transport=httpx2.MockTransport(handler))
    status = asyncio.run(
        AnthropicProvider(KEY, http_client=client).check(["claude-opus-5", "claude-opus-9"])
    )
    assert status.ok and status.missing_models == ["claude-opus-9"]


def test_anthropic_check_rejected_key_is_not_ok() -> None:
    calls: list[int] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        calls.append(1)
        error = {"type": "authentication_error", "message": "invalid x-api-key"}
        return httpx2.Response(401, json={"type": "error", "error": error})

    client = httpx2.AsyncClient(transport=httpx2.MockTransport(handler))
    status = asyncio.run(AnthropicProvider(KEY, http_client=client).check())
    assert status.configured and not status.ok and "401" in status.message
    assert calls == [1]  # SDK сам не повторяет — повторяет только очередь


def test_gemini_check_lists_models_and_missing_ones() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/models")
        body = {"models": [{"name": "models/gemini-3.1-flash-image"}, {"name": "models/veo-x"}]}
        return httpx.Response(**_json(200, body))

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    status = asyncio.run(
        GeminiProvider(KEY, http_client=client).check(["gemini-3.1-flash-image", "gemini-9"])
    )
    assert status.ok and status.missing_models == ["gemini-9"]


def test_gemini_check_rate_limit_is_reported_once() -> None:
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        body = {"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED"}}
        return httpx.Response(**_json(429, body, **{"Retry-After": "7"}))

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    status = asyncio.run(GeminiProvider(KEY, http_client=client).check())
    assert not status.ok and "429" in status.message and "через 7 с" in status.message
    assert calls == [1]


def test_gemini_invalid_key_400_reads_as_rejected_key() -> None:
    """Gemini отвечает на неверный ключ 400 INVALID_ARGUMENT, а не 401."""

    def handler(request: httpx.Request) -> httpx.Response:
        error = {
            "code": 400,
            "message": "API key not valid. Please pass a valid API key.",
            "status": "INVALID_ARGUMENT",
            "details": [
                {"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "API_KEY_INVALID"}
            ],
        }
        return httpx.Response(**_json(400, {"error": error}))

    def status_for(key: str) -> str:
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        status = asyncio.run(GeminiProvider(SecretStr(key), http_client=client).check())
        assert not status.ok
        return status.message

    base = (
        "Gemini: ключ не принят (401): API key not valid. Please pass a valid API key."
        " Проверьте ключ в backend/.env — см. docs/api_keys.md."
    )
    assert status_for("AIza" + "x" * 35) == base
    # Частая ошибка — вставить ID проекта AI Studio вместо ключа: подсказка, куда смотреть.
    assert status_for("gen-lang-client-0123456789").startswith(base)
    assert "возможно, там ID проекта" in status_for("gen-lang-client-0123456789")


def test_elevenlabs_missing_permission_reads_as_no_access() -> None:
    """Верный ключ без права `user_read` ElevenLabs отвечает 401 missing_permissions."""

    def handler(request: httpx.Request) -> httpx.Response:
        detail = {
            "status": "missing_permissions",
            "message": "The API key you used is missing the permission user_read.",
        }
        return httpx.Response(**_json(401, {"detail": detail}))

    status = asyncio.run(ElevenLabsProvider(KEY, transport=httpx.MockTransport(handler)).check())
    assert "нет доступа (403): missing_permissions" in status.message
    assert "user_read. Проверьте права ключа" in status.message


class CountingProvider:
    """Считает проверки ключа — для кэша `GET /api/providers/status`."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.checks = 0

    async def check(self, expected_models: Any = ()) -> KeyStatus:
        self.checks += 1
        quota = CharQuota(tier="creator", used_chars=1, limit_chars=10, resets_at=None)
        return KeyStatus(provider=self.name, configured=True, ok=True, message="ok", quota=quota)


def test_providers_status_endpoint_caches_and_refreshes(app: FastAPI) -> None:
    gateway: Gateway = app.state.gateway
    fakes = {name: CountingProvider(name) for name in ("anthropic", "gemini", "elevenlabs")}
    gateway.registry.providers.update(fakes)  # type: ignore[arg-type]
    with TestClient(app) as client:
        first = client.get("/api/providers/status").json()
        assert [s["provider"] for s in first] == ["anthropic", "elevenlabs", "gemini"]
        assert first[1]["quota"]["limit_chars"] == 10
        client.get("/api/providers/status")  # из памяти, без запросов к провайдерам
        assert [f.checks for f in fakes.values()] == [1, 1, 1]
        client.get("/api/providers/status", params={"refresh": "true"})
        assert [f.checks for f in fakes.values()] == [2, 2, 2]
