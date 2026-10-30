"""Контракт project.json (`studio.project/1`) — реализация эпизода.

Замысел лежит в director.json, здесь — что с ним сделали: текущая версия плана, ассеты и их
версии, тайминги кадров по выравниванию голоса, ручные правки (`*_locked`, `user_override`),
статусы кадров, стоимость по этапам. Описание — `docs/project_schema.md`.

Коллекции — объекты с ключом-идентификатором, а не массивы: тогда частичное обновление
(`PATCH /api/projects/{id}`) и мёрдж импорта плана по `shot.id` (M2.4) — одно правило
`merge_patch`. Время — float секунды; деньги — микродоллары.
"""

import re
from typing import Annotated, Any, Literal

from pydantic import ConfigDict, Field, model_validator

from app.models.director import (
    EPISODE_ID_PATTERN,
    SHOT_ID_PATTERN,
    Channel,
    Ease,
    MotionType,
    ReferenceMode,
    SfxSpec,
    ShotSize,
    Source,
    StrictModel,
    TransitionType,
)
from app.storage.db import now_iso

PROJECT_SCHEMA_VERSION = "studio.project/1"
DIRECTOR_VERSION_PATTERN = r"^v\d{3}$"

# `stale` — картинка перестала соответствовать плану или план конфликтует с блокировкой (M2.4);
# `removed` — кадр убран из плана, ассеты на месте (принцип 8).
ShotStatus = Literal["todo", "queued", "generating", "done", "failed", "stale", "removed"]
AssetKind = Literal["image", "voice", "animation", "sfx", "music", "thumbnail", "render"]
AssetStatus = Literal["ok", "stale", "failed"]
TimingSource = Literal["voice", "locked", "estimate"]
# Откуда версия плана (устав M4, решение 6): мост через чат, ручной импорт или правка JSON, API.
VersionSource = Literal["bridge", "manual", "api"]

# Поля кадра, которые правятся на экране 3 (устав M4, решение 6). Поля канона (`image.period`,
# `image.appearances`) меняет только новая версия плана.
OverrideField = Literal[
    "vo", "image.prompt", "image.shot_size", "motion", "transition_in", "animate", "sfx"
]

_SHOT_ID_RE = re.compile(SHOT_ID_PATTERN)


def _is_none(value: object) -> bool:
    return value is None


def _unset() -> Any:
    """Поле правки: нет значения — нет правки; в project.json не выгружается."""
    return Field(default=None, exclude_if=_is_none)


# --- правки кадра ---------------------------------------------------------------------------------
# Повторяют форму кадра плана, но каждое поле необязательно: правка `{"motion": {"strength": 0.12}}`
# меняет одну силу движения. Диапазоны и доменные проверки — у действующего кадра (план + правка):
# `Shot` и `validators.check_shot`, чтобы правило было одно.


class ImageOverride(StrictModel):
    prompt: str | None = _unset()
    shot_size: ShotSize | None = _unset()


class MotionOverride(StrictModel):
    type: MotionType | None = _unset()
    strength: float | None = _unset()
    ease: Ease | None = _unset()


class TransitionOverride(StrictModel):
    type: TransitionType | None = _unset()
    duration: float | None = _unset()


class AnimateOverride(StrictModel):
    recommended: bool | None = _unset()
    reason: str | None = _unset()
    prompt: str | None = _unset()
    seconds: int | None = _unset()


class ShotOverride(StrictModel):
    """Ручные правки полей кадра поверх плана. `sfx` заменяется целиком."""

    vo: str | None = _unset()
    image: ImageOverride | None = _unset()
    motion: MotionOverride | None = _unset()
    transition_in: TransitionOverride | None = _unset()
    animate: AnimateOverride | None = _unset()
    sfx: list[SfxSpec] | None = _unset()


class ShotState(StrictModel):
    status: ShotStatus = "todo"
    # Выбранная версия картинки — ассет `img-<кадр>-v<N>` (M6.1); поля нет — картинки нет.
    image_version: int | None = Field(default=None, ge=1, exclude_if=_is_none)
    duration_locked: bool = False
    prompt_locked: bool = False
    # Ручные правки полей кадра поверх плана; импорт новой версии их не затирает.
    user_override: ShotOverride | None = None
    # Почему кадр `stale`/`removed` — человеческим языком, ставит импорт плана. У кадра без
    # картинки — история изменений плана и канона: устаревать нечему, статус прежний (M6.1).
    stale_reasons: list[str] = []
    # Почему кадр `failed`: одна строка — что случилось и что сделать (M6.2); снимает новая версия.
    error: str | None = Field(default=None, exclude_if=_is_none)

    @property
    def has_image(self) -> bool:
        """Картинка есть — выбрана версия. Одно правило для импорта плана и ручной правки."""
        return self.image_version is not None


