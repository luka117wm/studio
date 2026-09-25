"""Живая проверка ключей (M2.6): `uv run pytest -m live -v -rP` — запросы бесплатные.

Ключи — из `backend/.env` (docs/api_keys.md). Без ключа — skip с причиной, не fail. У Anthropic и
Gemini заодно проверяется, что модели из config/providers.yaml видны ключу: смена ID модели у
провайдера всплывёт здесь, а не на первой генерации. ElevenLabs показывает остаток символов.
"""

import asyncio
from pathlib import Path

import pytest

from app.providers.gateway import Gateway, build_gateway
from app.settings import Settings
from app.storage.paths import StudioPaths

pytestmark = pytest.mark.live


@pytest.fixture(scope="module")
def gateway(tmp_path_factory: pytest.TempPathFactory) -> Gateway:
    data: Path = tmp_path_factory.mktemp("data")
    settings = Settings(studio_data_dir=data)  # ключи — из настоящего backend/.env
    return build_gateway(settings, StudioPaths(data))


@pytest.mark.parametrize("provider", ["anthropic", "gemini", "elevenlabs"])
def test_key_is_accepted(gateway: Gateway, provider: str) -> None:
    expected = gateway.registry.models_of(provider)
    status = asyncio.run(gateway.registry.provider(provider).check(expected))
    if not status.configured:
        pytest.skip(status.message)
    print(f"{provider}: {status.message}")  # видно с `-rP`
    assert status.ok, status.message
    assert status.missing_models == [], (
        f"{provider}: ключ не видит модели из config/providers.yaml: {status.missing_models}"
    )
