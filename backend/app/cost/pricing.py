"""Прайс `config/pricing.yaml` и расчёт стоимости — единственная точка расчёта (L-001).

Цена — USD десятичной строкой за `per` единиц. Накопление — целые микродоллары: одно округление
до микродоллара на строку журнала (ROUND_HALF_UP), до центов — только `format_usd` на выходе
API. Оценка до вызова и факт после вызова считаются одной функцией — `Pricing.cost`.
"""

import logging
from collections.abc import Sequence
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from app.models.director import StrictModel
from app.providers.base import (
    UNITS_BY_KIND,
    VARIANT_PARAM,
    ConfigError,
    Cost,
    CostLine,
    Route,
    Unit,
    Usage,
)

log = logging.getLogger(__name__)

MICRO = Decimal(1_000_000)


def _decimal_from_text(value: Any) -> Any:
    """Цены в YAML — строкой в кавычках: float теряет точность ещё до Decimal."""
    if isinstance(value, float):
        raise ValueError(f'price {value!r} must be a quoted string, e.g. "{value}"')
    return value


class PriceEntry(StrictModel):
    """Цена единицы: одна (`usd`) или по вариантам (`variants`: разрешение → цена)."""

    usd: Decimal | None = Field(default=None, ge=0)
    variants: dict[str, Decimal] = Field(default_factory=dict)
    per: int = Field(default=1, gt=0)

    @field_validator("usd", mode="before")
    @classmethod
    def _check_usd(cls, value: Any) -> Any:
        return _decimal_from_text(value)

    @field_validator("variants", mode="before")
    @classmethod
    def _check_variants(cls, value: Any) -> Any:
        if isinstance(value, dict):
            for price in value.values():
                _decimal_from_text(price)
        return value

    @model_validator(mode="after")
    def _one_kind(self) -> "PriceEntry":
        if (self.usd is None) == (not self.variants):
            raise ValueError("set either `usd` or `variants`, not both")
        if any(price < 0 for price in self.variants.values()):
            raise ValueError("variant prices must be >= 0")
        return self


class ModelPrice(StrictModel):
    checked_at: date
    source: str = Field(min_length=1)
    prices: dict[Unit, PriceEntry] = Field(min_length=1)


class StalePrice(BaseModel):
    provider: str
    model: str
    checked_at: date
    age_days: int


def usd_to_micro(value: Decimal | float | int) -> int:
    """Лимит в USD из профиля канала → микродоллары (через str: float не тащит хвост)."""
    return _round_micro(Decimal(str(value)) * MICRO)


def _round_micro(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def format_usd(micro: int) -> str:
    """Микродоллары → «$151.20», «$150»; только для ответов API, в журнале — микродоллары."""
    sign = "-" if micro < 0 else ""
    cents = (Decimal(abs(micro)) / MICRO).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if micro and not cents:
        return f"{sign}<$0.01"
    if cents == cents.to_integral_value():
        return f"{sign}${int(cents)}"
    return f"{sign}${cents}"


def today_utc() -> date:
    return datetime.now(UTC).date()


class Pricing:
    """Прайс: провайдер → модель → единица → цена."""

    def __init__(self, table: dict[str, dict[str, ModelPrice]], *, stale_days: int) -> None:
        self.table = table
        self.stale_days = stale_days

    @classmethod
    def load(cls, path: Path, *, stale_days: int) -> "Pricing":
        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        except (OSError, yaml.YAMLError) as exc:
            raise ConfigError(f"Не прочитать прайс {path}: {exc}") from exc
        if not isinstance(raw, dict):
            raise ConfigError(f"{path}: ожидается словарь «провайдер → модель → цена».")
        table: dict[str, dict[str, ModelPrice]] = {}
        for provider, models in raw.items():
            if not isinstance(models, dict):
                raise ConfigError(f"{path}: у провайдера «{provider}» ожидается словарь моделей.")
            table[str(provider)] = {}
            for model, entry in models.items():
                try:
                    table[str(provider)][str(model)] = ModelPrice.model_validate(entry)
                except ValidationError as exc:
                    raise ConfigError(
                        f"{path}: цена {provider}/{model} некорректна:"
                        f" {exc.errors(include_url=False)}"
                    ) from exc
        return cls(table, stale_days=stale_days)

    # --- проверка маршрутов при старте --------------------------------------------------------

    def check_route(self, route: Route) -> None:
        """У каждой модели каталога должна быть цена всех её единиц — иначе нет «цены до клика»."""
        price = self._model_price(route)
        for unit in UNITS_BY_KIND[route.kind]:
            if unit not in price.prices:
                raise ConfigError(
                    f"config/pricing.yaml: у {route.provider}/{route.model} нет цены за «{unit}»"
                    f" (этап «{route.stage}»). Добавьте цену с checked_at и source."
                )
            self._unit_price(route, price, unit)

    # --- расчёт -------------------------------------------------------------------------------

    def cost(self, route: Route, usage: Sequence[Usage], today: date | None = None) -> Cost:
        """Единицы → деньги: строка на единицу, микродоллары округляются один раз на строку."""
        price = self._model_price(route)
        lines: list[CostLine] = []
        for item in usage:
            usd, per, variant = self._unit_price(route, price, item.unit)
            micro = _round_micro(usd * MICRO * Decimal(str(item.quantity)) / per)
            lines.append(
                CostLine(unit=item.unit, quantity=item.quantity, variant=variant, usd_micro=micro)
            )
        return Cost(
            stage=route.stage,
            provider=route.provider,
            model=route.model,
            lines=lines,
            usd_micro=sum(line.usd_micro for line in lines),
            stale_pricing=self._age_days(price, today) > self.stale_days,
        )

    def stale(self, today: date | None = None) -> list[StalePrice]:
        out: list[StalePrice] = []
        for provider, models in self.table.items():
            for model, price in models.items():
                age = self._age_days(price, today)
                if age > self.stale_days:
                    out.append(
                        StalePrice(
                            provider=provider,
                            model=model,
                            checked_at=price.checked_at,
                            age_days=age,
                        )
                    )
        return out

    def _age_days(self, price: ModelPrice, today: date | None) -> int:
        return ((today or today_utc()) - price.checked_at).days

    def _model_price(self, route: Route) -> ModelPrice:
        price = self.table.get(route.provider, {}).get(route.model)
        if price is None:
            raise ConfigError(
                f"config/pricing.yaml: нет цены модели {route.provider}/{route.model}"
                f" (этап «{route.stage}»). Добавьте цену с checked_at и source."
            )
        return price

    def _unit_price(
        self, route: Route, price: ModelPrice, unit: Unit
    ) -> tuple[Decimal, int, str | None]:
        entry = price.prices.get(unit)
        if entry is None:
            raise ConfigError(
                f"config/pricing.yaml: у {route.provider}/{route.model} нет цены за «{unit}»."
            )
        if entry.usd is not None:
            return entry.usd, entry.per, None
        param = VARIANT_PARAM.get(unit)
        variant = None if param is None else route.params.get(param)
        if variant is None or str(variant) not in entry.variants:
            known = ", ".join(sorted(entry.variants))
            raise ConfigError(
                f"Цена {route.provider}/{route.model} за «{unit}» задана вариантами ({known}),"
                f" а у маршрута «{route.stage}/{route.key}» параметр «{param}» = {variant!r}."
            )
        return entry.variants[str(variant)], entry.per, str(variant)
