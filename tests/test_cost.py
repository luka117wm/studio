"""Цены, журнал, бюджеты, кэш и маршруты платных вызовов (M2.6) — на фейковом провайдере.

Приёмка M2.6: 10 вызовов → 10 строк журнала с суммой по прайсу; превышение бюджета → 409 и джоб
не создан; смена профиля в конфиге меняет модель, запрещённая модель — ошибка старта; повтор с
теми же входами — `cached`, $0.
"""

import asyncio
import re
import shutil
import time
from collections.abc import Awaitable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from app.cost import ledger
from app.cost.budget import BudgetExceeded, committed_episode
from app.cost.ledger import LedgerContext, LedgerRow
from app.cost.pricing import ModelPrice, Pricing, format_usd
from app.jobs.handlers import builtin_handlers
from app.jobs.worker import HandlerSpec, JobContext, TransientError
from app.main import create_app
from app.models.director import StrictModel
from app.providers.base import (
    ConfigError,
    Cost,
    CostLine,
    ImageRequest,
    Route,
    RouteError,
    SpeechRequest,
    TextRequest,
    Usage,
    VideoRequest,
)
from app.providers.fake import FakeProvider
from app.providers.gateway import CallContext, CallOutcome, Gateway, build_gateway
from app.providers.registry import PROFILES
from app.settings import REPO_ROOT, Settings
from app.storage.atomic import read_json, write_json_atomic
from app.storage.db import connect, migrate, now_iso
from app.storage.paths import StudioPaths
from app.tools.seed import seed

FIXTURE_CONFIG = REPO_ROOT / "tests" / "fixtures" / "config"
PIRATE = {"id": "pirate", "channel": "cursus", "title": "Every Rank on a Pirate Ship"}


def run[T](awaitable: Awaitable[T]) -> T:
    async def wrap() -> T:
        return await awaitable

    return asyncio.run(wrap())


def cost_settings(tmp_path: Path, config_dir: Path = FIXTURE_CONFIG, **overrides: Any) -> Settings:
    return Settings(
        _env_file=None,
        studio_data_dir=tmp_path / "data",
        config_dir=config_dir,
        job_retry_wait_s=0,
        **overrides,
    )


def copy_config(tmp_path: Path) -> Path:
    config = tmp_path / "config"
    shutil.copytree(FIXTURE_CONFIG, config)
    return config


def edit_yaml(path: Path, change: Any) -> None:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    change(data)
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")


def set_budgets(paths: StudioPaths, channel: str, **budgets: float) -> None:
    profile = read_json(paths.profile_path(channel))
    profile["budgets"].update(budgets)
    write_json_atomic(paths.profile_path(channel), profile)


def image(prompt: str, style: str = "style/v001") -> ImageRequest:
    return ImageRequest(prompt=prompt, canon={"style": style}, seed=7)


def rows(paths: StudioPaths, episode_id: str = "pirate") -> list[LedgerRow]:
    conn = connect(paths.db_path)
    try:
        return ledger.list_rows(conn, episode_id=episode_id)
    finally:
        conn.close()


def charge_directly(paths: StudioPaths, channel: str, usd_micro: int) -> None:
    """Строка `charged` в обход провайдера — прошлые траты месяца."""
    cost = Cost(
        stage="images",
        provider="fake",
        model="fake-image-small",
        lines=[CostLine(unit="image", quantity=1, usd_micro=usd_micro)],
        usd_micro=usd_micro,
    )
    conn = connect(paths.db_path)
    try:
        with conn:
            ctx = LedgerContext(channel, None, "images")
            ledger.record(conn, ctx, cost, "charged", ledger.new_call_id())
    finally:
        conn.close()


@dataclass
class Env:
    paths: StudioPaths
    gateway: Gateway
    fake: FakeProvider

    def call(self, request: Any, stage: str = "images", **kw: Any) -> CallOutcome:
        shot_id = kw.pop("shot_id", None)
        ctx = CallContext(stage=stage, episode_id="pirate", shot_id=shot_id)
        return run(self.gateway.call(ctx, request, **kw))


@pytest.fixture
def env(tmp_path: Path) -> Env:
    settings = cost_settings(tmp_path)
    paths = StudioPaths(settings.studio_data_dir)
    migrate(paths.db_path)
    conn = connect(paths.db_path)
    try:
        seed(paths, conn)
        with conn:
            conn.execute(
                "INSERT INTO episodes (id, channel, title, created_at, updated_at)"
                " VALUES ('pirate', 'cursus', 'Pirate', ?, ?)",
                (now_iso(), now_iso()),
            )
    finally:
        conn.close()
    gateway = build_gateway(settings, paths)
    fake = gateway.registry.provider("fake")
    assert isinstance(fake, FakeProvider)
    return Env(paths, gateway, fake)


