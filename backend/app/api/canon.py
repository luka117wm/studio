"""Канон канала: сводка слоёв, черновики, публикация версий (`docs/canon_schema.md`, «API»).

Слои — `style` (один на канал), `periods/{id}`, `characters/{id}`. У каждого одинаковый набор:
`GET` (`?version=`; без него — черновик или последняя версия), `PUT …/draft`, `POST …/publish`,
`POST …/draft?from=vNNN`, `DELETE …/draft`. Отказы хранилища (`CanonError`) — 404/409 с
текстом в `detail`; форма тела — 422 с ошибками по полям.
"""

from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api.channels import require_channel
from app.api.deps import DbDep, PathsDep
from app.models.canon import (
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
from app.storage import canon_store
from app.storage.canon_store import CHARACTERS, PERIODS, STYLE, CanonError, Entry

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
