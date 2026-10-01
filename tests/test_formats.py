"""Пресеты формата и смета выпуска. Ожидаемые суммы считаются прямо из YAML — не кодом gateway."""

import shutil
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from app.main import create_app
from app.providers.base import ConfigError
from app.settings import REPO_ROOT, Settings
from app.storage.db import connect
from app.storage.paths import StudioPaths
from app.tools.seed import seed

CONFIG = REPO_ROOT / "config"
# Параметр маршрута, выбирающий вариант цены единицы.
VARIANT = {"image": "size", "second": "resolution"}


def copy_config(tmp_path: Path) -> Path:
    config = tmp_path / "config"
    shutil.copytree(CONFIG, config)
    return config


def edit_yaml(path: Path, change: Callable[[Any], None]) -> None:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    change(data)
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")


@contextmanager
def seeded_client(tmp_path: Path, config: Path) -> Iterator[TestClient]:
    settings = Settings(_env_file=None, studio_data_dir=tmp_path / "data", config_dir=config)
    with TestClient(create_app(settings)) as client:
        paths = StudioPaths(settings.studio_data_dir)
        conn = connect(paths.db_path)
        try:
            seed(paths, conn)
        finally:
            conn.close()
        yield client


def expected(config: Path, channel_format: str) -> dict[str, tuple[str, int]]:
    """Этап → (модель, микродоллары) по маршруту профиля по умолчанию и прайсу."""
    providers = yaml.safe_load((config / "providers.yaml").read_text(encoding="utf-8"))
    pricing = yaml.safe_load((config / "pricing.yaml").read_text(encoding="utf-8"))
    formats = yaml.safe_load((config / "formats.yaml").read_text(encoding="utf-8"))
    preset = formats["formats"][channel_format]
    volumes = formats["estimate"]
    words = preset["minutes"]["target"] * preset["words_per_minute"]
    usage = {
        "script": {
            "token_in": volumes["script_input_tokens"],
            "token_out": words * volumes["script_output_tokens_per_word"],
        },
        "images": {"image": 1},
        "voice": {"char": words * volumes["voice_chars_per_word"]},
    }
    calls = {"script": 1, "images": preset["shots"], "voice": 1}
    out: dict[str, tuple[str, int]] = {}
    for stage, units in usage.items():
        config_stage = providers["stages"][stage]
        entry = config_stage["catalog"][config_stage["profiles"][providers["default_profile"]]]
        prices = pricing[entry["provider"]][entry["model"]]["prices"]
        total = 0
        for unit, quantity in units.items():
            price = prices[unit]
            usd = (
                Decimal(price["variants"][entry["params"][VARIANT[unit]]])
                if "variants" in price
                else Decimal(price["usd"])
            )
            micro = usd * 1_000_000 * Decimal(quantity) / Decimal(price.get("per", 1))
            total += int(micro.quantize(Decimal(1), rounding=ROUND_HALF_UP))
        out[stage] = (entry["model"], total * calls[stage])
    return out


@pytest.mark.parametrize(
    ("channel", "channel_format"), [("cursus", "every_rank"), ("otto", "host")]
)
def test_estimate_is_sum_of_stage_estimates(
    tmp_path: Path, channel: str, channel_format: str
) -> None:
    with seeded_client(tmp_path, CONFIG) as client:
        response = client.get("/api/formats", params={"channel": channel})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["channel"] == channel
    assert body["format"] == channel_format

    want = expected(CONFIG, channel_format)
    got = {cost["stage"]: (cost["model"], cost["usd_micro"]) for cost in body["estimate"]["stages"]}
    assert got == want
    assert body["estimate"]["usd_micro"] == sum(micro for _, micro in want.values())
    for cost in body["estimate"]["stages"]:
        assert cost["usd_micro"] == sum(line["usd_micro"] for line in cost["lines"])
    assert isinstance(body["stale_pricing"], bool)


def test_cursus_preset_matches_artboard(tmp_path: Path) -> None:
    with seeded_client(tmp_path, CONFIG) as client:
        body = client.get("/api/formats", params={"channel": "cursus"}).json()
        otto = client.get("/api/formats", params={"channel": "otto"}).json()
    assert body["preset"] == {
        "label": "every rank",
        "hint": "Рассказчик во втором лице",
        "minutes": {"min": 18, "target": 20, "max": 25},
        "sections": 8,
        "shots": 100,
        "words_per_minute": 150,
    }
    images = next(c for c in body["estimate"]["stages"] if c["stage"] == "images")
    assert images["lines"][0]["quantity"] == 100
    assert (otto["preset"]["minutes"]["min"], otto["preset"]["minutes"]["max"]) == (6, 10)
    assert (otto["preset"]["sections"], otto["preset"]["shots"]) == (5, 40)


def test_profile_switch_changes_sum_without_code(tmp_path: Path) -> None:
    config = copy_config(tmp_path)
    standard = expected(config, "every_rank")
    edit_yaml(config / "providers.yaml", lambda data: data.update(default_profile="premium"))
    premium = expected(config, "every_rank")
    assert premium != standard

    with seeded_client(tmp_path, config) as client:
        body = client.get("/api/formats", params={"channel": "cursus"}).json()
    got = {cost["stage"]: (cost["model"], cost["usd_micro"]) for cost in body["estimate"]["stages"]}
    assert got == premium
    assert body["estimate"]["usd_micro"] == sum(micro for _, micro in premium.values())


def test_unknown_or_unseeded_channel(tmp_path: Path) -> None:
    settings = Settings(_env_file=None, studio_data_dir=tmp_path / "data")
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/formats", params={"channel": "cursus"}).status_code == 404
        assert client.get("/api/formats", params={"channel": "vlog"}).status_code == 422
        assert client.get("/api/formats").status_code == 422


@pytest.mark.parametrize(
    ("change", "match"),
    [
        (lambda d: d["formats"]["every_rank"]["minutes"].update(min=30), "min ≤ target ≤ max"),
        (lambda d: d["formats"].pop("host"), "нет пресета для формата: host"),
        (lambda d: d["formats"].update(vlog=d["formats"]["host"]), "vlog"),
        (lambda d: d["estimate"].pop("voice_chars_per_word"), "voice_chars_per_word"),
    ],
)
def test_bad_formats_config_is_startup_error(
    tmp_path: Path, change: Callable[[Any], None], match: str
) -> None:
    config = copy_config(tmp_path)
    edit_yaml(config / "formats.yaml", change)
    settings = Settings(_env_file=None, studio_data_dir=tmp_path / "data", config_dir=config)
    with pytest.raises(ConfigError, match=match):
        create_app(settings)


def test_unreadable_formats_config_is_startup_error(tmp_path: Path) -> None:
    config = copy_config(tmp_path)
    (config / "formats.yaml").write_text("formats: [", encoding="utf-8")
    settings = Settings(_env_file=None, studio_data_dir=tmp_path / "data", config_dir=config)
    with pytest.raises(ConfigError, match="Не прочитать пресеты формата"):
        create_app(settings)