# --- цены ----------------------------------------------------------------------------------------


def test_format_usd_rounds_only_on_output() -> None:
    assert format_usd(151_200_000) == "$151.20"
    assert format_usd(150_000_000) == "$150"
    assert format_usd(67_000) == "$0.07"
    assert format_usd(4_000) == "<$0.01"
    assert format_usd(0) == "$0"


def test_price_rounds_once_per_line_half_up() -> None:
    price = ModelPrice.model_validate(
        {
            "checked_at": "2026-09-25",
            "source": "tests",
            "prices": {"char": {"usd": "0.0000005"}, "second": {"usd": "0.10", "per": 3}},
        }
    )
    pricing = Pricing({"fake": {"m": price}}, stale_days=60)
    route = Route(stage="voice", key="k", kind="speech", provider="fake", model="m")
    cost = pricing.cost(route, [Usage(unit="char", quantity=1), Usage(unit="second", quantity=1)])
    # 0.5 мкд → 1; 0.1 / 3 = 33 333.33… мкд → 33 333: микродоллары целые, центы не трогаем.
    assert [line.usd_micro for line in cost.lines] == [1, 33_333]
    assert cost.usd_micro == 33_334


def test_text_estimate_counts_tokens_output_bound_and_searches(env: Env) -> None:
    request = TextRequest(prompt="x" * 300, max_output_tokens=1000, max_searches=2)
    cost = env.gateway.estimate("script", request)
    by_unit = {line.unit: (line.quantity, line.usd_micro) for line in cost.lines}
    # 300 символов / 3 = 100 токенов × $3/M; выход — по max_output_tokens × $15/M; поиск $10/1000.
    assert by_unit == {"token_in": (100, 300), "token_out": (1000, 15_000), "search": (2, 20_000)}
    assert cost.usd_micro == 35_300 and cost.model == "fake-llm"


def test_request_kind_must_match_stage(env: Env) -> None:
    with pytest.raises(RouteError, match="принимает запросы «speech»"):
        env.gateway.estimate("voice", image("wrong stage"))


# --- журнал и кэш --------------------------------------------------------------------------------


def test_ten_fake_calls_write_ten_rows_matching_price_list(env: Env) -> None:
    for n in range(10):
        profile = "premium" if n >= 7 else None  # 7 × small@1K, 3 × large@2K
        outcome = env.call(image(f"shot {n}"), shot_id=f"s{n:03d}", profile=profile)
        assert outcome.status == "charged" and outcome.asset_path is not None

    items = rows(env.paths)
    assert len(items) == 10 and len(env.fake.calls) == 10
    assert {item.status for item in items} == {"charged"}
    # Ручной расчёт — прямо из YAML, мимо кода цен.
    prices = yaml.safe_load((FIXTURE_CONFIG / "pricing.yaml").read_text(encoding="utf-8"))
    small = Decimal(prices["fake"]["fake-image-small"]["prices"]["image"]["variants"]["1K"])
    large = Decimal(prices["fake"]["fake-image-large"]["prices"]["image"]["variants"]["2K"])
    expected = (7 * small + 3 * large) * 1_000_000
    assert sum(item.usd_micro for item in items) == int(expected) == 871_000
    assert [item.variant for item in items] == ["1K"] * 7 + ["2K"] * 3


def test_same_inputs_second_time_is_cached_for_free(env: Env) -> None:
    first = env.call(image("gun deck"), shot_id="s001")
    second = env.call(image("gun deck"), shot_id="s001")
    assert (first.status, second.status) == ("charged", "cached")
    assert first.asset_path is not None and first.asset_path.is_file()
    assert second.asset_path == first.asset_path
    assert len(env.fake.calls) == 1
    items = rows(env.paths)
    assert [(item.status, item.usd_micro) for item in items] == [
        ("charged", 67_000),
        ("cached", 0),
    ]
    assert items[0].input_hash == items[1].input_hash

    # Новая версия канона — другой хэш входов: вызов платный (принцип 8).
    assert env.call(image("gun deck", style="style/v002"), shot_id="s001").status == "charged"
    # Файл пропал с диска — строка `assets` кэш не держит.
    first.asset_path.unlink()
    assert env.call(image("gun deck"), shot_id="s001").status == "charged"
    assert len(env.fake.calls) == 3


