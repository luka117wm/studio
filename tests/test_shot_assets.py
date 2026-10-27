"""M6.1: картинка кадра как ассет — версии на диске, миниатюры, выбранная версия, API."""

import json
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.models.project import Asset, Project
from app.pipeline.images.shot_assets import Drawing, NotAnImage, add_image_version
from app.settings import Settings
from app.storage.atomic import read_json, write_bytes_new
from app.storage.db import connect
from app.storage.paths import StudioPaths
from app.tools.seed import seed

FIXTURES = Path(__file__).parent / "fixtures"
EPISODE = "c07-pirate-ship"
SHOTS_URL = f"/api/projects/{EPISODE}/shots"

# Фикстура `draw` из conftest.py.
DrawShot = Callable[..., Asset]


def load(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return data


def picture(ext: str, width: int = 640, height: int = 360) -> bytes:
    ok, encoded = cv2.imencode(ext, np.full((height, width, 3), (40, 90, 160), dtype=np.uint8))
    assert ok
    return encoded.tobytes()


def decoded(data: bytes) -> np.ndarray:
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert image is not None
    return image


@pytest.fixture
def paths(settings: Settings) -> StudioPaths:
    return StudioPaths(settings.studio_data_dir)


@pytest.fixture
def planned(client: TestClient, paths: StudioPaths) -> Iterator[TestClient]:
    """Каналы засеяны, выпуск создан, план v001 (10 кадров) импортирован."""
    conn = connect(paths.db_path)
    try:
        seed(paths, conn)
    finally:
        conn.close()
    created = client.post(
        "/api/episodes", json={"id": EPISODE, "channel": "cursus", "title": "Pirate"}
    )
    assert created.status_code == 201, created.text
    imported = client.post(
        f"/api/projects/{EPISODE}/director", json=load("director_pirate_10shots.json")
    )
    assert imported.status_code == 200, imported.text
    yield client


def project(paths: StudioPaths) -> dict[str, Any]:
    data: dict[str, Any] = read_json(paths.project_path("cursus", EPISODE))
    return data


def files(folder: Path) -> list[str]:
    return sorted(p.name for p in folder.iterdir() if p.is_file())


# --- версии на диске ------------------------------------------------------------------------------


def test_three_versions_are_three_files_six_thumbs_and_first_is_chosen(
    planned: TestClient, paths: StudioPaths, draw: DrawShot
) -> None:
    for variant in (1, 2, 3):
        draw(EPISODE, "s001", data=picture(".png"), variant=variant)

    media = paths.shot_media_dir("cursus", EPISODE, "s001")
    assert media == paths.episode_dir("cursus", EPISODE) / "media" / "s001"
    assert files(media) == ["v001.png", "v002.png", "v003.png"]
    assert files(media / "thumbs") == [f"v00{n}-{w}.webp" for n in (1, 2, 3) for w in (160, 320)]
    thumb = decoded((media / "thumbs" / "v002-320.webp").read_bytes())
    assert thumb.shape[:2] == (180, 320)

    on_disk = project(paths)
    assert on_disk["shots"]["s001"]["status"] == "done"
    assert on_disk["shots"]["s001"]["image_version"] == 1
    assert list(on_disk["assets"]) == ["img-s001-v1", "img-s001-v2", "img-s001-v3"]
    second = on_disk["assets"]["img-s001-v2"]
    created_at = second.pop("created_at")
    assert created_at.endswith("+00:00")
    assert second == {
        "id": "img-s001-v2",
        "shot_id": "s001",
        "kind": "image",
        "version": 2,
        "path": "media/s001/v002.png",
        "hash": "sha256:s001-2",
        "status": "ok",
        "model": "nb2",
        "seed": 1002,
        "variant": 2,
        "usd_micro": 67_000,
        "cached": False,
    }
    # Остальные кадры не тронуты: нет картинки — нет поля.
    assert "image_version" not in on_disk["shots"]["s002"]

    chosen = planned.post(f"{SHOTS_URL}/s001/images/3/choose")
    assert chosen.status_code == 200, chosen.text
    assert (chosen.json()["image_version"], chosen.json()["status"]) == (3, "done")
    assert project(paths)["shots"]["s001"]["image_version"] == 3
    # Выбор не трогает файлы.
    assert files(media) == ["v001.png", "v002.png", "v003.png"]


def test_next_number_is_after_last_on_disk_and_in_assets(
    planned: TestClient, paths: StudioPaths, draw: DrawShot
) -> None:
    # Файл без строки в `assets` (сбой между файлом и project.json) свой номер не отдаёт.
    stray = paths.shot_image_path("cursus", EPISODE, "s002", 4, "png")
    write_bytes_new(stray, picture(".png"))
    assert draw(EPISODE, "s002").version == 5
    assert draw(EPISODE, "s002", variant=2).version == 6
    assert stray.read_bytes() == picture(".png")
    assert files(paths.shot_media_dir("cursus", EPISODE, "s002")) == [
        "v004.png",
        "v005.png",
        "v006.png",
    ]


def test_extension_follows_image_signature(
    planned: TestClient, paths: StudioPaths, draw: DrawShot
) -> None:
    jpeg, webp = picture(".jpg"), picture(".webp")
    assert draw(EPISODE, "s003", data=jpeg).path == "media/s003/v001.jpg"
    assert draw(EPISODE, "s003", data=webp, variant=2).path == "media/s003/v002.webp"

    for version, data, mime in ((1, jpeg, "image/jpeg"), (2, webp, "image/webp")):
        response = planned.get(f"{SHOTS_URL}/s003/images/{version}/file")
        assert response.status_code == 200, response.text
        assert response.headers["content-type"] == mime
        assert response.headers["cache-control"] == "public, max-age=31536000, immutable"
        assert response.content == data


def test_not_an_image_writes_nothing(planned: TestClient, paths: StudioPaths) -> None:
    before = project(paths)
    with pytest.raises(NotAnImage, match="кадр s004: ответ модели — не PNG, JPEG или WEBP"):
        add_image_version(
            paths,
            "cursus",
            EPISODE,
            "s004",
            b"<html>quota exceeded</html>",
            Drawing(
                input_hash="sha256:x",
                model="nb2",
                seed=1,
                variant=1,
                usd_micro=67_000,
                cached=False,
            ),
        )
    assert project(paths) == before
    assert not paths.shot_media_dir("cursus", EPISODE, "s004").exists()


def test_version_file_is_never_overwritten(tmp_path: Path) -> None:
    path = tmp_path / "media" / "s001" / "v001.png"
    write_bytes_new(path, b"first")
    with pytest.raises(FileExistsError):
        write_bytes_new(path, b"second")
    assert path.read_bytes() == b"first"
    assert files(path.parent) == ["v001.png"]  # temp-файл убран


def test_chosen_version_must_be_an_image_of_this_shot() -> None:
    def build(image_version: int, asset_shot: str) -> Project:
        asset = {
            "id": "img-s001-v1",
            "shot_id": asset_shot,
            "kind": "image",
            "version": 1,
            "path": f"media/{asset_shot}/v001.png",
            "hash": "h",
        }
        return Project.model_validate(
            {
                "schema": "studio.project/1",
                "episode_id": EPISODE,
                "channel": "cursus",
                "shots": {"s001": {"status": "done", "image_version": image_version}},
                "assets": {"img-s001-v1": asset},
                "updated_at": "t0",
            }
        )

    assert build(1, "s001").shots["s001"].has_image
    with pytest.raises(ValidationError, match="s001 image_version 2 has no image asset"):
        build(2, "s001")
    with pytest.raises(ValidationError, match="s001 image_version 1 has no image asset"):
        build(1, "s002")


# --- выбор и статус -------------------------------------------------------------------------------


def test_new_version_waits_for_choice_unless_chosen_one_is_stale(
    planned: TestClient, paths: StudioPaths, draw: DrawShot
) -> None:
    draw(EPISODE, "s002")
    draw(EPISODE, "s002", variant=2)
    state = project(paths)["shots"]["s002"]
    # У готового кадра новая версия — вариант на выбор: решает человек (M6.9).
    assert (state["status"], state["image_version"]) == ("done", 1)
    planned.post(f"{SHOTS_URL}/s002/images/2/choose")
    state = project(paths)["shots"]["s002"]
    assert (state["status"], state["image_version"], state["stale_reasons"]) == ("done", 2, [])

    # v2 плана меняет промпт s002: выбранная картинка устарела — новая версия выбирается сама
    # (M6.2, решение пользователя): иначе пачка «все stale» рисовала бы кадр снова.
    imported = planned.post(
        f"/api/projects/{EPISODE}/director", json=load("director_pirate_v2.json")
    )
    assert imported.status_code == 200, imported.text
    state = project(paths)["shots"]["s002"]
    assert (state["status"], state["image_version"]) == ("stale", 2)
    draw(EPISODE, "s002", variant=3)
    state = project(paths)["shots"]["s002"]
    assert (state["status"], state["image_version"], state["stale_reasons"]) == ("done", 3, [])


def test_first_version_clears_history_of_shot_without_image(
    planned: TestClient, paths: StudioPaths, draw: DrawShot
) -> None:
    # Без картинки изменение промпта — история, не статус; первая картинка её закрывает.
    planned.post(f"/api/projects/{EPISODE}/director", json=load("director_pirate_v2.json"))
    state = project(paths)["shots"]["s002"]
    assert state["status"] == "todo" and state["stale_reasons"]
    draw(EPISODE, "s002")
    state = project(paths)["shots"]["s002"]
    assert (state["status"], state["image_version"], state["stale_reasons"]) == ("done", 1, [])


def test_version_of_removed_shot_keeps_it_removed(
    planned: TestClient, paths: StudioPaths, draw: DrawShot
) -> None:
    # Джоб закончил после импорта, убравшего кадр: версия записана, кадр в план не вернулся.
    planned.post(f"/api/projects/{EPISODE}/director", json=load("director_pirate_v2.json"))
    draw(EPISODE, "s006")
    state = project(paths)["shots"]["s006"]
    assert (state["status"], state["image_version"]) == ("removed", 1)


# --- API ------------------------------------------------------------------------------------------


def test_list_is_newest_first_with_metadata(
    planned: TestClient, paths: StudioPaths, draw: DrawShot
) -> None:
    draw(EPISODE, "s001")
    draw(EPISODE, "s001", variant=2, cached=True)
    response = planned.get(f"{SHOTS_URL}/s001/images")
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["shot_id"], body["status"], body["image_version"]) == ("s001", "done", 1)
    assert [v["version"] for v in body["versions"]] == [2, 1]
    assert body["versions"][0] == project(paths)["assets"]["img-s001-v2"]
    assert (body["versions"][0]["cached"], body["versions"][0]["usd_micro"]) == (True, 0)
    # Хэши фикстуры — не запросы сборщика: ни одна версия не нарисована по действующему запросу.
    assert body["matches_plan"] == []

    empty = planned.get(f"{SHOTS_URL}/s004/images").json()
    assert empty == {
        "shot_id": "s004",
        "status": "todo",
        "image_version": None,
        "versions": [],
        "matches_plan": [],
    }


