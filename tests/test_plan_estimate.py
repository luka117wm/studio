"""M4.6: смета действующего плана. Ожидаемые суммы считаются прямо из YAML — не кодом gateway."""

import json
import math
import shutil
from collections.abc import Iterator
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from app.cost import ledger
from app.cost.ledger import LedgerContext
from app.cost.pricing import format_unit_usd, format_usd
from app.models.channel import Budgets
from app.models.episode_summary import count_words
from app.models.formats import load_formats
from app.pipeline.director_import import EffectivePlan
from app.pipeline.script.estimate import BRIDGE_MODEL, plan_estimate
from app.providers.base import Cost, CostLine
from app.providers.gateway import build_gateway
from app.settings import REPO_ROOT, Settings
from app.storage.atomic import read_json, write_json_atomic
from app.storage.db import connect
from app.storage.paths import StudioPaths
from app.tools.seed import seed

CONFIG = REPO_ROOT / "config"
FIXTURES = Path(__file__).parent / "fixtures"
EPISODE = "c07-pirate-ship"
DIRECTOR_URL = f"/api/projects/{EPISODE}/director"
ESTIMATE_URL = f"/api/projects/{EPISODE}/estimate"
PLAN_URL = f"/api/projects/{EPISODE}/plan"
# Параметр маршрута, выбирающий вариант цены единицы.
VARIANT = {"image": "size", "second": "resolution"}
NBSP = " "


