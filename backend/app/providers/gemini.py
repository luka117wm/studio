"""Google Gemini (кадры — M6, анимация Veo — M8): пока только оценка и проверка ключа.

Клиент без собственных повторов (`HttpRetryOptions(attempts=1)`): повторяет очередь.
"""

import json
from collections.abc import Collection

import httpx
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import SecretStr

from app.jobs.worker import TransientError
from app.providers.base import (
    AnyRequest,
    ImageRequest,
    KeyStatus,
    Result,
    Route,
    RouteError,
    Usage,
    VideoRequest,
    parse_retry_after,
    request_usage,
    status_error,
)

TITLE = "Gemini"
CHECK_TIMEOUT_MS = 30_000


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: SecretStr, *, http_client: httpx.AsyncClient | None = None) -> None:
        self._api_key = api_key
        self._http_client = http_client  # тесты подменяют транспорт

    def usage(self, route: Route, request: AnyRequest) -> list[Usage]:
        if not isinstance(request, ImageRequest | VideoRequest):
            raise RouteError(f"{TITLE} принимает кадры и видео, а не «{request.kind}».")
        return request_usage(request)

    async def call(self, route: Route, request: AnyRequest) -> Result:
        raise NotImplementedError("Кадры Gemini — модуль генерации (M6), анимация Veo — M8.")

    async def check(self, expected_models: Collection[str] = ()) -> KeyStatus:
        """Список моделей — бесплатно; заодно видно, что модели из конфига доступны ключу."""
        key = self._api_key.get_secret_value()
        if not key:
            return KeyStatus(
                provider=self.name,
                configured=False,
                ok=False,
                message="GEMINI_API_KEY не задан в backend/.env — см. docs/api_keys.md.",
            )
        options = types.HttpOptions(
            timeout=CHECK_TIMEOUT_MS,
            retry_options=types.HttpRetryOptions(attempts=1),
            httpx_async_client=self._http_client,
        )
        client = genai.Client(api_key=key, http_options=options).aio
        try:
            pager = await client.models.list(config={"page_size": 1000})
            names = {model.name.removeprefix("models/") async for model in pager if model.name}
        except genai_errors.APIError as exc:
            headers = getattr(exc.response, "headers", None)
            retry_after = parse_retry_after(headers.get("retry-after") if headers else None)
            status = _status(exc)
            message = str(status_error(TITLE, status, exc.message or str(exc), retry_after))
            if status == 401 and not key.startswith("AIza"):
                message += (
                    " Значение в GEMINI_API_KEY не похоже на ключ Google (он начинается с AIza,"
                    " 39 символов) — возможно, там ID проекта (gen-lang-client-…)."
                )
            return KeyStatus(provider=self.name, configured=True, ok=False, message=message)
        except httpx.TransportError as exc:
            error = TransientError(f"{TITLE}: нет соединения: {exc}")
            return KeyStatus(provider=self.name, configured=True, ok=False, message=str(error))
        finally:
            await client.aclose()
        return KeyStatus(
            provider=self.name,
            configured=True,
            ok=True,
            message=f"ключ принят, моделей доступно: {len(names)}",
            missing_models=sorted(set(expected_models) - names),
        )


def _status(exc: genai_errors.APIError) -> int:
    """Неверный ключ Gemini отвечает 400 INVALID_ARGUMENT (reason API_KEY_INVALID), а не 401."""
    if exc.code == 400 and "API_KEY_INVALID" in json.dumps(exc.details, default=str):
        return 401
    return exc.code
