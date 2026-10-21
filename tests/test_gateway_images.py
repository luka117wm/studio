"""M5.3: картинки через шлюз — референсы в ключе кэша и лимит, ассеты уровня канала, кэш $0,
бюджет канала, миграция `assets`. Провайдер — фейковый (`provider: fake`), сеть не нужна;
вызов Gemini на подменённом транспорте — `tests/test_providers.py`."""

import asyncio
import shutil
import sqlite3
from collections.abc import Awaitable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
import yaml

from app.cost import ledger
from app.cost.budget import BudgetExceeded
from app.cost.ledger import LedgerRow
from app.providers.base import ConfigError, ImageRef, ImageRequest, RouteError
from app.providers.fake import FakeProvider
from app.providers.gateway import CallContext, CallOutcome, Gateway, build_gateway, input_hash
from app.providers.registry import load_providers_config
from app.settings import REPO_ROOT, Settings
from app.storage.atomic import read_json, write_json_atomic
from app.storage.db import apply_migrations, connect, list_migrations, migrate, now_iso
from app.storage.paths import StudioPaths
from app.tools.seed import seed

FIXTURE_CONFIG = REPO_ROOT / "tests" / "fixtures" / "config"
PNG = b"\x89PNG\r\n\x1a\n"
ANCHOR_PRICE = 134_000  # фикстура прайса: fake-anchor 1K — $0.134
MAX_REFS = 2


def run[T](awaitable: Awaitable[T]) -> T:
    async def wrap() -> T:
        return await awaitable

    return asyncio.run(wrap())


def edit_yaml(path: Path, change: Any) -> None:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    change(data)
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")


def add_anchors_stage(config: Path) -> None:
    """Этап `anchors` тестового конфига: одна фейковая модель, как Pro в настоящем."""

    def providers(data: dict[str, Any]) -> None:
        entry = {"provider": "fake", "model": "fake-anchor", "params": {"size": "1K"}}
        data["stages"]["anchors"] = {
            "kind": "image",
            "catalog": {"pro": {**entry, "max_refs": MAX_REFS}},
            "profiles": {"economy": "pro", "standard": "pro", "premium": "pro"},
        }

    def pricing(data: dict[str, Any]) -> None:
        data["fake"]["fake-anchor"] = {
            "checked_at": "2026-10-14",
            "source": "tests",
            "prices": {"image": {"variants": {"1K": "0.134"}}},
        }

    edit_yaml(config / "providers.yaml", providers)
    edit_yaml(config / "pricing.yaml", pricing)


@dataclass
class Env:
    paths: StudioPaths
    gateway: Gateway
    fake: FakeProvider

    def call(self, request: ImageRequest, **ctx: Any) -> CallOutcome:
        context = CallContext(**({"stage": "anchors", "channel": "cursus"} | ctx))
        return run(self.gateway.call(context, request))

    def ref(self, name: str, data: bytes = PNG + b"face", channel: str = "cursus") -> ImageRef:
        path = self.paths.style_anchors_dir(channel) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return self.gateway.image_ref(path)

    def rows(self, channel: str = "cursus") -> list[LedgerRow]:
        conn = connect(self.paths.db_path)
        try:
            return ledger.list_rows(conn, channel=channel)
        finally:
            conn.close()

    def assets(self) -> list[dict[str, Any]]:
        conn = connect(self.paths.db_path)
        try:
            return [dict(row) for row in conn.execute("SELECT * FROM assets ORDER BY rowid")]
        finally:
            conn.close()


@pytest.fixture
def env(tmp_path: Path) -> Env:
    config = tmp_path / "config"
    shutil.copytree(FIXTURE_CONFIG, config)
    add_anchors_stage(config)
    settings = Settings(_env_file=None, studio_data_dir=tmp_path / "data", config_dir=config)
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


def portrait(*refs: ImageRef, prompt: str = "front portrait, neutral background") -> ImageRequest:
    return ImageRequest(prompt=prompt, refs=list(refs), seed=11, aspect_ratio="3:4")


def set_budgets(paths: StudioPaths, **budgets: float) -> None:
    profile = read_json(paths.profile_path("cursus"))
    profile["budgets"].update(budgets)
    write_json_atomic(paths.profile_path("cursus"), profile)


# --- ассет уровня канала -------------------------------------------------------------------------


def test_channel_call_stores_asset_in_canon_and_ledger_without_episode(env: Env) -> None:
    ref = env.ref("front.png")
    outcome = env.call(portrait(ref))

    assert outcome.status == "charged"
    assert outcome.cost.usd_micro == ANCHOR_PRICE
    cache_dir = env.paths.canon_cache_dir("cursus", "anchors")
    assert outcome.asset_path is not None and outcome.asset_path.parent == cache_dir
    assert outcome.asset_path.name == f"anchors-{outcome.input_hash[:16]}.png"
    assert outcome.asset_path.is_file()

    [asset] = env.assets()
    assert {k: asset[k] for k in ("channel", "episode_id", "shot_id", "kind", "version")} == {
        "channel": "cursus",
        "episode_id": None,
        "shot_id": None,
        "kind": "anchors",
        "version": 1,
    }
    assert asset["path"] == outcome.asset_path.relative_to(env.paths.root).as_posix()
    [row] = env.rows()
    assert (row.status, row.stage, row.episode_id, row.usd_micro) == (
        "charged",
        "anchors",
        None,
        ANCHOR_PRICE,
    )
    assert (row.model, row.variant, row.input_hash) == ("fake-anchor", "1K", outcome.input_hash)
    # Провайдер получил байты референса, шлюз определил MIME по сигнатуре.
    [[sent]] = env.fake.refs
    assert (sent.data, sent.mime_type) == (PNG + b"face", "image/png")


