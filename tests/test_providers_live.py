"""Живая проверка ключей (M2.6): `uv run pytest -m live -v -rP` — запросы бесплатные.

Ключи — из `backend/.env` (docs/api_keys.md). Без ключа — skip с причиной, не fail. У Anthropic и
Gemini заодно проверяется, что модели из config/providers.yaml видны ключу: смена ID модели у
провайдера всплывёт здесь, а не на первой генерации. ElevenLabs показывает остаток символов.

Платные тесты запускаются вручную, с согласия:
- `-k anchors` (M5.3): одна картинка этапа `anchors` (Pro 1K, ~$0.13) с одним референсом и повтор
  из кэша за $0;
- `-k shot_image` (M6.2): один кадр выпуска джобом `shot_image` (профиль по умолчанию, ~$0.07) по
  канону фикстуры с листом облика из однотонных картинок; повтор заказа — без вызова и денег.
"""

import asyncio
import json
import struct
import time
import zlib
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.cost import ledger
from app.main import create_app
from app.models.canon import Character, Period, Style
from app.models.canon_config import ANGLES, load_canon_config
from app.pipeline.canon import anchors
from app.pipeline.canon.anchors import CandidateRecord
from app.providers.base import ImageRequest, image_mime
from app.providers.gateway import CallContext, Gateway, build_gateway
from app.settings import REPO_ROOT, Settings
from app.storage import canon_store
from app.storage.canon_store import CHARACTERS, PERIODS, STYLE
from app.storage.db import connect, migrate
from app.storage.paths import StudioPaths
from app.tools.seed import seed

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


