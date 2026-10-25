"""Статус выпуска на стадии `generate` (M6.3; устав M6, решение 5) — по джобам и кадрам.

Идёт работа над кадрами (джоб `shot_image` в очереди или рисует, в том числе пачка на паузе) —
`generating`. Работы нет: у всех кадров плана выбрана картинка, она в силе (`done`) и без пометок
проверки — `ready`, иначе (сбой, `stale`, нет картинки, лицо не похоже на фас — M6.5) — `warning`:
есть что проверить руками. Пометка только подсвечивает: ничего не блокирует. `no_face` и `skipped`
— не пометки. Стадию не меняет; на другой стадии статус не трогается. Контракт —
`docs/episodes.md`, «Стадия и статус».
"""

from typing import Literal

from app.models.project import Project, ShotState, image_asset_id
from app.storage.atomic import read_json
from app.storage.db import connect, now_iso
from app.storage.paths import StudioPaths

SHOT_KIND = "shot_image"
GenerateStatus = Literal["generating", "ready", "warning"]


def refresh_episode_status(paths: StudioPaths, episode_id: str) -> GenerateStatus | None:
    """Пересчитать и записать статус выпуска; None — выпуск не на стадии `generate`. Своё
    соединение: зовётся из колбэков пула и API (L-014)."""
    conn = connect(paths.db_path)
    try:
        row = conn.execute(
            "SELECT channel, stage FROM episodes WHERE id = ?", (episode_id,)
        ).fetchone()
        if row is None or row["stage"] != "generate":
            return None
        busy = conn.execute(
            "SELECT 1 FROM jobs WHERE episode_id = ? AND kind = ?"
            " AND status IN ('queued', 'running') LIMIT 1",
            (episode_id, SHOT_KIND),
        ).fetchone()
        status: GenerateStatus
        if busy is not None:
            status = "generating"
        else:
            project = Project.model_validate(
                read_json(paths.project_path(row["channel"], episode_id))
            )
            shots = [(k, s) for k, s in project.shots.items() if s.status != "removed"]
            clean = all(s.status == "done" and not marked(project, k, s) for k, s in shots)
            status = "ready" if shots and clean else "warning"
        with conn:
            conn.execute(
                "UPDATE episodes SET status = ?, updated_at = ?"
                " WHERE id = ? AND stage = 'generate' AND status != ?",
                (status, now_iso(), episode_id, status),
            )
        return status
    finally:
        conn.close()


def marked(project: Project, shot_id: str, state: ShotState) -> bool:
    """У выбранной версии кадра есть пометка проверки: лицо не похоже на фас (`low`)."""
    if state.image_version is None:
        return False
    asset = project.assets.get(image_asset_id(shot_id, state.image_version))
    face = None if asset is None or asset.checks is None else asset.checks.face
    return face is not None and face.status == "low"
