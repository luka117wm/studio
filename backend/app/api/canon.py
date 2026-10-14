"""Канон канала: сводка слоёв, черновики, публикация версий (`docs/canon_schema.md`, «API»).

Слои — `style` (один на канал), `periods/{id}`, `characters/{id}`. У каждого одинаковый набор:
`GET` (`?version=`; без него — черновик или последняя версия), `PUT …/draft`, `POST …/publish`,
`POST …/draft?from=vNNN`, `DELETE …/draft`. Отказы хранилища (`CanonError`) — 404/409 с
текстом в `detail`; форма тела — 422 с ошибками по полям.

«Нужно каналу» (M5.2) — эпохи и облики из планов выпусков без опубликованной версии и скелеты
черновиков для них (`docs/canon_schema.md`, «Нужно каналу»).
"""

from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.channels import require_channel
from app.api.deps import DbDep, PathsDep
from app.api.episodes import channel_episodes, load_sources
from app.models.canon import (
    Appearance,
    AppearanceId,
    CanonId,
    CanonSummary,
    Character,
    CharacterDoc,
    Period,
    PeriodDoc,
    Style,
    StyleDoc,
    VersionTag,
)
from app.pipeline.canon.episode_canon import (
    CanonNeeded,
    EpisodePlan,
    canon_needed,
    published_canon,
)
from app.storage import canon_store
from app.storage.canon_store import (
    CHARACTERS,
    PERIODS,
    STYLE,
    CanonConflict,
    CanonError,
    CanonNotFound,
    Entry,
)
from app.storage.paths import StudioPaths

router = APIRouter(prefix="/canon", tags=["canon"])

EntityIdParam = CanonId
VersionQuery = Annotated[VersionTag | None, Query()]
FromQuery = Annotated[VersionTag, Query(alias="from")]


async def canon_error(_: Request, exc: Exception) -> JSONResponse:
    """`CanonError` → его код и фраза в `detail`, как у `HTTPException` (L-032)."""
    assert isinstance(exc, CanonError)
    return JSONResponse(status_code=exc.status, content={"detail": str(exc)})


def _doc[D: (StyleDoc, PeriodDoc, CharacterDoc)](cls: type[D], entry: Entry[Any]) -> D:
    return cls(
        draft=entry.version is None,
        version=entry.version,
        based_on=entry.based_on,
        updated_at=entry.updated_at,
        data=entry.data,
    )


def _same_id(path_id: str, body_id: str) -> None:
    """id в теле черновика — тот же, что в адресе: иначе черновик лёг бы не в ту сущность."""
    if body_id != path_id:
        raise RequestValidationError(
            [
                {
                    "type": "canon_id_mismatch",
                    "loc": ("body", "id"),
                    "msg": f"id «{body_id}» в теле не совпадает с адресом «{path_id}» — "
                    "исправьте одно из двух.",
                    "input": body_id,
                }
            ]
        )


@router.get("/{channel}")
async def get_canon(channel: str, paths: PathsDep, db: DbDep) -> CanonSummary:
    require_channel(db, channel)
    return canon_store.summary(paths, channel)


# --- стиль канала --------------------------------------------------------------------------------


@router.get("/{channel}/style")
async def get_style(
    channel: str, paths: PathsDep, db: DbDep, version: VersionQuery = None
) -> StyleDoc:
    require_channel(db, channel)
    return _doc(StyleDoc, canon_store.read_entry(paths, channel, STYLE, None, version))


@router.put("/{channel}/style/draft")
async def put_style_draft(channel: str, body: Style, paths: PathsDep, db: DbDep) -> StyleDoc:
    require_channel(db, channel)
    return _doc(StyleDoc, canon_store.save_draft(paths, channel, STYLE, None, body))


@router.post("/{channel}/style/draft", status_code=201)
async def style_draft_from(channel: str, from_: FromQuery, paths: PathsDep, db: DbDep) -> StyleDoc:
    require_channel(db, channel)
    return _doc(StyleDoc, canon_store.draft_from(paths, channel, STYLE, None, from_))