def solid_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """Однотонный PNG без зависимостей: референс для живого теста."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    row = b"\x00" + bytes(rgb) * width
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(row * height))
        + chunk(b"IEND", b"")
    )


def test_anchors_image_is_paid_once_then_cached(tmp_path: Path) -> None:
    """Одна картинка Gemini Pro 1K (~$0.13) с одним референсом: файл в каноне канала, строка
    `charged` этапа `anchors` без выпуска; тот же запрос второй раз — `cached`, $0, без вызова."""
    data = tmp_path / "data"
    settings = Settings(studio_data_dir=data)  # ключ — из настоящего backend/.env
    if not settings.gemini_api_key.get_secret_value():
        pytest.skip("GEMINI_API_KEY не задан в backend/.env — см. docs/api_keys.md.")
    paths = StudioPaths(data)
    migrate(paths.db_path)
    conn = connect(paths.db_path)
    try:
        seed(paths, conn)
    finally:
        conn.close()
    gateway = build_gateway(settings, paths)

    swatch = paths.style_anchors_dir("cursus") / "live-swatch.png"
    swatch.parent.mkdir(parents=True)
    swatch.write_bytes(solid_png(64, 64, (176, 112, 64)))
    request = ImageRequest(
        prompt="A plain clay cup on a neutral grey studio background, even soft light."
        " Match the cup colour to the colour swatch in the reference image.",
        negative="text, watermark, people",
        refs=[gateway.image_ref(swatch)],
        seed=1,
        aspect_ratio="1:1",
    )
    ctx = CallContext(stage="anchors", channel="cursus")

    first = asyncio.run(gateway.call(ctx, request))
    assert first.status == "charged" and first.asset_path is not None
    image = first.asset_path.read_bytes()
    print(
        f"anchors: {first.route.model} {first.route.params} → {first.asset_path} ({len(image)} B)"
    )
    # Формат выбирает модель: `output_mime_type` в Gemini Developer API нет, Pro отдаёт JPEG.
    mime = image_mime(image)
    assert mime in ("image/png", "image/jpeg"), f"ожидалась картинка, сигнатура {image[:8]!r}"
    assert first.asset_path.suffix == {"image/png": ".png", "image/jpeg": ".jpg"}[mime]
    assert len(image) > 10_000

    second = asyncio.run(gateway.call(ctx, request))
    assert (second.status, second.asset_path, second.result) == ("cached", first.asset_path, None)

    conn = connect(paths.db_path)
    try:
        rows = ledger.list_rows(conn, channel="cursus")
    finally:
        conn.close()
    for row in rows:
        print(
            f"ledger: {row.status} {row.stage} {row.model} {row.variant} {row.usd} {row.episode_id}"
        )
    assert [(r.status, r.stage, r.episode_id, r.variant) for r in rows] == [
        ("charged", "anchors", None, "1K"),
        ("cached", "anchors", None, "1K"),
    ]
    assert rows[0].usd_micro > 0 and rows[1].usd_micro == 0


def test_shot_image_is_paid_once_then_not_again(tmp_path: Path) -> None:
    """Один кадр выпуска (~$0.07): заказ по утверждённому плану фикстуры, картинка — версия 1
    кадра, строка `charged` этапа `images` с выпуском, кадром и джобом; тот же заказ второй раз —
    та же версия, без вызова и без новой строки журнала."""
    settings = Settings(studio_data_dir=tmp_path / "data")  # ключ — из настоящего backend/.env
    if not settings.gemini_api_key.get_secret_value():
        pytest.skip("GEMINI_API_KEY не задан в backend/.env — см. docs/api_keys.md.")
    fixtures = REPO_ROOT / "tests" / "fixtures"
    plan = json.loads((fixtures / "director_canon_20shots.json").read_text(encoding="utf-8"))
    episode = plan["meta"]["episode_id"]
    paths = StudioPaths(settings.studio_data_dir)

    def canon(name: str) -> Any:
        return json.loads((fixtures / "canon" / name).read_text(encoding="utf-8"))

    def publish(layer: Any, entity_id: str | None, data: Any) -> None:
        canon_store.save_draft(paths, "cursus", layer, entity_id, data)
        canon_store.publish(paths, "cursus", layer, entity_id)

    with TestClient(create_app(settings)) as client:
        conn = connect(paths.db_path)
        try:
            seed(paths, conn)
        finally:
            conn.close()
        publish(STYLE, None, Style.model_validate(canon("style_cursus.json")))
        publish(
            PERIODS, "caribbean-1716", Period.model_validate(canon("period_caribbean_1716.json"))
        )
        publish(CHARACTERS, "you", Character.model_validate(canon("character_you.json")))
        publish(CHARACTERS, "bosun", Character.model_validate(canon("character_bosun.json")))
        config = load_canon_config(settings.config_dir / "canon.yaml")
        for number, appearance_id in enumerate(("you@powder-monkey-11", "bosun@caribbean-1716")):
            s = anchors.appearance_set(paths, "cursus", appearance_id)
            for index, angle in enumerate(ANGLES):
                path = s.files / f"{angle}-1-live{number}{index}.png"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(solid_png(64, 64, (120 + 20 * number, 90 + 10 * index, 70)))
                record = CandidateRecord(
                    id=path.stem,
                    slot=angle,
                    n=1,
                    status="ready",
                    file=path.relative_to(s.root).as_posix(),
                    seed=1,
                    version="v001",
                    canon={},
                    created_at="2026-10-22T00:00:00+00:00",
                )
                anchors.record_candidate(s, record)
                anchors.choose(paths, "cursus", appearance_id, angle, record.id, config)

        def ok(response: Any, status: int = 200) -> Any:
            assert response.status_code == status, response.text
            return response.json()

        def draw() -> dict[str, Any]:
            job = ok(client.post(f"/api/projects/{episode}/shots/s002/generate", json={}), 201)
            deadline = time.monotonic() + 240
            while True:
                state: dict[str, Any] = ok(client.get(f"/api/jobs/{job['id']}"))
                if state["status"] in ("done", "failed", "cancelled"):
                    return state
                assert time.monotonic() < deadline, f"job stuck: {state}"
                time.sleep(0.5)

        ok(
            client.post(
                "/api/episodes", json={"id": episode, "channel": "cursus", "title": "Live"}
            ),
            201,
        )
        ok(client.post(f"/api/projects/{episode}/director", json=plan))
        ok(client.post(f"/api/episodes/{episode}/approve"))

        first = draw()
        print(f"shot_image: {first['status']} {first['result']} {first['error']}")
        assert first["status"] == "done", first["error"]
        assert first["result"]["status"] == "charged" and first["result"]["version"] == 1
        images = ok(client.get(f"/api/projects/{episode}/shots/s002/images"))
        version = images["versions"][0]
        print(f"version: {version['path']} {version['model']} {version['model_id']}")
        assert (images["status"], images["image_version"]) == ("done", 1)
        thumb = client.get(f"/api/projects/{episode}/shots/s002/images/1/thumb?w=320")
        assert thumb.status_code == 200 and thumb.headers["content-type"] == "image/webp"

        second = draw()
        assert second["result"] == {
            "shot_id": "s002",
            "version": 1,
            "status": "exists",
            "usd_micro": 0,
        }

    conn = connect(paths.db_path)
    try:
        rows = [r for r in ledger.list_rows(conn, channel="cursus") if r.stage == "images"]
    finally:
        conn.close()
    for row in rows:
        print(
            f"ledger: {row.status} {row.stage} {row.model} {row.usd} {row.episode_id} {row.shot_id}"
        )
    assert [(r.status, r.episode_id, r.shot_id, r.job_id) for r in rows] == [
        ("charged", episode, "s002", first["id"])
    ]
    assert rows[0].usd_micro > 0
