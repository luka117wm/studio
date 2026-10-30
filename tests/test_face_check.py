"""M6.5: проверка лица — сходство версии кадра с выбранным фасом облика, статусы `ok`, `low`,
`no_face`, `skipped`, кэш фаса, проверка внутри `shot_image`, перепроверка `shot_check`,
статус выпуска, скачивание весов.

Логика — на фейковой модели лица (без весов): картинка — сплошная заливка, её уровень называет,
какие лица в ней; кадры фейкового провайдера — шум, для них лица — `FakeFaces.frame`. Настоящие
веса — `-m models` вручную после `fetch_models`, на своих картинках `tests/fixtures/faces/`."""

import hashlib
import logging
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import cv2
import httpx
import numpy as np
import pytest

from app.models.canon_config import FRONT
from app.models.checks_config import ChecksConfig, FaceCheckConfig, load_checks_config
from app.models.project import FaceCheck
from app.pipeline.canon import anchors
from app.pipeline.checks import face as face_module
from app.pipeline.checks.face import Face, FaceChecker, Front, Image, Vector
from app.settings import REPO_ROOT, Settings
from app.tools import fetch_models
from episode_env import BASE, BOSUN, EPISODE, YOU, Env, make_env

CONFIG = load_checks_config(REPO_ROOT / "config" / "checks.yaml")
FACE = CONFIG.face
FACES = REPO_ROOT / "tests" / "fixtures" / "faces"
THRESHOLD = FACE.threshold
BIG = 120.0  # сторона лица, px: больше `min_face_px`

E1: list[float] = [1.0, 0.0, 0.0]
E2: list[float] = [0.0, 1.0, 0.0]
# Косинус с E1 — 0.6: выше порога 0.47; с E2 — 0.8.
NEAR: list[float] = [0.6, 0.8, 0.0]
# Косинус с E1 — 0.2: ниже порога.
FAR: list[float] = [0.2, 0.0, 0.98]


class FakeFaces:
    """Модель лица без весов. Уровень серого заливки → лица `(сторона, эмбеддинг)`; картинка не
    из словаря (шум фейкового провайдера) — `frame`. Номер лица — в `x` его рамки."""

    def __init__(self, levels: dict[int, list[tuple[float, list[float]]]] | None = None) -> None:
        self.levels = levels or {}
        self.frame: list[tuple[float, list[float]]] = [(BIG, E1)]
        self.detected: list[tuple[int, ...]] = []

    def _faces(self, image: Image) -> list[tuple[float, list[float]]]:
        level = int(round(float(image.mean())))
        return self.levels.get(level, self.frame)

    def detect(self, image: Image) -> list[Face]:
        self.detected.append(image.shape)
        return [
            Face(np.array([i, 0, size, size, *[0.0] * 10, 0.99], dtype=np.float32))
            for i, (size, _) in enumerate(self._faces(image))
        ]

    def embed(self, image: Image, face: Face) -> Vector:
        return np.array(self._faces(image)[int(face.row[0])][1], dtype=np.float32)


def solid(path: Path, level: int, size: tuple[int, int] = (240, 180)) -> Path:
    """Картинка-заливка: уровень серого называет её лица для `FakeFaces`."""
    width, height = size
    path.parent.mkdir(parents=True, exist_ok=True)
    ok, encoded = cv2.imencode(".png", np.full((height, width, 3), level, dtype=np.uint8))
    assert ok
    path.write_bytes(encoded.tobytes())
    return path


def checker_with(model: FakeFaces, **config: Any) -> FaceChecker:
    return FaceChecker(FACE.model_copy(update=config), Path("/nonexistent"), lambda *_: model)


def scores(check: FaceCheck | None) -> list[tuple[str, str, float | None]]:
    assert check is not None
    return [(m.id, m.status, m.score) for m in check.appearances]


# --- логика сходства и статусов (фейковая модель) ------------------------------------------------


