"""Маршрутизация «этап → профиль качества → провайдер → модель» из `config/providers.yaml`.

Каталог этапа — разрешённые модели; профиль качества выбирает модель по умолчанию; выбор
пользователя (пачка, кадр) — `override` из того же каталога. Профиль меняет только маршрут:
ID моделей живут в конфиге, не в коде (принцип 5). Конфиг проверяется при старте: запрещённая
модель, неизвестный провайдер, профиль мимо каталога — `ConfigError`, приложение не поднимается.
Правила — `docs/providers.md`.
"""

import fnmatch
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any, Literal, get_args

import yaml
from pydantic import Field, ValidationError, model_validator

from app.models.director import StrictModel
from app.providers.base import ConfigError, Provider, RequestKind, Route, RouteError

Profile = Literal["economy", "standard", "premium"]
PROFILES: tuple[Profile, ...] = get_args(Profile)


class CatalogEntry(StrictModel):
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    params: dict[str, Any] = Field(default_factory=dict)


class StageConfig(StrictModel):
    kind: RequestKind
    catalog: dict[str, CatalogEntry] = Field(min_length=1)
    profiles: dict[Profile, str]

    @model_validator(mode="after")
    def _profiles_in_catalog(self) -> "StageConfig":
        missing = [profile for profile in PROFILES if profile not in self.profiles]
        if missing:
            raise ValueError(f"profiles {missing} are not set")
        for profile, key in self.profiles.items():
            if key not in self.catalog:
                raise ValueError(f"profile {profile!r} points to {key!r}, not in catalog")
        return self


class ProvidersConfig(StrictModel):
    default_profile: Profile
    forbidden_models: list[str] = Field(min_length=1)
    stages: dict[str, StageConfig] = Field(min_length=1)

    @model_validator(mode="after")
    def _no_forbidden_models(self) -> "ProvidersConfig":
        for stage, config in self.stages.items():
            for key, entry in config.catalog.items():
                pattern = forbidden_match(entry.model, self.forbidden_models)
                if pattern is not None:
                    raise ValueError(
                        f"stage {stage!r}, catalog {key!r}: model {entry.model!r} is forbidden"
                        f" by {pattern!r} (CLAUDE.md, «Чего не делать»)"
                    )
        return self


def forbidden_match(model: str, patterns: list[str]) -> str | None:
    """Шаблон fnmatch без учёта регистра, под который попала модель, или None."""
    for pattern in patterns:
        if fnmatch.fnmatchcase(model.lower(), pattern.lower()):
            return pattern
    return None


def load_providers_config(path: Path) -> ProvidersConfig:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise ConfigError(f"Не прочитать маршруты провайдеров {path}: {exc}") from exc
    try:
        return ProvidersConfig.model_validate(raw)
    except ValidationError as exc:
        raise ConfigError(
            f"{path}: конфиг провайдеров некорректен: {exc.errors(include_url=False)}"
        ) from exc


class Registry:
    """Маршруты этапов и экземпляры провайдеров."""

    def __init__(self, config: ProvidersConfig, providers: Mapping[str, Provider]) -> None:
        self.config = config
        self.providers = dict(providers)
        for route in self.routes():
            if route.provider not in self.providers:
                known = ", ".join(sorted(self.providers))
                raise ConfigError(
                    f"config/providers.yaml: этап «{route.stage}/{route.key}» ведёт к провайдеру"
                    f" «{route.provider}», а в коде есть только: {known}."
                )

    def stage(self, stage: str) -> StageConfig:
        config = self.config.stages.get(stage)
        if config is None:
            known = ", ".join(sorted(self.config.stages))
            raise RouteError(f"Этапа «{stage}» нет в config/providers.yaml. Есть: {known}.")
        return config

    def resolve(
        self, stage: str, profile: Profile | None = None, override: str | None = None
    ) -> Route:
        """Маршрут этапа: `override` (ключ каталога или ID модели) важнее профиля качества."""
        config = self.stage(stage)
        if override is None:
            key = config.profiles[profile or self.config.default_profile]
        else:
            key = self._catalog_key(stage, config, override)
        return self._route(stage, key, config)

    def routes(self) -> Iterator[Route]:
        for stage, config in self.config.stages.items():
            for key in config.catalog:
                yield self._route(stage, key, config)

    def provider(self, name: str) -> Provider:
        return self.providers[name]

    def models_of(self, provider: str) -> set[str]:
        return {route.model for route in self.routes() if route.provider == provider}

    def _catalog_key(self, stage: str, config: StageConfig, override: str) -> str:
        if override in config.catalog:
            return override
        keys = [key for key, entry in config.catalog.items() if entry.model == override]
        if len(keys) == 1:
            return keys[0]
        known = ", ".join(f"{key} ({entry.model})" for key, entry in config.catalog.items())
        if keys:
            raise RouteError(
                f"Модель «{override}» в каталоге этапа «{stage}» встречается несколько раз —"
                f" укажите ключ каталога: {known}."
            )
        raise RouteError(
            f"Модели «{override}» нет в каталоге этапа «{stage}». Доступны: {known}. Новая"
            " модель добавляется в config/providers.yaml вместе с ценой в config/pricing.yaml."
        )

    @staticmethod
    def _route(stage: str, key: str, config: StageConfig) -> Route:
        entry = config.catalog[key]
        return Route(
            stage=stage,
            key=key,
            kind=config.kind,
            provider=entry.provider,
            model=entry.model,
            params=dict(entry.params),
        )