def load(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return data


def call_price(config: Path, stage: str, unit: str, quantity: float) -> tuple[str, int]:
    """(модель, микродоллары) одного вызова этапа по маршруту профиля по умолчанию."""
    providers = yaml.safe_load((config / "providers.yaml").read_text(encoding="utf-8"))
    pricing = yaml.safe_load((config / "pricing.yaml").read_text(encoding="utf-8"))
    stage_cfg = providers["stages"][stage]
    entry = stage_cfg["catalog"][stage_cfg["profiles"][providers["default_profile"]]]
    price = pricing[entry["provider"]][entry["model"]]["prices"][unit]
    usd = (
        Decimal(price["variants"][entry["params"][VARIANT[unit]]])
        if "variants" in price
        else Decimal(price["usd"])
    )
    micro = usd * 1_000_000 * Decimal(quantity) / Decimal(price.get("per", 1))
    return entry["model"], int(micro.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def vo_of(plan: dict[str, Any], overrides: dict[str, str] | None = None) -> list[str]:
    overrides = overrides or {}
    return [overrides.get(shot["id"], shot["vo"]) for shot in plan["shots"]]


@pytest.fixture
def paths(settings: Settings) -> StudioPaths:
    return StudioPaths(settings.studio_data_dir)


@pytest.fixture
def planned(client: TestClient, paths: StudioPaths) -> Iterator[TestClient]:
    """Каналы засеяны, выпуск создан, импортирована версия v001."""
    conn = connect(paths.db_path)
    try:
        seed(paths, conn)
    finally:
        conn.close()
    created = client.post(
        "/api/episodes", json={"id": EPISODE, "channel": "cursus", "title": "Pirate"}
    )
    assert created.status_code == 201, created.text
    assert client.post(DIRECTOR_URL, json=load("director_pirate_10shots.json")).status_code == 200
    yield client


def by_title(body: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {line["title"]: line for line in body["lines"]}


def ledger_rows(paths: StudioPaths) -> int:
    conn = connect(paths.db_path)
    try:
        count: int = conn.execute("SELECT COUNT(*) FROM cost_ledger").fetchone()[0]
    finally:
        conn.close()
    return count


# --- строки сметы ---------------------------------------------------------------------------------


def test_estimate_matches_pricing_yaml(planned: TestClient) -> None:
    response = planned.get(ESTIMATE_URL)
    assert response.status_code == 200, response.text
    body = response.json()
    plan = load("director_pirate_10shots.json")
    shots = len(plan["shots"])
    chars = sum(len(vo) for vo in vo_of(plan))
    clips = [s["animate"]["seconds"] for s in plan["shots"] if s["animate"]["recommended"]]
    assert (shots, chars, clips) == (10, 1021, [5])

    image_model, one_image = call_price(CONFIG, "images", "image", 1)
    voice_model, voice = call_price(CONFIG, "voice", "char", chars)
    animate_model, clip = call_price(CONFIG, "animate", "second", 5)
    lines = by_title(body)
    assert list(lines) == ["Кадры", "Голос", "Анимация", "План"]

    assert lines["Кадры"]["cost"]["model"] == image_model
    assert lines["Кадры"]["usd"]["usd_micro"] == one_image * shots
    assert lines["Кадры"]["label"] == f"10 × {format_unit_usd(one_image)}"
    assert lines["Голос"]["cost"]["model"] == voice_model
    assert lines["Голос"]["usd"]["usd_micro"] == voice
    assert lines["Голос"]["label"] == f"1{NBSP}021 знак"
    assert lines["Анимация"]["cost"]["model"] == animate_model
    assert lines["Анимация"]["usd"]["usd_micro"] == clip
    assert lines["Анимация"]["label"] == f"1 клип × {format_unit_usd(clip)}"

    assert lines["План"]["label"] == "Мост через чат"
    assert lines["План"]["usd"] == {"usd_micro": 0, "usd": "$0"}
    assert lines["План"]["cost"]["via"] == "bridge"
    assert lines["План"]["cost"]["model"] == BRIDGE_MODEL
    assert "via" not in lines["Кадры"]["cost"]

    assert body["version"] == "v001"
    assert body["plan_source"] == "bridge"
    assert body["total"]["usd_micro"] == one_image * shots + voice + clip
    assert body["stale_pricing"] is False


def test_artboard_unit_price_keeps_tenths_of_cent(planned: TestClient) -> None:
    """Цена картинки в подписи — как в артборде, «× $0.067», а не округлённая до цента."""
    _, one_image = call_price(CONFIG, "images", "image", 1)
    assert one_image == 67_000, "цена картинки в pricing.yaml сменилась — поправьте тест"
    label = by_title(planned.get(ESTIMATE_URL).json())["Кадры"]["label"]
    assert label == "10 × $0.067"


def test_removed_shots_and_edits_are_counted_as_in_effective_plan(
    planned: TestClient, paths: StudioPaths
) -> None:
    """v002 убирает s006 и добавляет s011; правка VO и анимации входит в смету."""
    v2 = load("director_pirate_v2.json")
    assert planned.post(DIRECTOR_URL, json=v2).status_code == 200
    new_vo = "You learn the powder room first."
    patch = {
        "shots": {
            "s001": {"user_override": {"vo": new_vo}},
            "s002": {
                "user_override": {
                    "animate": {"recommended": True, "prompt": "the deck sways", "seconds": 6}
                }
            },
        }
    }
    assert planned.patch(f"/api/projects/{EPISODE}", json=patch).status_code == 200
    plan = planned.get(PLAN_URL).json()
    assert [s["id"] for s in plan["shots"] if s["status"] == "removed"] == ["s006"]

    body = planned.get(ESTIMATE_URL).json()
    lines = by_title(body)
    chars = sum(len(vo) for vo in vo_of(v2, {"s001": new_vo}))
    _, one_image = call_price(CONFIG, "images", "image", 1)
    _, voice = call_price(CONFIG, "voice", "char", chars)
    _, clip5 = call_price(CONFIG, "animate", "second", 5)
    _, clip6 = call_price(CONFIG, "animate", "second", 6)
    assert lines["Кадры"]["usd"]["usd_micro"] == one_image * 10
    assert lines["Кадры"]["label"].startswith("10 × ")
    assert lines["Голос"]["usd"]["usd_micro"] == voice
    assert lines["Анимация"]["usd"]["usd_micro"] == clip5 + clip6
    assert lines["Анимация"]["label"] == "2 клипа, 11 с"
    seconds = [line for line in lines["Анимация"]["cost"]["lines"] if line["unit"] == "second"]
    assert [line["quantity"] for line in seconds] == [11]
    assert body["version"] == "v002"


def test_estimate_without_plan_is_409(client: TestClient, paths: StudioPaths) -> None:
    conn = connect(paths.db_path)
    try:
        seed(paths, conn)
    finally:
        conn.close()
    client.post("/api/episodes", json={"id": EPISODE, "channel": "cursus"})
    response = client.get(ESTIMATE_URL)
    assert response.status_code == 409
    assert response.json()["detail"].startswith("Плана ещё нет")
    assert client.get("/api/projects/nope/estimate").status_code == 404


# --- бюджет ---------------------------------------------------------------------------------------


def charge(paths: StudioPaths, usd_micro: int, episode_id: str | None = None) -> None:
    """Расход канала этого месяца — строка журнала `charged`, как после платного вызова."""
    cost = Cost(
        stage="images",
        provider="gemini",
        model="spent-before",
        lines=[CostLine(unit="image", quantity=1, usd_micro=usd_micro)],
        usd_micro=usd_micro,
    )
    conn = connect(paths.db_path)
    try:
        with conn:
            ctx = LedgerContext("cursus", episode_id, "images")
            ledger.record(conn, ctx, cost, "charged", ledger.new_call_id())
    finally:
        conn.close()


def test_month_remaining_from_ledger_and_profile(planned: TestClient, paths: StudioPaths) -> None:
    charge(paths, 50_000_000)  # $50 по каналу, не этого выпуска
    body = planned.get(ESTIMATE_URL).json()
    total = body["total"]["usd_micro"]
    budgets = {outlook["level"]: outlook for outlook in body["budgets"]}
    assert list(budgets) == ["month", "episode", "animation"]

    month = budgets["month"]
    assert month["limit"]["usd_micro"] == 150_000_000  # профиль Cursus из seed
    assert month["committed"]["usd_micro"] == 50_000_000
    assert month["estimate"]["usd_micro"] == total
    left = 100_000_000 - total
    assert month["remaining"]["usd_micro"] == left
    assert month["message"] == f"Останется {format_usd(left)} из месячных $150"
    assert month["exceeded"] is False

    episode = budgets["episode"]
    assert episode["committed"]["usd_micro"] == 0
    assert episode["message"] == f"Останется {format_usd(15_000_000 - total)} из $15 на выпуск"
    animation = budgets["animation"]
    assert animation["estimate"] == by_title(body)["Анимация"]["usd"]
    assert body["warnings"] == []


def test_over_budget_is_warning_not_refusal(planned: TestClient, paths: StudioPaths) -> None:
    profile_path = paths.profile_path("cursus")
    profile = read_json(profile_path)
    profile["budgets"]["per_episode_usd"] = 0.1
    write_json_atomic(profile_path, profile)
    before = ledger_rows(paths)

    response = planned.get(ESTIMATE_URL)
    assert response.status_code == 200, response.text
    body = response.json()
    total = body["total"]["usd_micro"]
    episode = next(o for o in body["budgets"] if o["level"] == "episode")
    assert episode["exceeded"] is True
    assert episode["remaining"]["usd_micro"] == 0
    expected = (
        f"Лимит на выпуск $0.10: занято $0, смета {format_usd(total)} — не хватает"
        f" {format_usd(total - 100_000)}; поднять лимит можно в настройках канала."
    )
    assert episode["message"] == expected
    assert body["warnings"] == [expected]
    # Смета ничего не пишет в журнал: ни резерва, ни отказа.
    assert ledger_rows(paths) == before


# --- без HTTP: источник плана и давние цены -------------------------------------------------------


def effective(planned: TestClient) -> EffectivePlan:
    return EffectivePlan.model_validate(planned.get(PLAN_URL).json())


def test_api_plan_source_prices_script_route(planned: TestClient, settings: Settings) -> None:
    gateway = build_gateway(settings, StudioPaths(settings.studio_data_dir))
    formats = load_formats(CONFIG / "formats.yaml")
    plan = effective(planned)
    budgets = Budgets(monthly_usd=150, per_episode_usd=15, animation_usd=5)
    estimate = plan_estimate(plan, gateway, "api", budgets, {}, formats.estimate)
    script = estimate.lines[-1]
    assert script.cost.via is None
    words = sum(count_words(shot.vo) for shot in plan.shots)
    volumes = formats.estimate
    model, token_in = call_price(CONFIG, "script", "token_in", volumes.script_input_tokens)
    _, token_out = call_price(
        CONFIG, "script", "token_out", math.ceil(words * volumes.script_output_tokens_per_word)
    )
    assert script.cost.model == model
    assert script.usd.usd_micro == token_in + token_out
    assert script.label.split()[-1] in ("токен", "токена", "токенов")


def test_stale_price_marks_line_and_estimate(
    planned: TestClient, settings: Settings, tmp_path: Path
) -> None:
    config = tmp_path / "config"
    shutil.copytree(CONFIG, config)
    pricing_path = config / "pricing.yaml"
    pricing = yaml.safe_load(pricing_path.read_text(encoding="utf-8"))
    providers = yaml.safe_load((config / "providers.yaml").read_text(encoding="utf-8"))
    images = providers["stages"]["images"]
    entry = images["catalog"][images["profiles"][providers["default_profile"]]]
    pricing[entry["provider"]][entry["model"]]["checked_at"] = "2020-01-01"
    pricing_path.write_text(yaml.safe_dump(pricing, allow_unicode=True), encoding="utf-8")

    stale_settings = settings.model_copy(update={"config_dir": config})
    gateway = build_gateway(stale_settings, StudioPaths(settings.studio_data_dir))
    formats = load_formats(config / "formats.yaml")
    budgets = Budgets(monthly_usd=150, per_episode_usd=15, animation_usd=5)
    estimate = plan_estimate(effective(planned), gateway, "bridge", budgets, {}, formats.estimate)
    assert estimate.stale_pricing is True
    assert [line.cost.stale_pricing for line in estimate.lines] == [True, False, False, False]
