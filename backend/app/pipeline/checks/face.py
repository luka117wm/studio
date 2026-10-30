"""Проверка лица (M6.5; устав M6, решение 7): похож ли персонаж кадра на себя.

Эталон облика — выбранный фас его листа опорных портретов: тот же, что сборщик подаёт в
референсы кадра (`prompt_builder.anchor_refs`). В кадре — все лица (YuNet, `FaceDetectorYN`) не
меньше `min_face_px`, каждое выравнивается и превращается в эмбеддинг (SFace,
`FaceRecognizerSF`); у облика — лучшее косинусное сходство среди лиц кадра. Ниже порога — `low`
(пометка `consistency_low`); лиц нет — `no_face`, «не проверено»; проверить нельзя (нет весов,
фаса, лица на фасе) — `skipped` с причиной. Ничего не блокируется, сбой проверки не роняет
джоб кадра.

CPU, без torch. Веса грузятся один раз на процесс (`load_model`), сети OpenCV не потокобезопасны
— вызовы под замком модели. Эмбеддинг фаса — кэш по sha256 файла. Контракт —
`docs/generation.md`, «Проверка лица».
"""

import hashlib
import logging
import threading
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import cv2
import numpy as np
from numpy.typing import NDArray

from app.models.canon_config import FRONT
from app.models.checks_config import FaceCheckConfig, WeightFile
from app.models.project import FaceCheck, FaceMatch, FaceStatus
from app.pipeline.canon import anchors
from app.storage.db import now_iso
from app.storage.paths import StudioPaths

log = logging.getLogger(__name__)

FETCH_COMMAND = "PYTHONPATH=backend uv run python -m app.tools.fetch_models"
_CANON = " на экране «Канон»"
_NO_FACE = f"На фасе облика {{}} лицо не найдено — выберите другой фас{_CANON}."

Image = NDArray[np.uint8]
Vector = NDArray[np.float32]


@dataclass(frozen=True)
class Face:
    """Лицо, найденное YuNet: строка `[x, y, w, h, 5 точек × (x, y), уверенность]`."""

    row: NDArray[np.float32]

    @property
    def size(self) -> float:
        """Меньшая сторона рамки, px."""
        return float(min(self.row[2], self.row[3]))

    @property
    def area(self) -> float:
        return float(self.row[2] * self.row[3])


class FaceModel(Protocol):
    """Детектор и эмбеддер лица; в тестах — фейк без весов."""

    def detect(self, image: Image) -> list[Face]: ...

    def embed(self, image: Image, face: Face) -> Vector: ...


class WeightsUnavailable(Exception):
    """Весов нет или они не те — проверка `skipped`, текст — что сделать."""


class OpenCvFaceModel:
    """YuNet + SFace из opencv-python-headless. Один экземпляр на процесс, вызовы — под замком:
    `setInputSize` и прогон сети меняют состояние объекта, а джобы кадров идут в потоках."""

    def __init__(self, detector: Path, recognizer: Path, score: float) -> None:
        self._detector = cv2.FaceDetectorYN.create(str(detector), "", (320, 320), score)
        self._recognizer = cv2.FaceRecognizerSF.create(str(recognizer), "")
        self._lock = threading.Lock()

    def detect(self, image: Image) -> list[Face]:
        height, width = image.shape[:2]
        with self._lock:
            self._detector.setInputSize((width, height))
            _, faces = self._detector.detect(image)
        if faces is None:
            return []
        return [Face(np.asarray(row, dtype=np.float32)) for row in faces]

    def embed(self, image: Image, face: Face) -> Vector:
        with self._lock:
            aligned = self._recognizer.alignCrop(image, face.row)
            feature = self._recognizer.feature(aligned)
        return np.asarray(feature, dtype=np.float32).reshape(-1)


_MODELS: dict[tuple[Path, str, str, float], FaceModel] = {}
_MODELS_LOCK = threading.Lock()
_WARNED: set[str] = set()


