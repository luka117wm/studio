"""Все пути в `data/` — одной точкой. Дерево — по разделу «Структура» `CLAUDE.md`.

Ни одной склейки путей вне этого файла; только `pathlib`, никаких `/mnt/c` и обратных слешей
(L-002). Идентификаторы каналов и выпусков становятся именами каталогов, поэтому проверяются
регуляркой до любой операции с диском — `..` и слеши не пройдут.
"""

import re
from dataclasses import dataclass
from pathlib import Path

from app.models.canon import APPEARANCE_ID_PATTERN
from app.models.director import EPISODE_ID_PATTERN

_ID_RE = re.compile(EPISODE_ID_PATTERN)
_APPEARANCE_ID_RE = re.compile(APPEARANCE_ID_PATTERN)


def check_id(value: str, what: str = "id") -> str:
    """Возвращает `value`, если он годится в имя каталога; иначе ValueError."""
    if not _ID_RE.fullmatch(value):
        raise ValueError(f"{what} {value!r} must match {EPISODE_ID_PATTERN}")
    return value


def check_appearance_id(value: str) -> str:
    """id облика (`you@powder-monkey-11`) — имя каталога листа портретов; иначе ValueError."""
    if not _APPEARANCE_ID_RE.fullmatch(value):
        raise ValueError(f"appearance {value!r} must match {APPEARANCE_ID_PATTERN}")
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

    @property
    def schedule_path(self) -> Path:
        """Расписание публикаций, одно на оба канала (`docs/slots.md`)."""
        return self.root / "schedule.json"

    # --- канал: data/channels/<channel>/{profile.json, oauth/, canon/} -------------------------

    def channel_dir(self, channel: str) -> Path:
        return self.channels_root / check_id(channel, "channel")

    def profile_path(self, channel: str) -> Path:
        return self.channel_dir(channel) / "profile.json"

    def oauth_dir(self, channel: str) -> Path:
        return self.channel_dir(channel) / "oauth"

    def canon_dir(self, channel: str) -> Path:
        return self.channel_dir(channel) / "canon"

    # --- канон: canon/{style, periods/<id>, characters/<id>}/{vNNN.json, draft.json} ------------

    def canon_style_dir(self, channel: str) -> Path:
        return self.canon_dir(channel) / "style"

    def canon_periods_root(self, channel: str) -> Path:
        return self.canon_dir(channel) / "periods"

    def canon_period_dir(self, channel: str, period: str) -> Path:
        return self.canon_periods_root(channel) / check_id(period, "period")

    def canon_characters_root(self, channel: str) -> Path:
        return self.canon_dir(channel) / "characters"

    def canon_character_dir(self, channel: str, character: str) -> Path:
        return self.canon_characters_root(channel) / check_id(character, "character")

    @staticmethod
    def canon_version_path(entity_dir: Path, version: int) -> Path:
        """`vNNN.json` в каталоге слоя или сущности: версия неизменяема, пишется один раз."""
        if not 1 <= version <= 999:
            raise ValueError(f"canon version must be in 1..999, got {version}")
        return entity_dir / f"v{version:03d}.json"

    @staticmethod
    def canon_draft_path(entity_dir: Path) -> Path:
        """Черновик — один на слой или сущность, рядом с версиями."""
        return entity_dir / "draft.json"

    # --- опорные: canon/anchors/<appearance_id>/{candidates/, rejected/, chosen.json}, style/ --

    def anchors_root(self, channel: str) -> Path:
        return self.canon_dir(channel) / "anchors"

    def anchor_dir(self, channel: str, appearance: str) -> Path:
        """Лист опорных портретов облика. В id облика есть `@`, с `style` он не совпадёт."""
        return self.anchors_root(channel) / check_appearance_id(appearance)

    def anchor_candidates_dir(self, channel: str, appearance: str) -> Path:
        return self.anchor_dir(channel, appearance) / "candidates"

    def anchor_rejected_dir(self, channel: str, appearance: str) -> Path:
        """Отбракованные кандидаты не удаляются — переезжают сюда."""
        return self.anchor_dir(channel, appearance) / "rejected"

    def anchor_chosen_path(self, channel: str, appearance: str) -> Path:
        return self.anchor_dir(channel, appearance) / "chosen.json"

    def style_anchors_dir(self, channel: str) -> Path:
        """Опорные кадры стиля канала."""
        return self.anchors_root(channel) / "style"

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

    def director_parts_dir(self, channel: str, episode: str) -> Path:
        """Части плана 1…N копятся здесь до сборки; после сборки папка очищается."""
        return self.cache_dir(channel, episode) / "director_parts"

    def director_part_path(self, channel: str, episode: str, part: int) -> Path:
        if part < 1:
            raise ValueError(f"director part must be >= 1, got {part}")
        return self.director_parts_dir(channel, episode) / f"part-{part:02d}.json"

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