def test_best_score_among_faces_decides_ok_and_low(tmp_path: Path) -> None:
    model = FakeFaces({10: [(BIG, E1)], 20: [(BIG, E2)], 30: [(BIG, FAR), (BIG, NEAR)]})
    checker = checker_with(model)
    frame = solid(tmp_path / "frame.png", 30)
    check = checker.check(
        [
            Front("a", solid(tmp_path / "a.png", 10), "front-a"),
            Front("b", solid(tmp_path / "b.png", 20), "front-b"),
        ],
        frame,
    )
    assert check is not None
    # Лучшее среди двух лиц кадра: у a — 0.6 (NEAR), у b — 0.8 (NEAR).
    assert scores(check) == [("a", "ok", 0.6), ("b", "ok", 0.8)]
    assert (check.status, check.faces, check.threshold, check.reason) == ("ok", 2, THRESHOLD, None)
    assert [m.front for m in check.appearances] == ["front-a", "front-b"]

    model.levels[30] = [(BIG, FAR)]
    low = checker.check([Front("a", tmp_path / "a.png", "front-a")], frame)
    assert low is not None
    assert (low.status, scores(low)) == ("low", [("a", "low", 0.2)])


def test_one_low_appearance_makes_the_frame_low(tmp_path: Path) -> None:
    model = FakeFaces({10: [(BIG, E1)], 20: [(BIG, E2)], 30: [(BIG, E1)]})
    check = checker_with(model).check(
        [Front("a", solid(tmp_path / "a.png", 10)), Front("b", solid(tmp_path / "b.png", 20))],
        solid(tmp_path / "frame.png", 30),
    )
    assert check is not None
    assert (check.status, scores(check)) == ("low", [("a", "ok", 1.0), ("b", "low", 0.0)])


def test_frame_without_faces_is_no_face_not_a_suspect(tmp_path: Path) -> None:
    model = FakeFaces({10: [(BIG, E1)], 30: []})
    check = checker_with(model).check(
        [Front("a", solid(tmp_path / "a.png", 10))], solid(tmp_path / "frame.png", 30)
    )
    assert check is not None
    assert (check.status, check.faces, scores(check)) == ("no_face", 0, [("a", "no_face", None)])


def test_faces_smaller_than_min_size_are_not_checked(tmp_path: Path) -> None:
    small = float(FACE.min_face_px - 1)
    model = FakeFaces({10: [(BIG, E1)], 30: [(small, E1), (small, E1)]})
    check = checker_with(model).check(
        [Front("a", solid(tmp_path / "a.png", 10))], solid(tmp_path / "frame.png", 30)
    )
    assert check is not None and (check.status, check.faces) == ("no_face", 0)


def test_front_without_face_skips_that_appearance_only(tmp_path: Path) -> None:
    model = FakeFaces({10: [(BIG, E1)], 20: [], 30: [(BIG, E1)]})
    check = checker_with(model).check(
        [
            Front("a", solid(tmp_path / "a.png", 10)),
            Front("b", solid(tmp_path / "b.png", 20), "front-b"),
        ],
        solid(tmp_path / "frame.png", 30),
    )
    assert check is not None
    assert (check.status, scores(check)) == ("ok", [("a", "ok", 1.0), ("b", "skipped", None)])
    assert check.appearances[1].reason == (
        "На фасе облика b лицо не найдено — выберите другой фас на экране «Канон»."
    )


def test_only_skipped_appearances_make_the_frame_skipped(tmp_path: Path) -> None:
    model = FakeFaces({30: [(BIG, E1)]})
    broken = tmp_path / "broken.png"
    broken.write_bytes(b"\x89PNG\r\n\x1a\nnot really")
    check = checker_with(model).check(
        [Front("a", None, reason="нет фаса"), Front("b", broken)], solid(tmp_path / "f.png", 30)
    )
    assert check is not None
    assert (check.status, scores(check)) == (
        "skipped",
        [("a", "skipped", None), ("b", "skipped", None)],
    )
    assert [m.reason for m in check.appearances] == [
        "нет фаса",
        "Фас облика b не читается как картинка — перегенерируйте фас на экране «Канон».",
    ]


def test_front_embedding_is_cached_by_file_hash(tmp_path: Path) -> None:
    model = FakeFaces({10: [(BIG, E1)], 30: [(BIG, E1)]})
    checker = checker_with(model)
    front = solid(tmp_path / "a.png", 10)
    frame = solid(tmp_path / "frame.png", 30)
    checker.check([Front("a", front)], frame)
    assert len(model.detected) == 2  # фас и кадр
    # Тот же файл и его копия по другому пути — фас не детектится заново.
    copy = tmp_path / "copy" / "a.png"
    copy.parent.mkdir()
    copy.write_bytes(front.read_bytes())
    checker.check([Front("a", front)], frame)
    checker.check([Front("a2", copy)], frame)
    assert len(model.detected) == 4  # только кадры
    # Другой файл фаса (перевыбран) — другой хэш, считается заново.
    solid(front, 10, size=(250, 180))
    checker.check([Front("a", front)], frame)
    assert len(model.detected) == 6


