"""ElevenLabs (голос — M7): пока только оценка и проверка ключа с квотой символов.

Пакет символов один на аккаунт и общий для голоса и видео, поэтому остаток берётся из
`/v1/user/subscription`, а не из профиля канала. Ключу нужно право User (чтение подписки).
"""

from collections.abc import Collection
from datetime import UTC, datetime
from typing import Any

import httpx
from pydantic import SecretStr

from app.jobs.worker import TransientError
from app.providers.base import (
    AnyRequest,
    CharQuota,
    KeyStatus,
    Result,
    Route,
    RouteError,
    SpeechRequest,
    Usage,
    parse_retry_after,
    request_usage,
    status_error,
)

TITLE = "ElevenLabs"
BASE_URL = "https://api.elevenlabs.io"
CHECK_TIMEOUT_S = 30.0


class ElevenLabsProvider:
    name = "elevenlabs"

    def __init__(
        self, api_key: SecretStr, *, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._api_key = api_key
        self._transport = transport  # тесты подменяют транспорт

    def usage(self, route: Route, request: AnyRequest) -> list[Usage]:
        if not isinstance(request, SpeechRequest):
            raise RouteError(f"{TITLE} в этом этапе принимает только голос, а не «{request.kind}».")
        return request_usage(request)

    async def call(self, route: Route, request: AnyRequest) -> Result:
        raise NotImplementedError("Голос ElevenLabs появится в модуле голоса (M7).")

    async def check(self, expected_models: Collection[str] = ()) -> KeyStatus:
        """Подписка: тариф и остаток символов для шапки. Модели голоса этим вызовом не видны."""
        key = self._api_key.get_secret_value()
        if not key:
            return KeyStatus(
                provider=self.name,
                configured=False,
                ok=False,
                message="ELEVENLABS_API_KEY не задан в backend/.env — см. docs/api_keys.md.",
            )
        async with httpx.AsyncClient(
            base_url=BASE_URL,
            headers={"xi-api-key": key},
            timeout=CHECK_TIMEOUT_S,
            transport=self._transport,
        ) as client:
            try:
                response = await client.get("/v1/user/subscription")
            except httpx.TransportError as exc:
                offline = TransientError(f"{TITLE}: нет соединения: {exc}")
                return KeyStatus(
                    provider=self.name, configured=True, ok=False, message=str(offline)
                )
        if response.status_code >= 400:
            detail = _detail(response)
            # Ключ верный, но без права (`user_read` и т. п.) — ElevenLabs отвечает 401.
            missing = detail.startswith("missing_permissions")
            error = status_error(
                TITLE,
                403 if missing else response.status_code,
                detail,
                parse_retry_after(response.headers.get("retry-after")),
            )
            return KeyStatus(provider=self.name, configured=True, ok=False, message=str(error))
        quota = _quota(response.json())
        return KeyStatus(
            provider=self.name,
            configured=True,
            ok=True,
            message=(
                f"ключ принят, тариф {quota.tier or '—'}: осталось {quota.remaining_chars}"
                f" из {quota.limit_chars} символов"
            ),
            quota=quota,
        )


def _quota(data: dict[str, Any]) -> CharQuota:
    reset = data.get("next_character_count_reset_unix")
    return CharQuota(
        tier=data.get("tier"),
        used_chars=int(data.get("character_count") or 0),
        limit_chars=int(data.get("character_limit") or 0),
        resets_at=(
            datetime.fromtimestamp(int(reset), UTC).isoformat(timespec="seconds") if reset else None
        ),
    )


def _detail(response: httpx.Response) -> str:
    """ElevenLabs отдаёт `{"detail": {"status": …, "message": …}}` или `{"detail": "…"}`."""
    try:
        detail = response.json().get("detail")
    except ValueError:
        return response.text[:300]
    if isinstance(detail, dict):
        parts = [str(detail.get(k)) for k in ("status", "message") if detail.get(k)]
        return ": ".join(parts)
    return str(detail or "")