class DirectorVersionInfo(StrictModel):
    """Строка индекса версий плана: хэш для дедупа повторного импорта и итог мёрджа."""

    version: str = Field(pattern=DIRECTOR_VERSION_PATTERN)
    # sha256 канонического JSON плана: тот же план второй раз версию не создаёт.
    hash: str
    imported_at: str
    parts: int = Field(ge=1)
    # Записи до M4.2 поля не имеют — читаются как `manual`.
    source: VersionSource = "manual"
    shots: int = Field(ge=0)
    added: int = Field(ge=0)
    changed: int = Field(ge=0)
    removed: int = Field(ge=0)


# Проверка лица версии кадра (M6.5): `low` — пометка `consistency_low`, не блокировка; `no_face` —
# лиц в кадре нет, «не проверено»; `skipped` — проверить нельзя (нет весов, фаса), причина рядом.
FaceStatus = Literal["ok", "low", "no_face", "skipped"]


class FaceMatch(StrictModel):
    """Облик кадра против выбранного фаса его листа: лучшее сходство среди лиц кадра."""

    id: str  # облик, `you@powder-monkey-11`
    status: FaceStatus
    # Косинусное сходство эмбеддингов SFace, −1…1; нет — сравнивать было не с чем.
    score: float | None = Field(default=None, exclude_if=_is_none)
    front: str | None = Field(default=None, exclude_if=_is_none)  # кандидат фаса листа
    reason: str | None = Field(default=None, exclude_if=_is_none)


class FaceCheck(StrictModel):
    status: FaceStatus
    appearances: list[FaceMatch] = []
    faces: int = Field(default=0, ge=0)  # сколько лиц нашлось в кадре
    threshold: float | None = Field(default=None, exclude_if=_is_none)  # порог на момент проверки
    reason: str | None = Field(default=None, exclude_if=_is_none)  # почему `skipped`
    checked_at: str


# Проверка анахронизмов (M6.6): `suspect` — VLM увидела предметы из `forbidden` эпохи, пометка
# `anachronism_suspect`, не блокировка; `failed` — проверка не удалась (ответ, сеть, бюджет),
# кадр не помечается; `off` — проверка выключена в профиле канала, вызова не было.
AnachronismStatus = Literal["ok", "suspect", "failed", "off"]


class AnachronismCheck(StrictModel):
    status: AnachronismStatus
    # Найденное — формулировками `forbidden` эпохи, а не ответа модели; чужое отброшено.
    found: list[str] = []
    period: str | None = Field(default=None, exclude_if=_is_none)  # `periods/<эпоха>/vNNN`
    usd_micro: int | None = Field(default=None, ge=0, exclude_if=_is_none)  # из кэша — 0
    reason: str | None = Field(default=None, exclude_if=_is_none)  # почему `failed`
    checked_at: str


class AssetChecks(StrictModel):
    """Проверки консистентности версии (устав M6, решение 7): лицо (M6.5), анахронизмы (M6.6)."""

    face: FaceCheck | None = Field(default=None, exclude_if=_is_none)
    anachronism: AnachronismCheck | None = Field(default=None, exclude_if=_is_none)


class Asset(StrictModel):
    id: str
    shot_id: str | None = Field(default=None, pattern=SHOT_ID_PATTERN)
    kind: AssetKind
    version: int = Field(ge=1)
    # Относительно каталога выпуска: `media/s001/v002.png`.
    path: str
    # Хэш входов (принцип 8): по нему ищется готовый ассет.
    hash: str
    status: AssetStatus = "ok"
    # Метаданные отрисовки (M6.1): модель каталога, seed, номер варианта, цена в микродолларах,
    # когда сделан, из кэша ли. У ассетов без платного вызова и до M6 их нет.
    model: str | None = Field(default=None, exclude_if=_is_none)
    # ID модели провайдера на момент вызова: ключ каталога может позже вести к другой модели.
    model_id: str | None = Field(default=None, exclude_if=_is_none)
    seed: int | None = Field(default=None, exclude_if=_is_none)
    variant: int | None = Field(default=None, ge=1, exclude_if=_is_none)
    usd_micro: int | None = Field(default=None, ge=0, exclude_if=_is_none)
    created_at: str | None = Field(default=None, exclude_if=_is_none)
    cached: bool | None = Field(default=None, exclude_if=_is_none)
    # Проверки консистентности (M6.5–M6.6); у кадра без обликов и до M6.5 — нет.
    checks: AssetChecks | None = Field(default=None, exclude_if=_is_none)


def image_asset_id(shot_id: str, version: int) -> str:
    """id ассета версии картинки кадра: `img-s001-v3`."""
    return f"img-{shot_id}-v{version}"


