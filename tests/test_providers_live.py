"""Живая проверка ключей (M2.6): `uv run pytest -m live -v -rP` — запросы бесплатные.

Ключи — из `backend/.env` (docs/api_keys.md). Без ключа — skip с причиной, не fail. У Anthropic и
Gemini заодно проверяется, что модели из config/providers.yaml видны ключу: смена ID модели у
провайдера всплывёт здесь, а не на первой генерации. ElevenLabs показывает остаток символов.

Платный тест один — `-k anchors` (M5.3): одна картинка этапа `anchors` (Pro 1K, ~$0.13) с одним
референсом и повтор из кэша за $0. Запускается вручную, с согласия.
"""

import asyncio
import struct
import zlib
from pathlib import Path

import pytest

from app.cost import ledger
from app.providers.base import ImageRequest, image_mime
from app.providers.gateway import CallContext, Gateway, build_gateway
from app.settings import Settings
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
