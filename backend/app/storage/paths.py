"""Все пути в `data/` — одной точкой. Дерево — по разделу «Структура» `CLAUDE.md`.

Ни одной склейки путей вне этого файла; только `pathlib`, никаких `/mnt/c` и обратных слешей
(L-002). Идентификаторы каналов и выпусков становятся именами каталогов, поэтому проверяются
регуляркой до любой операции с диском — `..` и слеши не пройдут.
"""

import re
from dataclasses import dataclass
from pathlib import Path

from app.models.director import EPISODE_ID_PATTERN

_ID_RE = re.compile(EPISODE_ID_PATTERN)


def check_id(value: str, what: str = "id") -> str:
    """Возвращает `value`, если он годится в имя каталога; иначе ValueError."""
    if not _ID_RE.fullmatch(value):
        raise ValueError(f"{what} {value!r} must match {EPISODE_ID_PATTERN}")
    return value


@dataclass(frozen=True)
class StudioPaths:
    root: Path

    # --- корень --------------------------------------------------------------------------------

    @property
    def db_path(self) -> Path:
        return self.root / "app.db"

    @property
    def channels_root(self) -> Path:
        return self.root / "channels"

    @property
    def projects_root(self) -> Path:
        return self.root / "projects"

    # --- канал: data/channels/<channel>/{profile.json, oauth/, canon/} -------------------------

    def channel_dir(self, channel: str) -> Path:
        return self.channels_root / check_id(channel, "channel")

    def profile_path(self, channel: str) -> Path:
        return self.channel_dir(channel) / "profile.json"

    def oauth_dir(self, channel: str) -> Path:
        return self.channel_dir(channel) / "oauth"

    def canon_dir(self, channel: str) -> Path:
        return self.channel_dir(channel) / "canon"

    # --- выпуск: data/projects/<channel>/<episode>/{director/, project.json, media/, ...} -------

    def episode_dir(self, channel: str, episode: str) -> Path:
        return self.projects_root / check_id(channel, "channel") / check_id(episode, "episode")

    def director_dir(self, channel: str, episode: str) -> Path:
        return self.episode_dir(channel, episode) / "director"

    def director_version_path(self, channel: str, episode: str, version: int) -> Path:
        """`director/v001.json`: каждая версия плана — отдельный неизменяемый файл."""
        if version < 1:
            raise ValueError(f"director version must be >= 1, got {version}")
        return self.director_dir(channel, episode) / f"v{version:03d}.json"

    def project_path(self, channel: str, episode: str) -> Path:
        return self.episode_dir(channel, episode) / "project.json"

    def media_dir(self, channel: str, episode: str) -> Path:
        return self.episode_dir(channel, episode) / "media"

    def cache_dir(self, channel: str, episode: str) -> Path:
        return self.episode_dir(channel, episode) / "cache"

    def exports_dir(self, channel: str, episode: str) -> Path:
        return self.episode_dir(channel, episode) / "exports"

    def publish_dir(self, channel: str, episode: str) -> Path:
        return self.episode_dir(channel, episode) / "publish"

    def episode_tree(self, channel: str, episode: str) -> tuple[Path, ...]:
        """Каталоги, которые создаются вместе с выпуском."""
        return (
            self.director_dir(channel, episode),
            self.media_dir(channel, episode),
            self.cache_dir(channel, episode),
            self.exports_dir(channel, episode),
            self.publish_dir(channel, episode),
        )
