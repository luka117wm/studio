"""Картинка кадра как ассет с версиями (M6.1). Контракт — `docs/generation.md`, «Версии кадра».

Каждая отрисовка — новый неизменяемый файл `media/<кадр>/vNNN.<ext>` с миниатюрами webp 160/320
(принцип 12) и строкой `assets["img-<кадр>-v<N>"]` в project.json: хэш входов, модель, seed,
вариант, цена, когда нарисована, из кэша ли. Выбранная версия — `ShotState.image_version`: новая
версия выбирается сама, если картинки нет или выбранная устарела (`stale`), иначе ждёт человека
(M6.9). Версии не удаляются и не перезаписываются.

Статусы кадра на время работы — `queued`, `generating`, `failed` с причиной (M6.2); без работы —
`settled_status`. project.json читается и пишется под `update_lock`: запись версии идёт из потока,
API пишет из цикла событий.
"""

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.models.director import StrictModel
from app.models.project import Asset, Project, ShotState, ShotStatus, image_asset_id
from app.providers.base import image_mime
from app.storage.atomic import (
    link_new,
    read_json,
    update_lock,
    write_bytes_new,
    write_json_atomic,
)
from app.storage.db import now_iso
from app.storage.paths import StudioPaths
from app.storage.thumbs import ThumbWidth, ensure_thumb, thumb_path

# Расширение файла — по MIME картинки (L-039): формат выбирает модель.
IMAGE_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
MEDIA_TYPES = {ext: mime for mime, ext in IMAGE_EXT.items()}
THUMB_WIDTHS: tuple[ThumbWidth, ...] = (160, 320)

# `v003.png`; temp-файлы записи начинаются с точки и сюда не попадают.
_VERSION_FILE_RE = re.compile(r"^v(\d{3})\.[a-z0-9]+$")
# Статусы, которые ставит работа над кадром; остальные выводит `settled_status`.
WorkStatus = Literal["queued", "generating", "failed"]


@dataclass(frozen=True)
class Drawing:
    """Что известно об отрисовке версии: хэш входов, модель (ключ каталога и ID), seed, вариант,
    цена в микродолларах (из кэша — 0), из кэша ли."""

    input_hash: str
    model: str
    seed: int
    variant: int
    usd_micro: int
    cached: bool
    model_id: str | None = None
    # Версия плана, по которой собран заказ (M6.3): к записи версии текущая уже другая — версия
    # нарисована по прежнему плану и сама не выбирается. None — без проверки.
    plan_version: str | None = None


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
    paths: StudioPaths, channel: str, episode: str, shot_id: str, data: bytes, drawing: Drawing
) -> Asset:
    """Новая версия картинки кадра из байтов: файл, миниатюры, строка `assets`, выбор (см. модуль).

    Номер — следующий после последнего и на диске, и в `assets`: файл без строки (сбой между
    записью файла и project.json) свой номер не отдаёт.
    """
    mime = image_mime(data)
    if mime is None:
        raise NotAnImage(f"кадр {shot_id}: ответ модели — не PNG, JPEG или WEBP")
    return _add(
        paths,
        channel,
        episode,
        shot_id,
        IMAGE_EXT[mime],
        lambda p: write_bytes_new(p, data),
        drawing,
    )


def add_image_file(
    paths: StudioPaths, channel: str, episode: str, shot_id: str, source: Path, drawing: Drawing
) -> Asset:
    """Новая версия из файла шлюза — оплаченного или из кэша (L-042): жёсткая ссылка, второй копии
    на диске нет; файл шлюза, как и версия, не меняется."""
    with source.open("rb") as fh:
        mime = image_mime(fh.read(16))
    if mime is None:
        raise NotAnImage(f"кадр {shot_id}: файл {source.name} — не PNG, JPEG или WEBP")
    return _add(
        paths, channel, episode, shot_id, IMAGE_EXT[mime], lambda p: link_new(source, p), drawing
    )


def _add(
    paths: StudioPaths,
    channel: str,
    episode: str,
    shot_id: str,
    ext: str,
    store: Callable[[Path], None],
    drawing: Drawing,
) -> Asset:
    project_path = paths.project_path(channel, episode)
    with update_lock(project_path):
        project = Project.model_validate(read_json(project_path))
        version = _next_version(paths.shot_media_dir(channel, episode, shot_id), project, shot_id)
        path = paths.shot_image_path(channel, episode, shot_id, version, ext)
        store(path)
        for width in THUMB_WIDTHS:
            ensure_thumb(path, _thumb(paths, channel, episode, shot_id, version, width), width)
        asset = Asset(
            id=image_asset_id(shot_id, version),
            shot_id=shot_id,
            kind="image",
            version=version,
            path=path.relative_to(paths.episode_dir(channel, episode)).as_posix(),
            hash=drawing.input_hash,
            model=drawing.model,
            model_id=drawing.model_id,
            seed=drawing.seed,
            variant=drawing.variant,
            usd_micro=drawing.usd_micro,
            created_at=now_iso(),
            cached=drawing.cached,
        )
        state = _with_new_version(
            project.shots.get(shot_id, ShotState()),
            version,
            may_choose=_plan_is_current(project, drawing.plan_version),
        )
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


