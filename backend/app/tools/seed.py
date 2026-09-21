"""Создаёт два канала — `cursus` и `otto` — с профилями, если их нет.

Запуск: `PYTHONPATH=backend uv run python -m app.tools.seed`. Идемпотентен: существующий
`profile.json` не перезаписывается, строка реестра — `INSERT OR IGNORE`. Каталоги `canon/` и
`oauth/` не создаются — появятся в своих этапах.

Числа бюджетов и квоты — как в оболочке (`frontend/src/mocks/fixtures.ts`), чтобы M3 не спорил
с макетом; лимитов на выпуск и анимацию в макете нет — значения ниже редактируются в профиле.
"""

import logging
import sqlite3

from app.log import configure_logging
from app.models.channel import Budgets, ChannelProfile, VoiceQuota
from app.settings import Settings
from app.storage.atomic import write_json_atomic
from app.storage.db import apply_migrations, connect, now_iso
from app.storage.paths import StudioPaths

log = logging.getLogger(__name__)

PROFILES: tuple[ChannelProfile, ...] = (
    ChannelProfile(
        id="cursus",
        name="Cursus",
        format="every_rank",
        budgets=Budgets(monthly_usd=150, per_episode_usd=15, animation_usd=5),
        voice_quota=VoiceQuota(limit_chars=600_000),
    ),
    ChannelProfile(
        id="otto",
        name="Otto's Timeline",
        format="host",
        budgets=Budgets(monthly_usd=100, per_episode_usd=8, animation_usd=3),
        voice_quota=VoiceQuota(limit_chars=600_000),
    ),
)


def seed(paths: StudioPaths, conn: sqlite3.Connection) -> list[str]:
    """Возвращает id каналов, чьи профили были созданы в этот вызов."""
    created: list[str] = []
    for profile in PROFILES:
        path = paths.profile_path(profile.id)
        if not path.exists():
            write_json_atomic(path, profile.model_dump(mode="json"))
            created.append(profile.id)
        conn.execute(
            "INSERT OR IGNORE INTO channels (id, name, format, created_at) VALUES (?, ?, ?, ?)",
            (profile.id, profile.name, profile.format, now_iso()),
        )
    conn.commit()
    return created


def main() -> None:
    settings = Settings()
    configure_logging(settings.log_level)
    paths = StudioPaths(settings.studio_data_dir)
    paths.root.mkdir(parents=True, exist_ok=True)
    conn = connect(paths.db_path)
    try:
        apply_migrations(conn)
        created = seed(paths, conn)
    finally:
        conn.close()
    log.info("channels seeded in %s: created %s", paths.root, created or "none (already there)")


if __name__ == "__main__":
    main()