class Timing(StrictModel):
    shot_id: str = Field(pattern=SHOT_ID_PATTERN)
    start: float = Field(ge=0.0)
    duration: float = Field(gt=0.0)
    source: TimingSource


class EpisodeBrief(StrictModel):
    """Заявка выпуска — вход промпта плана (устав M4, решение 5). Заполняется на экране 3 или
    из идеи / референса. Что вернул чат — `director.brief`, это другая модель."""

    idea: str = ""
    angle: str = ""
    hook_promise: str = ""
    notes: str = ""
    sources: list[Source] = []
    # Откуда заявка: идея бэклога (M4.8) или референс (M4.10); null — заполнена руками.
    idea_id: str | None = None
    reference_id: str | None = None
    reference_mode: ReferenceMode = "none"


class Project(StrictModel):
    model_config = ConfigDict(
        extra="forbid", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True
    )

    schema_version: Literal["studio.project/1"] = Field(alias="schema")
    episode_id: str = Field(pattern=EPISODE_ID_PATTERN)
    channel: Channel
    # Заявка выпуска; null — ещё не заполнена.
    brief: EpisodeBrief | None = None
    director_version: str | None = Field(default=None, pattern=DIRECTOR_VERSION_PATTERN)
    # Все импортированные версии плана; файлы — `director/vNNN.json`, неизменяемые.
    director_versions: dict[str, DirectorVersionInfo] = {}
    # «Утвердить план» (M4.6, принцип 10): какая версия и когда; поля нет — план не утверждали.
    # Новая версия их не трогает: утверждённая старше текущей — утвердить нужно снова.
    approved_version: str | None = Field(
        default=None, pattern=DIRECTOR_VERSION_PATTERN, exclude_if=_is_none
    )
    approved_at: str | None = Field(default=None, exclude_if=_is_none)
    shots: dict[str, ShotState] = {}
    assets: dict[str, Asset] = {}
    timings: dict[str, Timing] = {}
    # Этап → потрачено, микродоллары.
    cost: dict[str, Annotated[int, Field(ge=0)]] = {}
    updated_at: str

    @model_validator(mode="after")
    def _keys_match_ids(self) -> "Project":
        problems = [
            f"shots: key {k!r} is not a shot id" for k in self.shots if not _SHOT_ID_RE.fullmatch(k)
        ]
        problems += [
            f"assets: key {k!r} != asset.id {a.id!r}" for k, a in self.assets.items() if k != a.id
        ]
        problems += [
            f"timings: key {k!r} != shot_id {t.shot_id!r}"
            for k, t in self.timings.items()
            if k != t.shot_id
        ]
        problems += [
            f"director_versions: key {k!r} != version {v.version!r}"
            for k, v in self.director_versions.items()
            if k != v.version
        ]
        if problems:
            raise ValueError("; ".join(problems))
        return self

    @model_validator(mode="after")
    def _chosen_images_exist(self) -> "Project":
        """Выбранная версия кадра — ассет-картинка этого кадра (M6.1)."""
        problems = [
            f"shots: {k} image_version {s.image_version} has no image asset of this shot"
            for k, s in self.shots.items()
            if s.image_version is not None and not self._is_image_of(k, s.image_version)
        ]
        if problems:
            raise ValueError("; ".join(problems))
        return self

    def _is_image_of(self, shot_id: str, version: int) -> bool:
        asset = self.assets.get(image_asset_id(shot_id, version))
        return asset is not None and asset.kind == "image" and asset.shot_id == shot_id


class ShotPatch(StrictModel):
    """Правка состояния кадра в PATCH. Поле не прислано — не меняется (мёрдж идёт по сырому
    телу); `null` в правке поля — сброс этой правки, `user_override: null` — сброс всех."""

    duration_locked: bool = False
    prompt_locked: bool = False
    user_override: ShotOverride | None = None


class ProjectPatch(StrictModel):
    """Тело `PATCH /api/projects/{id}`: только то, что правит человек. Остальное в project.json
    пишет пайплайн (импорт плана, генерация, выравнивание, учёт расходов)."""

    brief: EpisodeBrief | None = None
    shots: dict[str, ShotPatch] = {}


def empty_project(channel: Channel, episode_id: str) -> Project:
    return Project.model_validate(
        {
            "schema": PROJECT_SCHEMA_VERSION,
            "episode_id": episode_id,
            "channel": channel,
            "updated_at": now_iso(),
        }
    )


def merge_patch(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """Словари сливаются рекурсивно, всё остальное (скаляры, списки, null) заменяется.

    Возвращает новый словарь, аргументы не меняет.
    """
    merged = dict(base)
    for key, value in patch.items():
        current = merged.get(key)
        if isinstance(current, dict) and isinstance(value, dict):
            merged[key] = merge_patch(current, value)
        else:
            merged[key] = value
    return merged