def test_failed_call_releases_reservation(env: Env) -> None:
    env.fake.errors.append(TransientError("provider overloaded"))
    with pytest.raises(TransientError):
        env.call(image("storm"))
    [row] = rows(env.paths)
    assert (row.status, row.usd_micro) == ("failed", 0)
    conn = connect(env.paths.db_path)
    try:
        assert committed_episode(conn, "pirate").total == 0
    finally:
        conn.close()


# --- бюджеты -------------------------------------------------------------------------------------


def test_call_over_month_budget_is_refused_before_provider(env: Env) -> None:
    set_budgets(env.paths, "cursus", monthly_usd=0.1)
    assert env.call(image("first")).status == "charged"
    with pytest.raises(BudgetExceeded) as refused:
        env.call(image("second"))
    assert refused.value.level == "month"
    assert str(refused.value) == (
        "Месячный лимит $0.10: потрачено $0.07, операция — $0.07, не хватает $0.03;"
        " поднять лимит можно в настройках канала."
    )
    assert len(env.fake.calls) == 1  # без тихого перехода на модель дешевле — вызова нет
    assert [item.status for item in rows(env.paths)] == ["charged", "refused"]


def test_episode_and_animation_limits(env: Env) -> None:
    set_budgets(env.paths, "cursus", per_episode_usd=1, animation_usd=0.5)
    clip = VideoRequest(prompt="sails fill", start_frame="abc", seconds=1)
    assert env.call(clip, stage="animate").cost.usd_micro == 400_000
    with pytest.raises(BudgetExceeded) as refused:
        env.call(clip.model_copy(update={"prompt": "waves"}), stage="animate")
    assert refused.value.level == "animation"
    assert "Лимит на анимацию выпуска $0.50" in str(refused.value)
    # Кадры в лимит анимации не входят, но входят в лимит выпуска: 0.40 + 0.067 < 1.
    assert env.call(image("deck")).status == "charged"
    speech = SpeechRequest(text="x" * 6000, voice_id="v")  # $0.60 → 1.067 > 1
    with pytest.raises(BudgetExceeded) as over:
        env.call(speech, stage="voice")
    assert over.value.level == "episode"


# --- API: бюджет до постановки -------------------------------------------------------------------


class FakeImagePayload(StrictModel):
    prompt: str
    shot_id: str | None = None


def _image_of(payload: FakeImagePayload) -> ImageRequest:
    return image(payload.prompt)


async def fake_image_job(ctx: JobContext, payload: FakeImagePayload) -> dict[str, Any]:
    call = CallContext(
        stage="images", episode_id=ctx.episode_id, shot_id=payload.shot_id, job_id=ctx.job_id
    )
    outcome = await ctx.gateway.call(call, _image_of(payload))
    return {"status": outcome.status, "usd_micro": outcome.cost.usd_micro}


def _estimate(gateway: Gateway, payload: FakeImagePayload) -> Cost:
    return gateway.estimate("images", _image_of(payload))


PAID = HandlerSpec("fake_image", fake_image_job, FakeImagePayload, estimate=_estimate)


def paid_client(tmp_path: Path, workers: int) -> Iterator[TestClient]:
    handlers = {**builtin_handlers(), PAID.kind: PAID}
    app = create_app(cost_settings(tmp_path, job_workers=workers), handlers)
    with TestClient(app) as client:
        conn = connect(app.state.paths.db_path)
        try:
            seed(app.state.paths, conn)
        finally:
            conn.close()
        assert client.post("/api/episodes", json=PIRATE).status_code == 201
        yield client


@pytest.fixture
def idle(tmp_path: Path) -> Iterator[TestClient]:
    """Очередь без воркеров: платные джобы остаются `queued` и держат бюджет."""
    yield from paid_client(tmp_path, workers=0)


@pytest.fixture
def working(tmp_path: Path) -> Iterator[TestClient]:
    yield from paid_client(tmp_path, workers=1)


def _paths(client: TestClient) -> StudioPaths:
    paths: StudioPaths = client.app.state.paths  # type: ignore[attr-defined]
    return paths


def post_paid(client: TestClient, prompt: str, shot_id: str | None = None, **fields: Any) -> Any:
    payload = {"prompt": prompt, "shot_id": shot_id}
    body = {"kind": "fake_image", "payload": payload, "episode_id": "pirate", **fields}
    return client.post("/api/jobs", json=body)


