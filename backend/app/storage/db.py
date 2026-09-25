"""SQLite: подключение, миграции по `schema_version`, зависимость FastAPI.

Соединение — на поток и на запрос, `check_same_thread` не отключаем. Поэтому зависимость и
роутеры, которые её используют, — `async def`: FastAPI гоняет синхронные зависимости и
эндпоинты в threadpool в потенциально разных потоках, а async-код — в потоке event loop.
Операции локальные и миллисекундные, блокировка loop приемлема. Воркеры (M2.5) открывают
свои соединения в своих потоках через `connect()`.
"""

import logging
import re
import sqlite3
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

from fastapi import Request

log = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
_MIGRATION_NAME = re.compile(r"^(\d{3})_[a-z0-9_]+\.sql$")
BUSY_TIMEOUT_MS = 5000


def now_iso() -> str:
    """Единый формат времени в БД и JSON: ISO 8601 UTC с точностью до секунды."""
    return datetime.now(UTC).isoformat(timespec="seconds")


def connect(db_path: Path) -> sqlite3.Connection:
    """Соединение с прагмами проекта. Транзакции — явные `commit()` вызывающего."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    return conn


def list_migrations(directory: Path = MIGRATIONS_DIR) -> list[tuple[int, Path]]:
    """Пары (версия, файл) по возрастанию версии; имена — `NNN_name.sql`."""
    found: list[tuple[int, Path]] = []
    for file in directory.iterdir():
        match = _MIGRATION_NAME.match(file.name)
        if match:
            found.append((int(match.group(1)), file))
    found.sort()
    versions = [v for v, _ in found]
    if len(set(versions)) != len(versions):
        raise RuntimeError(f"duplicate migration versions in {directory}: {versions}")
    return found


def apply_migrations(conn: sqlite3.Connection) -> list[int]:
    """Накатывает недостающие миграции; возвращает применённые версии. Повторный вызов — no-op."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version ("
        " version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
    )
    conn.commit()
    row = conn.execute("SELECT COALESCE(MAX(version), 0) FROM schema_version").fetchone()
    current = int(row[0])
    applied: list[int] = []
    for version, file in list_migrations():
        if version <= current:
            continue
        sql = file.read_text(encoding="utf-8")
        stamp = now_iso()
        script = (
            "BEGIN;\n"
            f"{sql}\n"
            f"INSERT INTO schema_version (version, applied_at) VALUES ({version}, '{stamp}');\n"
            "COMMIT;"
        )
        try:
            conn.executescript(script)
        except sqlite3.Error:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            log.error("migration %s failed", file.name)
            raise
        applied.append(version)
        log.info("migration applied: %s", file.name)
    return applied


def migrate(db_path: Path | None = None) -> list[int]:
    """Точка входа для приложения и командной строки. Без аргумента — БД из `Settings`."""
    if db_path is None:
        from app.settings import Settings

        db_path = Settings().studio_data_dir / "app.db"
    conn = connect(db_path)
    try:
        return apply_migrations(conn)
    finally:
        conn.close()


async def get_db(request: Request) -> AsyncIterator[sqlite3.Connection]:
    """Зависимость FastAPI: соединение на запрос в потоке event loop."""
    conn = connect(request.app.state.paths.db_path)
    try:
        yield conn
    finally:
        conn.close()