def set_work_status(
    paths: StudioPaths,
    channel: str,
    episode: str,
    shot_id: str,
    status: WorkStatus,
    error: str | None = None,
) -> None:
    """Кадр в работе: `queued`, `generating` или `failed` с причиной. Кадр, убранный из плана
    (импорт, пока джоб ждал или рисовал), остаётся `removed`."""
    set_work_statuses(paths, channel, episode, [shot_id], status, error)


def set_work_statuses(
    paths: StudioPaths,
    channel: str,
    episode: str,
    shot_ids: Sequence[str],
    status: WorkStatus,
    error: str | None = None,
) -> None:
    """То же для многих кадров одной записью project.json (пачка, M6.3)."""
    update = {"status": status, "error": error} if status == "failed" else {"status": status}
    _update_states(paths, channel, episode, shot_ids, lambda state: state.model_copy(update=update))


def settle(paths: StudioPaths, channel: str, episode: str, shot_ids: Sequence[str]) -> None:
    """Работа над кадрами снята (отмена джобов): статус — по картинке, причинам и сбою."""
    _update_states(
        paths,
        channel,
        episode,
        shot_ids,
        lambda state: state.model_copy(update={"status": settled_status(state)}),
    )


def settled_status(state: ShotState) -> ShotStatus:
    """Статус кадра без идущей работы: убран — `removed`; был сбой — `failed`; есть картинка —
    `stale`, если есть причины, иначе `done`; картинки нет — `todo`."""
    if state.status == "removed":
        return "removed"
    if state.error is not None:
        return "failed"
    if state.has_image:
        return "stale" if state.stale_reasons else "done"
    return "todo"


def find_image_by_hash(project: Project, shot_id: str, input_hash: str) -> Asset | None:
    """Версия кадра с тем же хэшем входов: тот же запрос уже нарисован (идемпотентность)."""
    return next((a for a in image_versions(project, shot_id) if a.hash == input_hash), None)


def bind_existing(
    paths: StudioPaths,
    channel: str,
    episode: str,
    shot_id: str,
    version: int,
    plan_version: str | None = None,
) -> ShotState:
    """Тот же запрос второй раз: новой версии нет, готовая выбирается по правилу новой версии."""
    project_path = paths.project_path(channel, episode)
    with update_lock(project_path):
        project = Project.model_validate(read_json(project_path))
        state = _with_new_version(
            project.shots.get(shot_id, ShotState()),
            version,
            may_choose=_plan_is_current(project, plan_version),
        )
        _write(project_path, project, shots={**project.shots, shot_id: state})
    return state


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


def _with_new_version(state: ShotState, version: int, *, may_choose: bool = True) -> ShotState:
    """Новая (или найденная по хэшу) версия: выбирается, если картинки нет или выбранная устарела
    и версия нарисована по текущему плану; иначе ждёт выбора человека. Сбой снимается всегда."""
    state = state.model_copy(update={"error": None})
    if may_choose and (not state.has_image or state.stale_reasons):
        return _chosen(state, version)
    return state.model_copy(update={"status": settled_status(state)})


def _plan_is_current(project: Project, plan_version: str | None) -> bool:
    return plan_version is None or plan_version == project.director_version


def _update_states(
    paths: StudioPaths,
    channel: str,
    episode: str,
    shot_ids: Sequence[str],
    change: Callable[[ShotState], ShotState],
) -> None:
    """Состояния кадров одной записью; кадр без состояния или `removed` не трогается."""
    project_path = paths.project_path(channel, episode)
    with update_lock(project_path):
        project = Project.model_validate(read_json(project_path))
        shots = dict(project.shots)
        changed = False
        for shot_id in shot_ids:
            state = shots.get(shot_id)
            if state is None or state.status == "removed":
                continue
            shots[shot_id] = change(state)
            changed = True
        if changed:
            _write(project_path, project, shots=shots)


def _chosen(state: ShotState, version: int) -> ShotState:
    """Выбранная версия соответствует кадру: `done`, причины `stale`, история и сбой — сброшены.
    Убранный из плана кадр остаётся `removed` (джоб мог закончиться после импорта)."""
    if state.status == "removed":
        return state.model_copy(update={"image_version": version})
    return state.model_copy(
        update={"image_version": version, "status": "done", "stale_reasons": [], "error": None}
    )


def _write(path: Path, project: Project, **update: object) -> Project:
    updated = Project.model_validate({**project.model_dump(), **update, "updated_at": now_iso()})
    write_json_atomic(path, updated.model_dump(mode="json"))
    return updated