def weight_path(models_dir: Path, weight: WeightFile) -> Path:
    return models_dir / weight.file


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_model(config: FaceCheckConfig, models_dir: Path) -> FaceModel:
    """Модель на весах из `models_dir` — один раз на процесс. Файла нет или хэш не тот —
    `WeightsUnavailable`; такой исход не кэшируется: после `fetch_models` проверка заработает
    без перезапуска."""
    weights = (config.models.detector, config.models.recognizer)
    key = (models_dir, weights[0].sha256, weights[1].sha256, config.detect_score)
    with _MODELS_LOCK:
        model = _MODELS.get(key)
        if model is not None:
            return model
        for weight in weights:
            path = weight_path(models_dir, weight)
            if not path.is_file():
                raise WeightsUnavailable(
                    f"Нет весов проверки лица ({weight.file}) — запустите `{FETCH_COMMAND}`."
                )
            if file_sha256(path) != weight.sha256:
                raise WeightsUnavailable(
                    f"Веса проверки лица {weight.file} не совпали по sha256 — запустите"
                    f" `{FETCH_COMMAND}`, он скачает их заново."
                )
        model = OpenCvFaceModel(
            weight_path(models_dir, weights[0]),
            weight_path(models_dir, weights[1]),
            config.detect_score,
        )
        _MODELS[key] = model
        log.info("face check: YuNet + SFace loaded from %s", models_dir)
        return model


def _warn_once(reason: str) -> None:
    if reason not in _WARNED:
        _WARNED.add(reason)
        log.warning("face check skipped: %s", reason)


def cosine(a: Vector, b: Vector) -> float:
    """Косинусное сходство — то же, что `FaceRecognizerSF.match(…, FR_COSINE)`."""
    norm = float(np.linalg.norm(a) * np.linalg.norm(b))
    return 0.0 if norm == 0.0 else float(np.dot(a, b) / norm)


@dataclass(frozen=True)
class Front:
    """Эталон облика: файл выбранного фаса листа и id кандидата; файла нет — причина."""

    appearance_id: str
    path: Path | None
    candidate: str | None = None
    reason: str | None = None


def chosen_front(paths: StudioPaths, channel: str, appearance_id: str) -> Front:
    """Выбранный фас листа облика — как в референсах кадра (`prompt_builder.anchor_refs`)."""
    s = anchors.appearance_set(paths, channel, appearance_id)
    pick = anchors.read_chosen(s).slots.get(FRONT)
    if pick is None or not (s.root / pick.file).is_file():
        return Front(
            appearance_id,
            None,
            reason=f"У облика {appearance_id} нет выбранного фаса — выберите фас{_CANON}.",
        )
    return Front(appearance_id, s.root / pick.file, candidate=pick.candidate)


