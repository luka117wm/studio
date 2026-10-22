"""Провайдеры: состояние ключей и квота символов ElevenLabs для шапки, каталог моделей этапа для
выбора модели на экране (`docs/providers.md`)."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.api.deps import GatewayDep
from app.cost.pricing import Money, format_unit_usd
from app.providers.base import UNITS_BY_KIND, KeyStatus, RequestKind, RouteError, Unit, Usage
from app.providers.gateway import KEY_STATUS_TTL_S

router = APIRouter(tags=["providers"])


class CatalogModel(BaseModel):
    """Модель каталога этапа: ключ — то, что уходит в `model` заказа; цена — одной единицы."""

    key: str
    label: str  # подпись из `config/providers.yaml`; нет — ключ
    model: str  # ID модели провайдера
    unit: Unit  # первая единица вида: картинка, символ, секунда; у текста — входной токен
    price: Money  # цена одной единицы по `config/pricing.yaml`, до десятых цента


class StageCatalog(BaseModel):
    """Каталог этапа для выбора модели (полоса выбора экрана «Генерация», M6.8)."""

    stage: str
    kind: RequestKind
    default: str  # ключ каталога профиля качества по умолчанию
    models: list[CatalogModel]


@router.get("/providers/status")
async def providers_status(gateway: GatewayDep, refresh: bool = False) -> list[KeyStatus]:
    """Ключ задан и принят ли, модели из конфига видны ли ключу, остаток символов ElevenLabs.
    Проверка — бесплатные запросы к провайдерам; ответ держится `KEY_STATUS_TTL_S` секунд,
    `?refresh=true` проверяет заново (например, после пачки озвучки)."""
    return await gateway.check_keys(max_age_s=0 if refresh else KEY_STATUS_TTL_S)


@router.get("/providers/catalog/{stage}")
async def stage_catalog(stage: str, gateway: GatewayDep) -> StageCatalog:
    """Модели этапа в порядке каталога: ключ, подпись, ID и цена единицы. Цены — только из
    `config/pricing.yaml` той же функцией, что смета (принцип 5). Нет этапа — 404."""
    registry = gateway.registry
    try:
        config = registry.stage(stage)
    except RouteError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    unit = UNITS_BY_KIND[config.kind][0]
    models = []
    for key, entry in config.catalog.items():
        route = registry.resolve(stage, override=key)
        cost = gateway.pricing.cost(route, [Usage(unit=unit, quantity=1)])
        models.append(
            CatalogModel(
                key=key,
                label=entry.label or key,
                model=entry.model,
                unit=unit,
                price=Money(usd_micro=cost.usd_micro, usd=format_unit_usd(cost.usd_micro)),
            )
        )
    return StageCatalog(
        stage=stage,
        kind=config.kind,
        default=config.profiles[registry.config.default_profile],
        models=models,
    )