def test_budget_exceeded_is_409_and_job_not_created(idle: TestClient) -> None:
    charge_directly(_paths(idle), "cursus", 151_200_000)  # лимит Cursus — $150 в месяц
    response = post_paid(idle, "one more shot")
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["message"] == (
        "Месячный лимит $150 исчерпан, потрачено $151.20; поднять лимит можно в настройках канала."
    )
    assert (detail["code"], detail["level"]) == ("budget_exceeded", "month")
    assert detail["cost_usd_micro"] == 67_000
    assert idle.get("/api/jobs").json()["summary"]["total"] == 0
    refused = [row for row in rows(_paths(idle)) if row.status == "refused"]
    assert len(refused) == 1 and refused[0].usd_micro == 67_000


def test_queued_paid_jobs_hold_the_budget(idle: TestClient) -> None:
    set_budgets(_paths(idle), "cursus", per_episode_usd=0.2)
    first, second = post_paid(idle, "a"), post_paid(idle, "b")
    assert (first.status_code, second.status_code) == (201, 201)
    assert first.json()["cost_usd_micro"] == 67_000 and first.json()["cost_stage"] == "images"
    third = post_paid(idle, "c")  # 3 × $0.067 > $0.20 — пачка упирается до оплаты
    assert third.status_code == 409
    assert third.json()["detail"]["message"] == (
        "Лимит на выпуск $0.20: потрачено $0, в очереди $0.13, операция — $0.07,"
        " не хватает <$0.01; поднять лимит можно в настройках канала."
    )
    assert post_paid(idle, "d", idempotency_key="shot-d").status_code == 409
    # Отмена освобождает оценку. Повтор с ключом уже поставленного джоба бюджет не проверяет:
    # вернётся тот же джоб (200), хотя новый в лимит уже не влез бы.
    idle.post(f"/api/jobs/{first.json()['id']}/cancel")
    assert post_paid(idle, "d", idempotency_key="shot-d").status_code == 201
    assert post_paid(idle, "d", idempotency_key="shot-d").status_code == 200
    assert idle.get("/api/jobs").json()["summary"]["queued"] == 2


def test_paid_job_needs_episode(idle: TestClient) -> None:
    body = {"kind": "fake_image", "payload": {"prompt": "x"}}
    response = idle.post("/api/jobs", json=body)
    assert response.status_code == 422 and "episode_id" in response.json()["detail"]


def test_paid_job_charges_and_shows_in_summary_and_ledger(working: TestClient) -> None:
    job = post_paid(working, "powder monkey", shot_id="s001").json()
    deadline = time.monotonic() + 5
    while working.get(f"/api/jobs/{job['id']}").json()["status"] != "done":
        assert time.monotonic() < deadline, "job did not finish"
        time.sleep(0.02)
    done = working.get(f"/api/jobs/{job['id']}").json()
    assert done["result"] == {"status": "charged", "usd_micro": 67_000}

    page = working.get("/api/cost/ledger", params={"episode": "pirate"}).json()
    [row] = page["items"]
    assert (row["status"], row["job_id"], row["usd"]) == ("charged", job["id"], "$0.07")
    assert page["episode_budget"]["charged"] == {"usd_micro": 67_000, "usd": "$0.07"}
    assert page["episode_budget"]["remaining"]["usd"] == "$14.93"
    assert page["animation_budget"]["limit"]["usd"] == "$5"

    summary = working.get("/api/cost/summary", params={"channel": "cursus"}).json()
    assert summary["month"] == datetime.now(UTC).strftime("%Y-%m")
    assert summary["budget"]["charged"]["usd_micro"] == 67_000
    assert summary["budget"]["limit"]["usd"] == "$150"
    assert summary["by_stage"] == [
        {"stage": "images", "spent": {"usd_micro": 67_000, "usd": "$0.07"}}
    ]
    assert (
        working.get("/api/cost/summary", params={"channel": "otto"}).json()["budget"]["charged"][
            "usd_micro"
        ]
        == 0
    )
    assert working.get("/api/cost/ledger").status_code == 422


# --- конфиг: профили, запреты, цены --------------------------------------------------------------


def test_profile_switch_changes_model_without_code(tmp_path: Path) -> None:
    config = copy_config(tmp_path)
    paths = StudioPaths(tmp_path / "data")
    gateway = build_gateway(cost_settings(tmp_path, config), paths)
    assert gateway.resolve("images").model == "fake-image-small"
    assert gateway.resolve("images", override="large").model == "fake-image-large"
    assert gateway.resolve("images", override="fake-image-large").key == "large"
    with pytest.raises(RouteError, match="нет в каталоге этапа «images»"):
        gateway.resolve("images", override="gpt-image")

    edit_yaml(config / "providers.yaml", lambda data: data.update(default_profile="premium"))
    switched = build_gateway(cost_settings(tmp_path, config), paths)
    assert switched.resolve("images").model == "fake-image-large"