def test_missing_thumb_is_built_on_request(
    planned: TestClient, paths: StudioPaths, draw: DrawShot
) -> None:
    draw(EPISODE, "s001", data=picture(".png"))
    thumbs = paths.shot_thumbs_dir("cursus", EPISODE, "s001")
    # Данные до M6.1 — версия без миниатюр.
    for name in files(thumbs):
        (thumbs / name).unlink()

    response = planned.get(f"{SHOTS_URL}/s001/images/1/thumb?w=160")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "image/webp"
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert decoded(response.content).shape[:2] == (90, 160)
    assert files(thumbs) == ["v001-160.webp"]
    assert decoded(planned.get(f"{SHOTS_URL}/s001/images/1/thumb").content).shape[1] == 320


def test_wrong_episode_shot_or_version_is_404(
    planned: TestClient, paths: StudioPaths, draw: DrawShot
) -> None:
    draw(EPISODE, "s001")
    draw(EPISODE, "s002")
    draw(EPISODE, "s002", variant=2)
    before = project(paths)

    def detail(method: str, url: str) -> str:
        response = planned.request(method, url)
        assert response.status_code == 404, response.text
        message: str = response.json()["detail"]
        return message

    assert detail("GET", "/api/projects/nope/shots/s001/images") == "Выпуск «nope» не найден."
    planned.post("/api/episodes", json={"id": "c08-empty", "channel": "cursus", "title": "Empty"})
    assert detail("GET", "/api/projects/c08-empty/shots/s001/images") == (
        "План ещё не импортирован — кадров нет. Импортируйте план на экране «Сценарий»."
    )
    assert detail("GET", f"{SHOTS_URL}/s099/images") == (
        "Кадра s099 нет в плане v001 — проверьте id кадра."
    )
    # Версия 2 есть у s002, не у s001.
    assert detail("GET", f"{SHOTS_URL}/s001/images/2/file") == (
        "У кадра s001 нет версии 2 — есть 1."
    )
    assert detail("GET", f"{SHOTS_URL}/s001/images/2/thumb") == (
        "У кадра s001 нет версии 2 — есть 1."
    )
    assert detail("POST", f"{SHOTS_URL}/s001/images/2/choose") == (
        "У кадра s001 нет версии 2 — есть 1."
    )
    assert detail("POST", f"{SHOTS_URL}/s004/images/1/choose") == (
        "У кадра s004 ещё нет картинок — сначала сгенерируйте кадр."
    )
    assert project(paths) == before

    planned.post(f"/api/projects/{EPISODE}/director", json=load("director_pirate_v2.json"))
    assert detail("GET", f"{SHOTS_URL}/s006/images") == (
        "Кадр s006 убран из плана v002 — картинок у него нет."
    )


def test_thumb_width_is_160_or_320(planned: TestClient, draw: DrawShot) -> None:
    draw(EPISODE, "s001")
    response = planned.get(f"{SHOTS_URL}/s001/images/1/thumb?w=200")
    assert response.status_code == 422
    assert [e["msg"] for e in response.json()["detail"]] == [
        "Ширины миниатюры 200 нет — есть 160 и 320."
    ]