def test_big_frame_is_downscaled_before_detection(tmp_path: Path) -> None:
    model = FakeFaces({10: [(BIG, E1)], 30: [(BIG, E1)]})
    checker_with(model, detect_max_side=640).check(
        [Front("a", solid(tmp_path / "a.png", 10))], solid(tmp_path / "f.png", 30, (2000, 1000))
    )
    # Кадр 2000×1000 уменьшен до 640 по большей стороне, фас 240×180 — как был.
    assert sorted(model.detected) == [(180, 240, 3), (320, 640, 3)]


def test_without_weights_check_is_skipped_with_hint_and_warns_once(
    tmp_path: Path, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(face_module, "_WARNED", set())
    checker = FaceChecker(FACE, tmp_path / "models")
    front = Front("a", solid(tmp_path / "a.png", 10), "front-a")
    with caplog.at_level(logging.WARNING, logger="app.pipeline.checks.face"):
        first = checker.check([front], solid(tmp_path / "f.png", 30))
        checker.check([front], tmp_path / "f.png")
    assert first is not None
    assert (first.status, scores(first)) == ("skipped", [("a", "skipped", None)])
    assert first.reason == (
        "Нет весов проверки лица (face_detection_yunet_2023mar.onnx) — запустите"
        " `PYTHONPATH=backend uv run python -m app.tools.fetch_models`."
    )
    assert caplog.text.count("face check skipped") == 1


def test_weights_with_wrong_hash_are_not_loaded(tmp_path: Path) -> None:
    models = tmp_path / "models"
    models.mkdir()
    for weight in (FACE.models.detector, FACE.models.recognizer):
        (models / weight.file).write_bytes(b"not the weights")
    check = FaceChecker(FACE, models).check(
        [Front("a", solid(tmp_path / "a.png", 10))], solid(tmp_path / "f.png", 30)
    )
    assert check is not None and check.status == "skipped"
    assert check.reason is not None and "не совпали по sha256" in check.reason


def test_model_failure_is_skipped_not_raised(tmp_path: Path) -> None:
    def broken(*_: Any) -> FakeFaces:
        raise RuntimeError("onnx says no")

    check = FaceChecker(FACE, tmp_path, broken).check(
        [Front("a", solid(tmp_path / "a.png", 10))], solid(tmp_path / "f.png", 30)
    )
    assert check is not None
    assert (check.status, check.reason) == (
        "skipped",
        "Сбой проверки лица (RuntimeError): onnx says no — перепроверьте кадр.",
    )


def test_unreadable_frame_is_skipped(tmp_path: Path) -> None:
    frame = tmp_path / "frame.png"
    frame.write_bytes(b"garbage")
    check = checker_with(FakeFaces({10: [(BIG, E1)]})).check(
        [Front("a", solid(tmp_path / "a.png", 10))], frame
    )
    assert check is not None
    assert (check.status, check.reason) == (
        "skipped",
        "Картинка версии не читается — лицо не проверено.",
    )


def test_shot_without_appearances_is_not_checked(tmp_path: Path) -> None:
    model = FakeFaces()
    assert checker_with(model).check_shot(None, "cursus", [], tmp_path / "f.png") is None  # type: ignore[arg-type]
    assert model.detected == []


# --- в джобе кадра и перепроверке (окружение выпуска, фейковый провайдер) -------------------------


@pytest.fixture
def faces(monkeypatch: pytest.MonkeyPatch) -> FakeFaces:
    """Модель лица для пула джобов: фас YOU — E1, фас BOSUN — E2, кадры — `frame`."""
    model = FakeFaces({10: [(BIG, E1)], 20: [(BIG, E2)]})
    monkeypatch.setattr(face_module, "load_model", lambda *_: model)
    return model


@pytest.fixture
def env(tmp_path: Path, faces: FakeFaces) -> Iterator[Env]:
    with make_env(tmp_path) as env:
        # Фасы листа — заливки, по которым фейковая модель узнаёт облик (листы окружения — не
        # картинки). До заказов: хэш фаса идёт в референсы кадра.
        for appearance_id, level in ((YOU, 10), (BOSUN, 20)):
            s = anchors.appearance_set(env.paths, "cursus", appearance_id)
            solid(s.root / anchors.read_chosen(s).slots[FRONT].file, level)
        yield env


def version_face(env: Env, shot_id: str, version: int = 1) -> dict[str, Any] | None:
    asset = env.project()["assets"][f"img-{shot_id}-v{version}"]
    checks: dict[str, Any] | None = asset.get("checks")
    return None if checks is None else checks.get("face")


def wait_until(predicate: Any, timeout: float = 10) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        assert time.monotonic() < deadline, "condition not met"
        time.sleep(0.02)


def episode_status(env: Env) -> str:
    status: str = env.get(f"/api/episodes/{EPISODE}")["status"]
    return status


def test_new_version_carries_its_face_check(env: Env, faces: FakeFaces) -> None:
    front = anchors.read_chosen(anchors.appearance_set(env.paths, "cursus", YOU)).slots[FRONT]
    assert env.draw("s002")["status"] == "done"
    face = version_face(env, "s002")
    assert face is not None
    face.pop("checked_at")
    assert face == {
        "status": "ok",
        "appearances": [{"id": YOU, "status": "ok", "score": 1.0, "front": front.candidate}],
        "faces": 1,
        "threshold": THRESHOLD,
    }
    # Два облика: у каждого своё сходство, лучшее среди лиц кадра.
    faces.frame = [(BIG, E1), (BIG, NEAR)]
    assert env.draw("s006")["status"] == "done"
    two = version_face(env, "s006")
    assert two is not None
    assert [(a["id"], a["status"], a["score"]) for a in two["appearances"]] == [
        (YOU, "ok", 1.0),
        (BOSUN, "ok", 0.8),
    ]


def test_low_version_is_still_chosen_and_nothing_is_blocked(env: Env, faces: FakeFaces) -> None:
    faces.frame = [(BIG, FAR)]
    assert env.draw("s002")["status"] == "done"
    face = version_face(env, "s002")
    assert face is not None and (face["status"], face["appearances"][0]["score"]) == ("low", 0.2)
    # Пометка не блокирует: версия выбрана, кадр готов, следующий кадр ставится, стадия та же.
    state = env.shot("s002")
    assert (state["status"], state["image_version"], "error" in state) == ("done", 1, False)
    assert env.draw("s003")["status"] == "done"
    assert env.get(f"/api/episodes/{EPISODE}")["stage"] == "generate"


def test_shot_without_appearances_gets_no_face_check(env: Env, faces: FakeFaces) -> None:
    assert env.draw("s001")["status"] == "done"
    checks = env.project()["assets"]["img-s001-v1"]["checks"]
    # Лица нет; анахронизмы в окружении выключены — `off` (M6.6).
    assert ("face" in checks, checks["anachronism"]["status"]) == (False, "off")
    assert faces.detected == []


def test_without_weights_shot_image_finishes_with_skipped(tmp_path: Path) -> None:
    with make_env(tmp_path) as env:
        done = env.draw("s002")
        assert (done["status"], done["message"]) == ("done", "Кадр s002 · готово: версия 1")
        face = version_face(env, "s002")
        assert face is not None and face["status"] == "skipped"
        assert "fetch_models" in face["reason"]
        assert env.shot("s002")["status"] == "done"


def test_low_mark_on_chosen_version_makes_episode_warning(env: Env, faces: FakeFaces) -> None:
    faces.frame = [(BIG, E1), (BIG, E2)]  # в кадре оба: и YOU, и BOSUN похожи на свои фасы
    created = env.post(f"{BASE}/generate", {})
    batch = created["batch"]["id"]
    wait_until(lambda: env.get(f"/api/batches/{batch}")["finished"])
    wait_until(lambda: episode_status(env) == "ready")

    # Перепроверка с другим итогом: лицо кадра больше не похоже — выпуск `warning`.
    faces.frame = [(BIG, FAR)]
    job = env.post(f"{BASE}/shots/s002/check")
    assert (job["kind"], job["episode_id"], job["cost_usd_micro"]) == ("shot_check", EPISODE, None)
    done = env.wait(job["id"])
    assert done["status"] == "done", done
    assert done["result"] == {"shot_id": "s002", "version": 1, "face": "low", "anachronism": "off"}
    assert done["message"] == (
        "Кадр s002 · версия 1 · не похож на фас — посмотрите кадр; проверка анахронизмов выключена"
    )
    wait_until(lambda: episode_status(env) == "warning")
    assert env.shot("s002")["status"] == "done"

    # `no_face` — не пометка: снова `ready`.
    faces.frame = []
    env.wait(env.post(f"{BASE}/shots/s002/check")["id"])
    face = version_face(env, "s002")
    assert face is not None and face["status"] == "no_face"
    wait_until(lambda: episode_status(env) == "ready")


def test_check_rechecks_the_chosen_version_and_keeps_other_versions(
    env: Env, faces: FakeFaces
) -> None:
    assert env.draw("s002")["status"] == "done"
    first = version_face(env, "s002")
    redraw = env.post(f"{BASE}/shots/s002/redraw", {})
    assert env.wait(redraw["id"])["status"] == "done"
    second = version_face(env, "s002", 2)
    assert env.shot("s002")["image_version"] == 1  # готовый кадр: вторая ждёт выбора

    faces.frame = [(BIG, NEAR)]
    env.wait(env.post(f"{BASE}/shots/s002/check")["id"])
    rechecked = version_face(env, "s002")
    assert first is not None and rechecked is not None
    assert rechecked["appearances"][0]["score"] == 0.6
    assert rechecked["checked_at"] >= first["checked_at"]
    assert version_face(env, "s002", 2) == second


def test_check_errors(env: Env, faces: FakeFaces) -> None:
    response = env.client.post(f"{BASE}/shots/s002/check")
    assert (response.status_code, response.json()["detail"]) == (
        404,
        "У кадра s002 ещё нет картинок — сначала сгенерируйте кадр.",
    )
    assert env.draw("s001")["status"] == "done"
    response = env.client.post(f"{BASE}/shots/s001/check")
    assert (response.status_code, response.json()["detail"]) == (
        409,
        "В кадре s001 нет персонажей, а проверка анахронизмов выключена в профиле канала —"
        " проверять нечего.",
    )
    response = env.client.post(f"{BASE}/shots/s099/check")
    assert response.status_code == 404
    assert response.json()["detail"] == "Кадра s099 нет в плане v001 — проверьте id кадра."


def test_check_of_version_not_chosen_says_choose(env: Env, faces: FakeFaces) -> None:
    assert env.draw("s002")["status"] == "done"
    project = env.project()
    project["shots"]["s002"].pop("image_version")
    project["shots"]["s002"]["status"] = "todo"
    env.write_project(project)
    response = env.client.post(f"{BASE}/shots/s002/check")
    assert (response.status_code, response.json()["detail"]) == (
        404,
        "У кадра s002 не выбрана картинка — выберите версию, потом проверяйте.",
    )


# --- скачивание весов ---------------------------------------------------------------------------


DETECTOR, RECOGNIZER = b"yunet weights", b"sface weights"


def weights_config(*, urls: list[str] | None = None) -> ChecksConfig:
    def weight(file: str, data: bytes) -> dict[str, Any]:
        return {
            "file": file,
            "sha256": hashlib.sha256(data).hexdigest(),
            "license": "MIT",
            "source": "test",
            "urls": urls or [f"https://zoo.test/{file}"],
        }

    face = FACE.model_dump()
    face["models"] = {
        "detector": weight("det.onnx", DETECTOR),
        "recognizer": weight("rec.onnx", RECOGNIZER),
    }
    return ChecksConfig(face=FaceCheckConfig.model_validate(face), anachronism=CONFIG.anachronism)


def serving(files: dict[str, bytes]) -> tuple[httpx.Client, list[str]]:
    requested: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        body = files.get(str(request.url))
        return httpx.Response(404) if body is None else httpx.Response(200, content=body)

    return httpx.Client(transport=httpx.MockTransport(handler)), requested


def test_fetch_downloads_checks_hash_and_second_run_downloads_nothing(tmp_path: Path) -> None:
    config = weights_config()
    client, requested = serving(
        {"https://zoo.test/det.onnx": DETECTOR, "https://zoo.test/rec.onnx": RECOGNIZER}
    )
    models = tmp_path / "models"
    first = fetch_models.fetch_all(config, models, client)
    assert [(r.file, r.status) for r in first] == [
        ("det.onnx", "downloaded"),
        ("rec.onnx", "downloaded"),
    ]
    assert (models / "det.onnx").read_bytes() == DETECTOR
    assert sorted(p.name for p in models.iterdir()) == ["det.onnx", "rec.onnx"]  # без .part
    requested.clear()
    again = fetch_models.fetch_all(config, models, client)
    assert [r.status for r in again] == ["present", "present"] and requested == []


def test_fetch_falls_back_to_mirror_and_replaces_a_damaged_file(tmp_path: Path) -> None:
    config = weights_config(urls=["https://zoo.test/bad", "https://mirror.test/good"])
    models = tmp_path / "models"
    models.mkdir()
    (models / "det.onnx").write_bytes(b"truncated")
    # Зеркало одно на оба файла: отдаёт то, что ждут по запросу, — первый URL отдаёт мусор.
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if "bad" in str(request.url):
            return httpx.Response(200, content=b"html error page")
        wanted = DETECTOR if len(seen) <= 2 else RECOGNIZER
        return httpx.Response(200, content=wanted)

    result = fetch_models.fetch_all(
        config, models, httpx.Client(transport=httpx.MockTransport(handler))
    )
    assert [(r.status, r.detail) for r in result] == [
        ("downloaded", "https://mirror.test/good"),
        ("downloaded", "https://mirror.test/good"),
    ]
    assert (models / "det.onnx").read_bytes() == DETECTOR
    assert sorted(p.name for p in models.iterdir()) == ["det.onnx", "rec.onnx"]


def test_fetch_failure_leaves_no_file(tmp_path: Path) -> None:
    client, _ = serving({"https://zoo.test/det.onnx": b"wrong", "https://zoo.test/rec.onnx": b""})
    models = tmp_path / "models"
    result = fetch_models.fetch_all(weights_config(), models, client)
    assert [r.status for r in result] == ["failed", "failed"]
    assert "sha256" in result[0].detail
    assert list(models.iterdir()) == []


def test_config_names_licensed_weights_with_their_hashes() -> None:
    detector, recognizer = FACE.models.detector, FACE.models.recognizer
    assert (detector.file, detector.license) == ("face_detection_yunet_2023mar.onnx", "MIT")
    assert (recognizer.file, recognizer.license) == (
        "face_recognition_sface_2021dec.onnx",
        "Apache-2.0",
    )
    assert all("opencv" in url for url in (*detector.urls, *recognizer.urls))
    # Тестовый каталог конфигов — копия рабочего: окружение выпуска проверяет то же.
    fixture = load_checks_config(REPO_ROOT / "tests" / "fixtures" / "config" / "checks.yaml")
    assert fixture == CONFIG


# --- настоящие веса: вручную после fetch_models -------------------------------------------------


@pytest.fixture(scope="module")
def real() -> FaceChecker:
    models = Settings().studio_data_dir / "models"
    for weight in (FACE.models.detector, FACE.models.recognizer):
        if not (models / weight.file).is_file():
            pytest.skip(f"нет весов в {models} — запустите {face_module.FETCH_COMMAND}")
    return FaceChecker(FACE, models)


def similarity(checker: FaceChecker, front: str, frame: str) -> FaceCheck:
    check = checker.check([Front(front, FACES / f"{front}.jpg", front)], FACES / f"{frame}.jpg")
    assert check is not None
    return check


@pytest.mark.models
@pytest.mark.parametrize("frame", ["a_three_quarter", "a_profile", "a_scene"])
def test_real_weights_same_boy_is_above_threshold(real: FaceChecker, frame: str) -> None:
    check = similarity(real, "a_front", frame)
    assert (check.status, check.faces) == ("ok", 1), check


@pytest.mark.models
@pytest.mark.parametrize(
    ("front", "frame"),
    [("a_front", "b_scene"), ("b_front", "a_three_quarter"), ("b_front", "a_scene")],
)
def test_real_weights_other_boy_is_low(real: FaceChecker, front: str, frame: str) -> None:
    assert similarity(real, front, frame).status == "low"


@pytest.mark.models
def test_real_weights_other_angle_is_closer_than_other_boy(real: FaceChecker) -> None:
    same = similarity(real, "a_front", "a_three_quarter").appearances[0].score
    other = similarity(real, "a_front", "b_front").appearances[0].score
    assert same is not None and other is not None and same > other


@pytest.mark.models
@pytest.mark.parametrize("frame", ["no_face", "a_wide"])
def test_real_weights_frame_without_checkable_face_is_no_face(
    real: FaceChecker, frame: str
) -> None:
    # `a_wide` — общий план: лица меньше `min_face_px`, «не проверено», не подозрение.
    check = similarity(real, "a_front", frame)
    assert (check.status, check.faces) == ("no_face", 0)


@pytest.mark.models
def test_real_weights_load_once_per_process(real: FaceChecker) -> None:
    other = FaceChecker(FACE, real.models_dir)
    assert face_module.load_model(FACE, real.models_dir) is face_module.load_model(
        other.config, other.models_dir
    )