def test_repeat_is_cached_for_free_with_same_file(env: Env) -> None:
    request = portrait(env.ref("front.png"))
    first = env.call(request)
    second = env.call(request)
    assert (second.status, second.asset_path, second.result) == ("cached", first.asset_path, None)
    assert len(env.fake.calls) == 1
    assert [(r.status, r.usd_micro) for r in env.rows()] == [
        ("charged", ANCHOR_PRICE),
        ("cached", 0),
    ]
    assert len(env.assets()) == 1


def test_asset_dir_inside_canon_only(env: Env) -> None:
    candidates = env.paths.anchor_candidates_dir("cursus", "you@powder-monkey-11")
    outcome = env.call(portrait(prompt="three quarter"), asset_dir=candidates)
    assert outcome.asset_path is not None and outcome.asset_path.parent == candidates

    for outside in (
        env.paths.canon_dir("otto") / "anchors",
        env.paths.media_dir("cursus", "pirate"),
        env.paths.root / "elsewhere",
    ):
        with pytest.raises(RouteError, match="вне channels/cursus/canon"):
            env.call(portrait(prompt="profile"), asset_dir=outside)
    assert len(env.fake.calls) == 1
    assert len(env.rows()) == 1


def test_episode_call_keeps_media_dir_and_writes_channel(env: Env) -> None:
    outcome = env.call(portrait(prompt="deck"), channel=None, episode_id="pirate", shot_id="s001")
    media = env.paths.media_dir("cursus", "pirate") / "anchors"
    assert outcome.asset_path is not None and outcome.asset_path.parent == media
    [asset] = env.assets()
    assert (asset["channel"], asset["episode_id"], asset["shot_id"]) == ("cursus", "pirate", "s001")
    [row] = env.rows()
    assert row.episode_id == "pirate"


def test_channel_must_exist_and_match_episode(env: Env) -> None:
    with pytest.raises(RouteError, match="Канал «nope» не найден"):
        env.call(portrait(), channel="nope")
    with pytest.raises(RouteError, match="должен назвать канал"):
        env.call(portrait(), channel=None)
    with pytest.raises(
        RouteError, match="Выпуск «pirate» — канала cursus, а вызов назвал канал otto"
    ):
        env.call(portrait(), channel="otto", episode_id="pirate")
    assert env.fake.calls == [] and env.rows() == [] and env.rows("otto") == []


# --- референсы -----------------------------------------------------------------------------------


def test_ref_hash_not_path_is_the_cache_key(env: Env) -> None:
    route = env.gateway.resolve("anchors")
    a = env.ref("a.png")
    same_bytes = env.ref("copy.png")
    other = env.ref("b.png", PNG + b"other face")
    assert a.sha256 == same_bytes.sha256 and a.path != same_bytes.path
    assert input_hash(route, portrait(a)) == input_hash(route, portrait(same_bytes))
    assert input_hash(route, portrait(a)) != input_hash(route, portrait(other))
    assert input_hash(route, portrait(a, other)) != input_hash(route, portrait(other, a))


def test_more_refs_than_model_takes_is_refused_before_call(env: Env) -> None:
    refs = [env.ref(f"r{n}.png", PNG + bytes([n])) for n in range(MAX_REFS + 1)]
    message = "Референсов 3, а модель fake-anchor этапа «anchors» принимает не больше 2"
    with pytest.raises(RouteError, match=message):
        env.gateway.estimate("anchors", portrait(*refs))
    with pytest.raises(RouteError, match=message):
        env.call(portrait(*refs))
    # У этапа без `max_refs` референсы не принимаются вовсе.
    with pytest.raises(RouteError, match="принимает без референсов"):
        run(env.gateway.call(CallContext(stage="images", episode_id="pirate"), portrait(refs[0])))
    assert env.fake.calls == [] and env.rows() == []