class FaceChecker:
    """Проверка версии кадра против фасов его обликов. Не бросает: любой сбой — `skipped` с
    причиной. `loader` — модель лица (тесты подают фейк); по умолчанию — веса из `models_dir`."""

    def __init__(
        self,
        config: FaceCheckConfig,
        models_dir: Path,
        loader: Callable[[FaceCheckConfig, Path], FaceModel] | None = None,
    ) -> None:
        self.config = config
        self.models_dir = models_dir
        self._loader = loader
        # sha256 файла фаса → эмбеддинг его лица или `_NO_FACE`. Гонка потоков посчитает фас
        # дважды, результат тот же.
        self._fronts: dict[str, Vector | str] = {}

    def check_shot(
        self, paths: StudioPaths, channel: str, appearances: Sequence[str], image: Path
    ) -> FaceCheck | None:
        """Версия кадра `image` против выбранных фасов `appearances`; без обликов — None."""
        if not appearances:
            return None
        try:
            fronts = [chosen_front(paths, channel, appearance_id) for appearance_id in appearances]
        except Exception as exc:
            return self._failed([Front(a, None) for a in appearances], image, exc)
        return self.check(fronts, image)

    def check(self, fronts: Sequence[Front], image: Path) -> FaceCheck | None:
        if not fronts:
            return None
        try:
            return self._check(fronts, image)
        except WeightsUnavailable as exc:
            _warn_once(str(exc))
            return self._skipped(fronts, str(exc))
        except Exception as exc:
            return self._failed(fronts, image, exc)

    def _failed(self, fronts: Sequence[Front], image: Path, exc: Exception) -> FaceCheck:
        log.exception("face check failed for %s", image)
        text = str(exc).strip()
        detail = f": {text}" if text else ""
        return self._skipped(
            fronts, f"Сбой проверки лица ({type(exc).__name__}){detail} — перепроверьте кадр."
        )

    def _model(self) -> FaceModel:
        loader = self._loader if self._loader is not None else load_model
        return loader(self.config, self.models_dir)

    def _check(self, fronts: Sequence[Front], image_path: Path) -> FaceCheck:
        model = self._model()
        image = self._read(image_path)
        if image is None:
            return self._skipped(fronts, "Картинка версии не читается — лицо не проверено.")
        faces = self._faces(model, image)
        vectors = [model.embed(image, face) for face in faces]
        matches = [self._match(model, front, vectors) for front in fronts]
        status: FaceStatus
        if not faces:
            status = "no_face"
        elif any(m.status == "low" for m in matches):
            status = "low"
        elif any(m.status == "ok" for m in matches):
            status = "ok"
        else:
            status = "skipped"
        return FaceCheck(
            status=status,
            appearances=matches,
            faces=len(faces),
            threshold=self.config.threshold,
            checked_at=now_iso(),
        )

    def _match(self, model: FaceModel, front: Front, vectors: Sequence[Vector]) -> FaceMatch:
        if front.path is None:
            return FaceMatch(id=front.appearance_id, status="skipped", reason=front.reason)
        reference = self._front_vector(model, front.path)
        if not isinstance(reference, np.ndarray):
            return FaceMatch(
                id=front.appearance_id,
                status="skipped",
                front=front.candidate,
                reason=reference.format(front.appearance_id),
            )
        if not vectors:
            return FaceMatch(id=front.appearance_id, status="no_face", front=front.candidate)
        score = round(max(cosine(reference, v) for v in vectors), 3)
        return FaceMatch(
            id=front.appearance_id,
            status="ok" if score >= self.config.threshold else "low",
            score=score,
            front=front.candidate,
        )

    def _front_vector(self, model: FaceModel, path: Path) -> Vector | str:
        """Эмбеддинг самого крупного лица фаса; кэш по sha256 файла. Нет эмбеддинга — шаблон
        причины с `{}` на месте облика."""
        sha = file_sha256(path)
        cached = self._fronts.get(sha)
        if cached is not None:
            return cached
        image = self._read(path)
        if image is None:
            return f"Фас облика {{}} не читается как картинка — перегенерируйте фас{_CANON}."
        faces = self._faces(model, image)
        if not faces:
            self._fronts[sha] = _NO_FACE
            return _NO_FACE
        vector = model.embed(image, max(faces, key=lambda f: f.area))
        self._fronts[sha] = vector
        return vector

    def _faces(self, model: FaceModel, image: Image) -> list[Face]:
        return [f for f in model.detect(image) if f.size >= self.config.min_face_px]

    def _read(self, path: Path) -> Image | None:
        """Картинка BGR, большая сторона — не больше `detect_max_side`; не картинка — None."""
        image = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            return None
        height, width = image.shape[:2]
        side = max(height, width)
        limit = self.config.detect_max_side
        if side > limit:
            size = (max(1, round(width * limit / side)), max(1, round(height * limit / side)))
            image = cv2.resize(image, size, interpolation=cv2.INTER_AREA)
        return np.asarray(image, dtype=np.uint8)

    def _skipped(self, fronts: Sequence[Front], reason: str) -> FaceCheck:
        return FaceCheck(
            status="skipped",
            appearances=[
                FaceMatch(id=f.appearance_id, status="skipped", front=f.candidate) for f in fronts
            ],
            threshold=self.config.threshold,
            reason=reason,
            checked_at=now_iso(),
        )
