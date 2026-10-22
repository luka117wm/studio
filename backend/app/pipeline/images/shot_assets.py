"""Картинка кадра как ассет с версиями (M6.1). Контракт — `docs/generation.md`, «Версии кадра».

Каждая отрисовка — новый неизменяемый файл `media/<кадр>/vNNN.<ext>` с миниатюрами webp 160/320
(принцип 12) и строкой `assets["img-<кадр>-v<N>"]` в project.json: хэш входов, модель, seed,
вариант, цена, когда нарисована, из кэша ли. Выбранная версия — `ShotState.image_version`:
первая выбирается сама, следующие — человеком (M6.9). Версии не удаляются и не перезаписываются.

project.json читается и пишется под `update_lock`: джобы картинок (M6.2) — потоки воркера в том
же процессе, что и API.
"""

import re
from pathlib import Path

from app.models.director import StrictModel
from app.models.project import Asset, Project, ShotState, ShotStatus, image_asset_id
from app.providers.base import image_mime
from app.storage.atomic import read_json, update_lock, write_bytes_new, write_json_atomic
from app.storage.db import now_iso
from app.storage.paths import StudioPaths
from app.storage.thumbs import ThumbWidth, ensure_thumb, thumb_path

# Расширение файла — по MIME картинки (L-039): формат выбирает модель.
IMAGE_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
MEDIA_TYPES = {ext: mime for mime, ext in IMAGE_EXT.items()}
THUMB_WIDTHS: tuple[ThumbWidth, ...] = (160, 320)

# `v003.png`; temp-файлы записи начинаются с точки и сюда не попадают.
_VERSION_FILE_RE = re.compile(r"^v(\d{3})\.[a-z0-9]+$")


class NotAnImage(ValueError):
    """Байты не PNG, не JPEG и не WEBP — версию из них не сделать."""


class VersionNotFound(LookupError):
    """У кадра нет такой версии картинки."""

    def __init__(self, shot_id: str, version: int, existing: list[int]) -> None:
        self.shot_id = shot_id
        self.version = version
        self.existing = existing
        if existing:
            have = ", ".join(str(v) for v in existing)
            message = f"У кадра {shot_id} нет версии {version} — есть {have}."
        else:
            message = f"У кадра {shot_id} ещё нет картинок — сначала сгенерируйте кадр."
        super().__init__(message)


class ShotImages(StrictModel):
    """Версии картинки кадра: новые сверху; `image_version` — выбранная, null — не выбрана."""

    shot_id: str
    status: ShotStatus
    image_version: int | None
    versions: list[Asset]


def add_image_version(
    paths: StudioPaths,
    channel: str,
    episode: str,
    shot_id: str,
    data: bytes,
    *,
    input_hash: str,
    model: str,
    seed: int,
    variant: int,
    usd_micro: int,
    cached: bool,
) -> Asset:
    """Новая версия картинки кадра: файл, миниатюры, строка `assets`; без выбранной — выбрана.

    Номер — следующий после последнего и на диске, и в `assets`: файл без строки (сбой между
    записью файла и project.json) свой номер не отдаёт.
    """
    mime = image_mime(data)
    if mime is None:
        raise NotAnImage(f"кадр {shot_id}: ответ модели — не PNG, JPEG или WEBP")
    project_path = paths.project_path(channel, episode)
    with update_lock(project_path):
        project = Project.model_validate(read_json(project_path))
        version = _next_version(paths.shot_media_dir(channel, episode, shot_id), project, shot_id)
        path = paths.shot_image_path(channel, episode, shot_id, version, IMAGE_EXT[mime])
        write_bytes_new(path, data)
        for width in THUMB_WIDTHS:
            ensure_thumb(path, _thumb(paths, channel, episode, shot_id, version, width), width)
        asset = Asset(
            id=image_asset_id(shot_id, version),
            shot_id=shot_id,
            kind="image",
            version=version,
            path=path.relative_to(paths.episode_dir(channel, episode)).as_posix(),
            hash=input_hash,
            model=model,
            seed=seed,
            variant=variant,
            usd_micro=usd_micro,
            created_at=now_iso(),
            cached=cached,
        )
        state = project.shots.get(shot_id, ShotState())
        if not state.has_image:
            state = _chosen(state, version)
        _write(
            project_path,
            project,
            assets={**project.assets, asset.id: asset},
            shots={**project.shots, shot_id: state},
        )
    return asset


