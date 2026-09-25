"""Провайдеры: состояние ключей и квота символов ElevenLabs для шапки (`docs/providers.md`)."""

from fastapi import APIRouter

from app.api.deps import GatewayDep
from app.providers.base import KeyStatus
from app.providers.gateway import KEY_STATUS_TTL_S

router = APIRouter(tags=["providers"])


@router.get("/providers/status")
async def providers_status(gateway: GatewayDep, refresh: bool = False) -> list[KeyStatus]:
    """Ключ задан и принят ли, модели из конфига видны ли ключу, остаток символов ElevenLabs.
    Проверка — бесплатные запросы к провайдерам; ответ держится `KEY_STATUS_TTL_S` секунд,
    `?refresh=true` проверяет заново (например, после пачки озвучки)."""
    return await gateway.check_keys(max_age_s=0 if refresh else KEY_STATUS_TTL_S)