@pytest.mark.parametrize("model", ["gemini-2.5-flash-image", "gemini-2.5-flash-image-preview"])
def test_forbidden_model_in_config_is_startup_error(tmp_path: Path, model: str) -> None:
    config = copy_config(tmp_path)

    def add(data: dict[str, Any]) -> None:
        catalog = data["stages"]["images"]["catalog"]
        catalog["old"] = {"provider": "fake", "model": model, "params": {"size": "1K"}}

    edit_yaml(config / "providers.yaml", add)
    with pytest.raises(ConfigError, match="is forbidden"):
        create_app(cost_settings(tmp_path, config))


def test_sora_is_forbidden_in_any_case(tmp_path: Path) -> None:
    config = copy_config(tmp_path)

    def add(data: dict[str, Any]) -> None:
        catalog = data["stages"]["animate"]["catalog"]
        catalog["sora"] = {"provider": "fake", "model": "Sora-2-Pro"}

    edit_yaml(config / "providers.yaml", add)
    with pytest.raises(ConfigError, match="sora-2"):
        create_app(cost_settings(tmp_path, config))


def test_model_without_price_is_startup_error(tmp_path: Path) -> None:
    config = copy_config(tmp_path)

    def add(data: dict[str, Any]) -> None:
        data["stages"]["voice"]["catalog"]["new"] = {"provider": "fake", "model": "fake-tts-2"}

    edit_yaml(config / "providers.yaml", add)
    with pytest.raises(ConfigError, match="нет цены модели fake/fake-tts-2"):
        create_app(cost_settings(tmp_path, config))


def test_unquoted_price_is_startup_error(tmp_path: Path) -> None:
    config = copy_config(tmp_path)
    pricing = config / "pricing.yaml"
    pricing.write_text(
        pricing.read_text(encoding="utf-8").replace('{usd: "0.10", per: 1000}', "{usd: 0.10}"),
        encoding="utf-8",
    )
    with pytest.raises(ConfigError, match="quoted string"):
        create_app(cost_settings(tmp_path, config))


def test_stale_pricing_warns_and_shows_in_summary(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    config = copy_config(tmp_path)
    edit_yaml(
        config / "pricing.yaml",
        lambda data: data["fake"]["fake-tts"].update(checked_at="2020-01-01"),
    )
    # До create_app: его configure_logging пересобирает корневой логгер и снимает хендлер caplog.
    build_gateway(cost_settings(tmp_path, config), StudioPaths(tmp_path / "data"))
    assert "pricing: fake/fake-tts checked 2020-01-01" in caplog.text
    app = create_app(cost_settings(tmp_path, config))
    with TestClient(app) as client:
        conn = connect(app.state.paths.db_path)
        try:
            seed(app.state.paths, conn)
        finally:
            conn.close()
        stale = client.get("/api/cost/summary", params={"channel": "cursus"}).json()
        assert [(s["provider"], s["model"]) for s in stale["stale_pricing"]] == [
            ("fake", "fake-tts")
        ]
    gateway: Gateway = app.state.gateway
    assert gateway.estimate("voice", SpeechRequest(text="hi", voice_id="v")).stale_pricing
    assert not gateway.estimate("images", image("fresh")).stale_pricing


def test_shipped_config_is_valid_and_model_ids_live_only_there(tmp_path: Path) -> None:
    gateway = build_gateway(
        Settings(_env_file=None, studio_data_dir=tmp_path / "data"), StudioPaths(tmp_path)
    )
    config = gateway.registry.config
    assert {"gemini-2.5-flash-image*", "sora-2*"} <= set(config.forbidden_models)
    assert "animate" in config.stages  # по нему считается лимит «анимация на выпуск»
    for stage in config.stages:
        for profile in PROFILES:
            gateway.resolve(stage, profile)
    # Принцип 5: ни одного ID модели из конфига в коде бэкенда.
    models = {route.model for route in gateway.registry.routes()}
    code = "\n".join(p.read_text(encoding="utf-8") for p in (REPO_ROOT / "backend").rglob("*.py"))
    leaked = sorted(m for m in models if re.search(rf"\b{re.escape(m)}\b", code))
    assert leaked == []
