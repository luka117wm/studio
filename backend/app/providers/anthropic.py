"""Anthropic (сценарий, план, исследование — M4): пока только оценка и проверка ключа.

Только API-ключ из `backend/.env`: подписка Claude и профили `ant auth` из кода не используются
(`CLAUDE.md`, «Чего не делать»). SDK без собственных повторов (`max_retries=0`).
"""

from collections.abc import Collection

import anthropic
import httpx2
from pydantic import SecretStr

from app.jobs.worker import TransientError
from app.providers.base import (
    AnyRequest,
    KeyStatus,
    Result,
    Route,
    RouteError,
    TextRequest,
    Usage,
    parse_retry_after,
    request_usage,
    status_error,
)

TITLE = "Anthropic"
CHECK_TIMEOUT_S = 30.0


class AnthropicProvider:
    name = "anthropic"

    def __init__(
        self, api_key: SecretStr, *, http_client: httpx2.AsyncClient | None = None
    ) -> None:
        self._api_key = api_key
        self._http_client = http_client  # тесты подменяют транспорт

    def usage(self, route: Route, request: AnyRequest) -> list[Usage]:
        if not isinstance(request, TextRequest):
            raise RouteError(f"{TITLE} принимает только текстовые запросы, а не «{request.kind}».")
        return request_usage(request)

    async def call(self, route: Route, request: AnyRequest) -> Result:
        raise NotImplementedError("Вызовы Anthropic появятся в модуле сценария (M4).")

    async def check(self, expected_models: Collection[str] = ()) -> KeyStatus:
        """Список моделей — бесплатно; заодно видно, что модели из конфига доступны ключу."""
        key = self._api_key.get_secret_value()
        if not key:
            return KeyStatus(
                provider=self.name,
                configured=False,
                ok=False,
                message="ANTHROPIC_API_KEY не задан в backend/.env — см. docs/api_keys.md.",
            )
        client = anthropic.AsyncAnthropic(
            api_key=key,
            max_retries=0,
            timeout=CHECK_TIMEOUT_S,
            http_client=self._http_client,
        )
        try:
            ids = {model.id async for model in client.models.list(limit=1000)}
        except anthropic.APIStatusError as exc:
            error = status_error(
                TITLE,
                exc.status_code,
                exc.message,
                parse_retry_after(exc.response.headers.get("retry-after")),
            )
            return KeyStatus(provider=self.name, configured=True, ok=False, message=str(error))
        except anthropic.APIConnectionError as exc:
            error = TransientError(f"{TITLE}: нет соединения: {exc}")
            return KeyStatus(provider=self.name, configured=True, ok=False, message=str(error))
        finally:
            await client.close()
        return KeyStatus(
            provider=self.name,
            configured=True,
            ok=True,
            message=f"ключ принят, моделей доступно: {len(ids)}",
            missing_models=sorted(set(expected_models) - ids),
        )