def test_missing_changed_foreign_or_not_image_ref_is_refused(env: Env) -> None:
    gone = env.ref("gone.png")
    (env.paths.root / gone.path).unlink()
    changed = env.ref("changed.png")
    (env.paths.root / changed.path).write_bytes(PNG + b"edited")
    foreign = env.ref("otto.png", channel="otto")
    text = env.ref("notes.png", b"not an image")
    media = env.paths.media_dir("cursus", "pirate") / "s001.png"
    media.parent.mkdir(parents=True)
    media.write_bytes(PNG + b"shot")
    shot = env.gateway.image_ref(media)

    cases = [
        (gone, "не найден"),
        (changed, "изменился после расчёта хэша"),
        (foreign, "не из канона канала cursus"),
        (shot, "не из канона канала cursus"),
        (text, "не PNG, JPEG или WEBP"),
    ]
    for ref, message in cases:
        with pytest.raises(RouteError, match=message):
            env.call(portrait(ref))
    assert env.fake.calls == [] and env.rows() == []
    with pytest.raises(RouteError, match="вне каталога данных"):
        env.gateway.image_ref(Path("/etc/hostname"))


def test_cached_result_does_not_need_ref_files(env: Env) -> None:
    """Кэш — по хэшу входов: готовая картинка отдаётся, даже если файл референса убран."""
    ref = env.ref("front.png")
    first = env.call(portrait(ref))
    (env.paths.root / ref.path).unlink()
    assert env.call(portrait(ref)).asset_path == first.asset_path


# --- деньги --------------------------------------------------------------------------------------


def test_channel_call_checks_only_monthly_budget(env: Env) -> None:
    set_budgets(env.paths, per_episode_usd=0.01, animation_usd=0.01)
    assert env.call(portrait(prompt="ok")).status == "charged"

    set_budgets(env.paths, monthly_usd=0.2)
    with pytest.raises(BudgetExceeded) as caught:
        env.call(portrait(prompt="second"))
    assert caught.value.level == "month"
    assert len(env.fake.calls) == 1
    assert [(r.status, r.episode_id) for r in env.rows()] == [
        ("charged", None),
        ("refused", None),
    ]


def test_check_budget_before_queue_for_channel(env: Env) -> None:
    set_budgets(env.paths, monthly_usd=0.1)
    cost = env.gateway.estimate("anchors", portrait())
    conn = connect(env.paths.db_path)
    try:
        with pytest.raises(BudgetExceeded) as caught:
            env.gateway.check_budget(conn, cost, channel="cursus")
        assert caught.value.level == "month"
        with pytest.raises(RouteError, match="должен назвать канал"):
            env.gateway.check_budget(conn, cost)
    finally:
        conn.close()
    assert [(r.status, r.stage, r.episode_id) for r in env.rows()] == [("refused", "anchors", None)]


# --- конфиг и миграция ---------------------------------------------------------------------------


def test_shipped_anchors_stage_is_pro_1k_everywhere() -> None:
    config = load_providers_config(REPO_ROOT / "config" / "providers.yaml")
    anchors = config.stages["anchors"]
    assert anchors.kind == "image"
    [key] = set(anchors.profiles.values())
    entry = anchors.catalog[key]
    assert (entry.provider, entry.model, entry.params, entry.max_refs) == (
        "gemini",
        "gemini-3-pro-image",
        {"size": "1K"},
        14,
    )
    assert {e.max_refs for e in config.stages["images"].catalog.values()} == {14}


def test_max_refs_only_on_image_stages(tmp_path: Path) -> None:
    path = tmp_path / "providers.yaml"
    shutil.copy(FIXTURE_CONFIG / "providers.yaml", path)
    edit_yaml(path, lambda d: d["stages"]["voice"]["catalog"]["tts"].update(max_refs=2))
    with pytest.raises(ConfigError, match="max_refs is only for image stages"):
        load_providers_config(path)


def test_migration_moves_old_assets_with_their_channel(tmp_path: Path) -> None:
    """База до M5.3 с ассетом выпуска: после 009 у строки канал выпуска, выпуск на месте."""
    conn = sqlite3.connect(tmp_path / "app.db")
    conn.row_factory = sqlite3.Row
    try:
        conn.execute(
            "CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
        for version, file in list_migrations():
            if version >= 9:
                break
            conn.executescript(file.read_text(encoding="utf-8"))
            conn.execute("INSERT INTO schema_version VALUES (?, ?)", (version, now_iso()))
        conn.execute(
            "INSERT INTO channels (id, name, format, created_at) VALUES ('otto', 'Otto', 'f', ?)",
            (now_iso(),),
        )
        conn.execute(
            "INSERT INTO episodes (id, channel, title, created_at, updated_at)"
            " VALUES ('o01', 'otto', 'Otto 1', ?, ?)",
            (now_iso(), now_iso()),
        )
        conn.execute(
            "INSERT INTO assets (id, episode_id, shot_id, kind, version, path, input_hash, status,"
            " created_at) VALUES ('a1', 'o01', 's001', 'images', 1, 'p.png', 'h', 'ready', ?)",
            (now_iso(),),
        )
        conn.commit()
        assert 9 in apply_migrations(conn)
        row = dict(conn.execute("SELECT * FROM assets").fetchone())
        assert (row["id"], row["channel"], row["episode_id"], row["input_hash"]) == (
            "a1",
            "otto",
            "o01",
            "h",
        )
        indexes = {r["name"] for r in conn.execute("PRAGMA index_list(assets)")}
        assert {"assets_cache", "assets_episode_shot", "assets_channel"} <= indexes
    finally:
        conn.close()