def choose_image_version(
    paths: StudioPaths, channel: str, episode: str, shot_id: str, version: int
) -> Project:
    """Выбрать существующую версию: она идёт в монтаж, кадр — `done`.
    Нет такой версии у кадра — VersionNotFound, файл не меняется."""
    project_path = paths.project_path(channel, episode)
    with update_lock(project_path):
        project = Project.model_validate(read_json(project_path))
        find_version(project, shot_id, version)
        state = _chosen(project.shots.get(shot_id, ShotState()), version)
        return _write(project_path, project, shots={**project.shots, shot_id: state})


def image_versions(project: Project, shot_id: str) -> list[Asset]:
    """Версии картинки кадра, новые сверху."""
    found = [a for a in project.assets.values() if a.kind == "image" and a.shot_id == shot_id]
    return sorted(found, key=lambda a: a.version, reverse=True)


def shot_images(project: Project, shot_id: str) -> ShotImages:
    state = project.shots.get(shot_id, ShotState())
    return ShotImages(
        shot_id=shot_id,
        status=state.status,
        image_version=state.image_version,
        versions=image_versions(project, shot_id),
    )


def find_version(project: Project, shot_id: str, version: int) -> Asset:
    """Ассет версии кадра; версия другого кадра или несуществующая — VersionNotFound."""
    for asset in image_versions(project, shot_id):
        if asset.version == version:
            return asset
    existing = sorted(a.version for a in image_versions(project, shot_id))
    raise VersionNotFound(shot_id, version, existing)


def version_file(paths: StudioPaths, channel: str, episode: str, asset: Asset) -> Path:
    """Файл версии; путь в `assets` — относительно каталога выпуска и наружу не выходит."""
    root = paths.episode_dir(channel, episode).resolve()
    path = (root / asset.path).resolve()
    if not path.is_relative_to(root):
        raise ValueError(f"asset {asset.id}: path {asset.path!r} is outside the episode")
    return path


def version_thumb(
    paths: StudioPaths, channel: str, episode: str, asset: Asset, width: ThumbWidth
) -> Path:
    """Миниатюра версии; нет файла (данные до M6.1, сбой при записи) — строится сейчас."""
    assert asset.shot_id is not None  # версия картинки всегда принадлежит кадру
    source = version_file(paths, channel, episode, asset)
    target = _thumb(paths, channel, episode, asset.shot_id, asset.version, width)
    return ensure_thumb(source, target, width)


def _thumb(
    paths: StudioPaths, channel: str, episode: str, shot_id: str, version: int, width: ThumbWidth
) -> Path:
    return thumb_path(paths.shot_thumbs_dir(channel, episode, shot_id), f"v{version:03d}", width)


def _next_version(media: Path, project: Project, shot_id: str) -> int:
    on_disk = (
        [int(m.group(1)) for p in media.iterdir() if (m := _VERSION_FILE_RE.match(p.name))]
        if media.is_dir()
        else []
    )
    in_assets = [a.version for a in image_versions(project, shot_id)]
    return max([0, *on_disk, *in_assets]) + 1


def _chosen(state: ShotState, version: int) -> ShotState:
    """Выбранная версия соответствует кадру: `done`, причины `stale` и история — сброшены.
    Убранный из плана кадр остаётся `removed` (джоб мог закончиться после импорта)."""
    if state.status == "removed":
        return state.model_copy(update={"image_version": version})
    return state.model_copy(
        update={"image_version": version, "status": "done", "stale_reasons": []}
    )


def _write(path: Path, project: Project, **update: object) -> Project:
    updated = Project.model_validate({**project.model_dump(), **update, "updated_at": now_iso()})
    write_json_atomic(path, updated.model_dump(mode="json"))
    return updated
