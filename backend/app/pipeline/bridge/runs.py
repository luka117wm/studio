"""Журнал обменов моста `bridge_runs`: промпт выдан → ответ принят или отклонён.

Отсюда экран берёт «Последний прогон» и состояние частей плана. Текст ответа чата не хранится —
только ошибки; принятый план ляжет файлом версии (M4.2). Строк в `cost_ledger` мост не пишет:
для приложения он бесплатен (устав M4, решение 1). Контракт — `docs/bridge.md`.

Повторный ответ на уже закрытый обмен — новая строка с тем же промптом: история попыток не
переписывается. Ответ без открытого обмена (вставка из старого чата) — `record_answer`, строка
открывается и закрывается сразу.
"""

import json
import sqlite3
import uuid
from typing import Literal

from pydantic import BaseModel, Field

from app.models.director import Channel
from app.pipeline.bridge.errors import BridgeIssue
from app.pipeline.bridge.prompts import BridgeTask, RenderedPrompt
from app.storage.db import now_iso

RunStatus = Literal["prompted", "applied", "failed"]
AnswerStatus = Literal["applied", "failed"]

LATEST_LIMIT = 20

_COLUMNS = (
    "id, task, channel, episode_id, target_id, prompt_id, prompt_version, prompt_hash, part,"
    " parts_total, status, errors, created_at, answered_at"
)


class BridgeRun(BaseModel):
    id: str
    task: BridgeTask
    channel: Channel
    episode_id: str | None
    target_id: str | None
    prompt_id: str
    prompt_version: int
    prompt_hash: str
    part: int = Field(ge=1)
    parts_total: int = Field(ge=1)
    status: RunStatus
    errors: list[BridgeIssue]
    created_at: str
    answered_at: str | None

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "BridgeRun":
        data = dict(row)
        data["errors"] = json.loads(data["errors"])
        return cls.model_validate(data)


class RunNotFound(LookupError):
    pass


def open_run(
    conn: sqlite3.Connection,
    *,
    task: BridgeTask,
    channel: Channel,
    prompt: RenderedPrompt,
    episode_id: str | None = None,
    target_id: str | None = None,
    part: int = 1,
    parts_total: int = 1,
) -> BridgeRun:
    """Промпт выдан пользователю: строка `prompted`."""
    run_id = _insert(
        conn,
        task=task,
        channel=channel,
        episode_id=episode_id,
        target_id=target_id,
        prompt_id=prompt.prompt_id,
        prompt_version=prompt.version,
        prompt_hash=prompt.sha256,
        part=part,
        parts_total=parts_total,
        status="prompted",
        errors=[],
    )
    conn.commit()
    return get_run(conn, run_id)


def close_run(
    conn: sqlite3.Connection,
    run_id: str,
    status: AnswerStatus,
    errors: list[BridgeIssue] | None = None,
) -> BridgeRun:
    """Ответ на обмен принят (`applied`) или отклонён (`failed`) с ошибками.

    Обмен уже закрыт — ответ пишется новой строкой с тем же промптом; закрытая не меняется.
    """
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute(f"SELECT {_COLUMNS} FROM bridge_runs WHERE id = ?", (run_id,)).fetchone()
        if row is None:
            raise RunNotFound(f"Обмена {run_id} нет в журнале моста.")
        run = BridgeRun.from_row(row)
        if run.status == "prompted":
            conn.execute(
                "UPDATE bridge_runs SET status = ?, errors = ?, answered_at = ? WHERE id = ?",
                (status, _errors_json(errors), now_iso(), run_id),
            )
            result_id = run_id
        else:
            result_id = _insert(
                conn,
                task=run.task,
                channel=run.channel,
                episode_id=run.episode_id,
                target_id=run.target_id,
                prompt_id=run.prompt_id,
                prompt_version=run.prompt_version,
                prompt_hash=run.prompt_hash,
                part=run.part,
                parts_total=run.parts_total,
                status=status,
                errors=errors or [],
            )
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return get_run(conn, result_id)


def record_answer(
    conn: sqlite3.Connection,
    *,
    task: BridgeTask,
    channel: Channel,
    prompt: RenderedPrompt,
    status: AnswerStatus,
    errors: list[BridgeIssue] | None = None,
    episode_id: str | None = None,
    target_id: str | None = None,
    part: int = 1,
    parts_total: int = 1,
) -> BridgeRun:
    """Ответ без открытого обмена: строка открывается и закрывается сразу.

    `prompt` — промпт, который приложение выдало бы для этого ответа сейчас.
    """
    run_id = _insert(
        conn,
        task=task,
        channel=channel,
        episode_id=episode_id,
        target_id=target_id,
        prompt_id=prompt.prompt_id,
        prompt_version=prompt.version,
        prompt_hash=prompt.sha256,
        part=part,
        parts_total=parts_total,
        status=status,
        errors=errors or [],
    )
    conn.commit()
    return get_run(conn, run_id)


def get_run(conn: sqlite3.Connection, run_id: str) -> BridgeRun:
    row = conn.execute(f"SELECT {_COLUMNS} FROM bridge_runs WHERE id = ?", (run_id,)).fetchone()
    if row is None:
        raise RunNotFound(f"Обмена {run_id} нет в журнале моста.")
    return BridgeRun.from_row(row)


def latest_runs(
    conn: sqlite3.Connection,
    *,
    episode_id: str | None = None,
    target_id: str | None = None,
    task: BridgeTask | None = None,
    limit: int = LATEST_LIMIT,
) -> list[BridgeRun]:
    """Последние обмены, новые первыми; фильтры складываются через AND."""
    where: list[str] = []
    params: list[str | int] = []
    for column, value in (("episode_id", episode_id), ("target_id", target_id), ("task", task)):
        if value is not None:
            where.append(f"{column} = ?")
            params.append(value)
    sql = f"SELECT {_COLUMNS} FROM bridge_runs"
    if where:
        sql += " WHERE " + " AND ".join(where)
    # rowid — порядок вставки внутри одной секунды `created_at`.
    sql += " ORDER BY created_at DESC, rowid DESC LIMIT ?"
    params.append(limit)
    return [BridgeRun.from_row(row) for row in conn.execute(sql, params)]


def _insert(
    conn: sqlite3.Connection,
    *,
    task: BridgeTask,
    channel: Channel,
    episode_id: str | None,
    target_id: str | None,
    prompt_id: str,
    prompt_version: int,
    prompt_hash: str,
    part: int,
    parts_total: int,
    status: RunStatus,
    errors: list[BridgeIssue],
) -> str:
    """Строка журнала; закрытая (`applied`/`failed`) получает `answered_at` = `created_at`."""
    if not 1 <= part <= parts_total:
        raise ValueError(f"part {part} вне 1…{parts_total}")
    run_id = uuid.uuid4().hex
    stamp = now_iso()
    conn.execute(
        f"INSERT INTO bridge_runs ({_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            run_id,
            task,
            channel,
            episode_id,
            target_id,
            prompt_id,
            prompt_version,
            prompt_hash,
            part,
            parts_total,
            status,
            _errors_json(errors),
            stamp,
            None if status == "prompted" else stamp,
        ),
    )
    return run_id


def _errors_json(errors: list[BridgeIssue] | None) -> str:
    return json.dumps([e.model_dump() for e in errors or []], ensure_ascii=False)