@router.delete("/{channel}/style/draft", status_code=204)
async def delete_style_draft(channel: str, paths: PathsDep, db: DbDep) -> Response:
    require_channel(db, channel)
    canon_store.discard_draft(paths, channel, STYLE)
    return Response(status_code=204)


@router.post("/{channel}/style/publish", status_code=201)
async def publish_style(channel: str, paths: PathsDep, db: DbDep) -> StyleDoc:
    require_channel(db, channel)
    return _doc(StyleDoc, canon_store.publish(paths, channel, STYLE))


# --- эпохи ---------------------------------------------------------------------------------------


@router.get("/{channel}/periods/{period_id}")
async def get_period(
    channel: str, period_id: EntityIdParam, paths: PathsDep, db: DbDep, version: VersionQuery = None
) -> PeriodDoc:
    require_channel(db, channel)
    return _doc(PeriodDoc, canon_store.read_entry(paths, channel, PERIODS, period_id, version))


@router.put("/{channel}/periods/{period_id}/draft")
async def put_period_draft(
    channel: str, period_id: EntityIdParam, body: Period, paths: PathsDep, db: DbDep
) -> PeriodDoc:
    require_channel(db, channel)
    _same_id(period_id, body.id)
    return _doc(PeriodDoc, canon_store.save_draft(paths, channel, PERIODS, period_id, body))


@router.post("/{channel}/periods/{period_id}/draft", status_code=201)
async def period_draft_from(
    channel: str, period_id: EntityIdParam, from_: FromQuery, paths: PathsDep, db: DbDep
) -> PeriodDoc:
    require_channel(db, channel)
    return _doc(PeriodDoc, canon_store.draft_from(paths, channel, PERIODS, period_id, from_))


@router.delete("/{channel}/periods/{period_id}/draft", status_code=204)
async def delete_period_draft(
    channel: str, period_id: EntityIdParam, paths: PathsDep, db: DbDep
) -> Response:
    require_channel(db, channel)
    canon_store.discard_draft(paths, channel, PERIODS, period_id)
    return Response(status_code=204)


@router.post("/{channel}/periods/{period_id}/publish", status_code=201)
async def publish_period(
    channel: str, period_id: EntityIdParam, paths: PathsDep, db: DbDep
) -> PeriodDoc:
    require_channel(db, channel)
    return _doc(PeriodDoc, canon_store.publish(paths, channel, PERIODS, period_id))


# --- персонажи -----------------------------------------------------------------------------------


@router.get("/{channel}/characters/{character_id}")
async def get_character(
    channel: str,
    character_id: EntityIdParam,
    paths: PathsDep,
    db: DbDep,
    version: VersionQuery = None,
) -> CharacterDoc:
    require_channel(db, channel)
    entry = canon_store.read_entry(paths, channel, CHARACTERS, character_id, version)
    return _doc(CharacterDoc, entry)


@router.put("/{channel}/characters/{character_id}/draft")
async def put_character_draft(
    channel: str, character_id: EntityIdParam, body: Character, paths: PathsDep, db: DbDep
) -> CharacterDoc:
    require_channel(db, channel)
    _same_id(character_id, body.id)
    entry = canon_store.save_draft(paths, channel, CHARACTERS, character_id, body)
    return _doc(CharacterDoc, entry)


@router.post("/{channel}/characters/{character_id}/draft", status_code=201)
async def character_draft_from(
    channel: str, character_id: EntityIdParam, from_: FromQuery, paths: PathsDep, db: DbDep
) -> CharacterDoc:
    require_channel(db, channel)
    entry = canon_store.draft_from(paths, channel, CHARACTERS, character_id, from_)
    return _doc(CharacterDoc, entry)


@router.delete("/{channel}/characters/{character_id}/draft", status_code=204)
async def delete_character_draft(
    channel: str, character_id: EntityIdParam, paths: PathsDep, db: DbDep
) -> Response:
    require_channel(db, channel)
    canon_store.discard_draft(paths, channel, CHARACTERS, character_id)
    return Response(status_code=204)


@router.post("/{channel}/characters/{character_id}/publish", status_code=201)
async def publish_character(
    channel: str, character_id: EntityIdParam, paths: PathsDep, db: DbDep
) -> CharacterDoc:
    require_channel(db, channel)
    return _doc(CharacterDoc, canon_store.publish(paths, channel, CHARACTERS, character_id))


# --- нужно каналу --------------------------------------------------------------------------------


@router.get("/{channel}/needed")
async def get_needed(channel: str, paths: PathsDep, db: DbDep) -> CanonNeeded:
    """Эпохи и облики из `canon_ref` текущих версий планов канала, у которых нет ни одной
    опубликованной версии: какие выпуски и сколько кадров на них ссылаются."""
    require_channel(db, channel)
    plans: list[EpisodePlan] = []
    for episode in channel_episodes(db, channel):
        _, director = load_sources(paths, episode)
        if director is not None:
            plans.append(EpisodePlan(episode.id, episode.title, director))
    return canon_needed(channel, plans, published_canon(paths, channel))


@router.post("/{channel}/needed/periods/{period_id}", status_code=201)
async def create_needed_period(
    channel: str, period_id: EntityIdParam, paths: PathsDep, db: DbDep
) -> PeriodDoc:
    """Скелет-черновик эпохи: только id. Опубликованная эпоха или начатый черновик — 409."""
    require_channel(db, channel)
    versions = canon_store.list_versions(paths, channel, PERIODS, period_id)
    if versions:
        raise CanonConflict(
            f"Эпоха {period_id} уже опубликована ({versions[-1].version}) — создавать её не нужно."
        )
    try:
        canon_store.read_entry(paths, channel, PERIODS, period_id)
    except CanonNotFound:
        entry = canon_store.save_draft(paths, channel, PERIODS, period_id, Period(id=period_id))
        return _doc(PeriodDoc, entry)
    raise CanonConflict(
        f"У эпохи {period_id} уже есть черновик — откройте его на экране «Канон» и опубликуйте."
    )


@router.post("/{channel}/needed/appearances/{appearance_id}", status_code=201)
async def create_needed_appearance(
    channel: str, appearance_id: AppearanceId, paths: PathsDep, db: DbDep
) -> CharacterDoc:
    """Скелет облика в черновике персонажа: черновик есть — облик дописывается в него, нет —
    черновик начинается с последней версии, персонажа нет — создаётся. Облик уже опубликован или
    уже в черновике — 409."""
    require_channel(db, channel)
    return _doc(CharacterDoc, _appearance_skeleton(paths, channel, appearance_id))


def _appearance_skeleton(paths: StudioPaths, channel: str, appearance_id: str) -> Entry[Character]:
    character_id = appearance_id.split("@", 1)[0]
    for info in reversed(canon_store.list_versions(paths, channel, CHARACTERS, character_id)):
        published = canon_store.read_entry(paths, channel, CHARACTERS, character_id, info.version)
        if published.data.appearance(appearance_id) is not None:
            raise CanonConflict(
                f"Облик {appearance_id} уже опубликован в characters/{character_id}/"
                f"{info.version} — создавать его не нужно."
            )
    skeleton = Appearance(id=appearance_id)
    try:
        entry = canon_store.read_entry(paths, channel, CHARACTERS, character_id)
    except CanonNotFound:
        character = Character(id=character_id, appearances=[skeleton])
        return canon_store.save_draft(paths, channel, CHARACTERS, character_id, character)
    if entry.data.appearance(appearance_id) is not None:
        raise CanonConflict(
            f"Облик {appearance_id} уже есть в черновике персонажа {character_id} — откройте его "
            "на экране «Канон» и опубликуйте."
        )
    character = entry.data.model_copy(update={"appearances": [*entry.data.appearances, skeleton]})
    return canon_store.save_draft(paths, channel, CHARACTERS, character_id, character)
