import json
import os
import random
import sqlite3
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from app.models.project import Project, empty_project, merge_patch
from app.storage.atomic import read_json, write_json_atomic
from app.storage.db import apply_migrations, connect, list_migrations, migrate
from app.storage.paths import StudioPaths

# --- paths ---------------------------------------------------------------------------------------


@pytest.fixture
def paths(tmp_path: Path) -> StudioPaths:
    return StudioPaths(tmp_path / "data")


def test_tree_matches_claude_md(paths: StudioPaths) -> None:
    root = paths.root
    assert paths.db_path == root / "app.db"
    assert paths.channel_dir("cursus") == root / "channels" / "cursus"
    assert paths.profile_path("cursus") == root / "channels" / "cursus" / "profile.json"
    assert paths.oauth_dir("cursus") == root / "channels" / "cursus" / "oauth"
    assert paths.canon_dir("cursus") == root / "channels" / "cursus" / "canon"
    episode = root / "projects" / "cursus" / "c07-pirate-ship"
    assert paths.episode_dir("cursus", "c07-pirate-ship") == episode
    assert paths.director_dir("cursus", "c07-pirate-ship") == episode / "director"
    assert (
        paths.director_version_path("cursus", "c07-pirate-ship", 1)
        == episode / "director" / "v001.json"
    )
    assert (
        paths.director_version_path("cursus", "c07-pirate-ship", 12)
        == episode / "director" / "v012.json"
    )
    assert paths.project_path("cursus", "c07-pirate-ship") == episode / "project.json"
    assert paths.media_dir("cursus", "c07-pirate-ship") == episode / "media"
    assert paths.cache_dir("cursus", "c07-pirate-ship") == episode / "cache"
    assert paths.exports_dir("cursus", "c07-pirate-ship") == episode / "exports"
    assert paths.publish_dir("cursus", "c07-pirate-ship") == episode / "publish"
    assert paths.episode_tree("cursus", "c07-pirate-ship") == (
        episode / "director",
        episode / "media",
        episode / "cache",
        episode / "exports",
        episode / "publish",
    )
    assert "\\" not in str(paths.project_path("cursus", "c07-pirate-ship"))


@pytest.mark.parametrize("bad", ["..", "../x", "a/b", "Pirate", "", "-lead", "с-кириллицей"])
def test_ids_are_guarded(paths: StudioPaths, bad: str) -> None:
    with pytest.raises(ValueError):
        paths.channel_dir(bad)
    with pytest.raises(ValueError):
        paths.episode_dir("cursus", bad)
    with pytest.raises(ValueError):
        paths.episode_dir(bad, "pirate")


def test_director_version_starts_at_one(paths: StudioPaths) -> None:
    with pytest.raises(ValueError):
        paths.director_version_path("cursus", "pirate", 0)


# --- atomic --------------------------------------------------------------------------------------


def test_write_and_read_roundtrip(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "state.json"
    write_json_atomic(path, {"a": 1, "текст": ["ю", None]})
    assert read_json(path) == {"a": 1, "текст": ["ю", None]}
    assert path.read_text(encoding="utf-8").endswith("}\n")
    assert [p.name for p in path.parent.iterdir()] == ["state.json"]


class _Unserializable:
    pass


def test_interrupted_writes_leave_valid_json(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """L-003: 500 записей, в случайных — сбой внутри; файл всегда валиден, старый или новый."""
    path = tmp_path / "project.json"
    rng = random.Random(20260921)
    last_ok = -1
    failures = 0
    for i in range(500):
        payload: dict[str, Any] = {"version": i, "data": list(range(2000))}
        mode = rng.choice(["ok", "ok", "ok", "ok", "ok", "ok", "serialize", "replace", "fsync"])
        with monkeypatch.context() as m:
            if mode == "serialize":
                # json.dump пишет в файл кусками: половина данных уже на диске, потом TypeError.
                payload["data"].append(_Unserializable())
            elif mode == "replace":
                m.setattr(os, "replace", _raise_oserror)
            elif mode == "fsync":
                m.setattr(os, "fsync", _raise_oserror)
            try:
                write_json_atomic(path, payload)
            except (TypeError, OSError):
                failures += 1
            else:
                last_ok = i

        if last_ok >= 0:
            on_disk = json.loads(path.read_text(encoding="utf-8"))
            assert on_disk["version"] == last_ok
            assert on_disk["data"] == list(range(2000))
        else:
            assert not path.exists()
        assert [p.name for p in tmp_path.iterdir()] == (["project.json"] if last_ok >= 0 else [])
    assert failures > 100
    assert last_ok >= 0


def _raise_oserror(*_args: object, **_kwargs: object) -> None:
    raise OSError("simulated disk failure")


# --- db ------------------------------------------------------------------------------------------


def _schema_snapshot(conn: sqlite3.Connection) -> list[tuple[str, str, str]]:
    return [
        (row["type"], row["name"], row["sql"])
        for row in conn.execute(
            "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name"
        )
    ]


def test_migrate_twice_is_idempotent(tmp_path: Path) -> None:
    db_path = tmp_path / "data" / "app.db"
    all_versions = [version for version, _ in list_migrations()]
    assert migrate(db_path) == all_versions
    conn = connect(db_path)
    before = _schema_snapshot(conn)
    conn.close()

    assert migrate(db_path) == []
    conn = connect(db_path)
    assert _schema_snapshot(conn) == before
    versions = [row["version"] for row in conn.execute("SELECT version FROM schema_version")]
    assert versions == all_versions
    tables = {
        row["name"] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    assert {
        "schema_version",
        "channels",
        "episodes",
        "jobs",
        "job_events",
        "assets",
        "cost_ledger",
    } <= tables
    conn.close()


def test_connection_pragmas(tmp_path: Path) -> None:
    conn = connect(tmp_path / "app.db")
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
    conn.close()


def test_foreign_keys_enforced(tmp_path: Path) -> None:
    conn = connect(tmp_path / "app.db")
    apply_migrations(conn)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO episodes (id, channel, title, created_at, updated_at)"
            " VALUES ('x', 'ghost', 't', 'now', 'now')"
        )
    conn.close()


def test_migrations_are_numbered_and_sorted() -> None:
    listed = list_migrations()
    assert [v for v, _ in listed] == list(range(1, len(listed) + 1))
    assert listed[0][1].name == "001_init.sql"


# --- project.json --------------------------------------------------------------------------------


def test_merge_patch_rules() -> None:
    base = {"a": {"x": 1, "y": {"deep": True}}, "list": [1, 2], "keep": "k", "n": 1}
    patch = {"a": {"y": {"more": 2}, "z": 3}, "list": [9], "n": None}
    merged = merge_patch(base, patch)
    assert merged == {
        "a": {"x": 1, "y": {"deep": True, "more": 2}, "z": 3},
        "list": [9],
        "keep": "k",
        "n": None,
    }
    # Аргументы не меняются.
    assert base == {"a": {"x": 1, "y": {"deep": True}}, "list": [1, 2], "keep": "k", "n": 1}
    assert patch == {"a": {"y": {"more": 2}, "z": 3}, "list": [9], "n": None}


def test_empty_project_shape() -> None:
    dumped = empty_project("cursus", "pirate").model_dump(mode="json")
    assert dumped["schema"] == "studio.project/1"
    assert dumped["episode_id"] == "pirate"
    assert dumped["channel"] == "cursus"
    assert dumped["director_version"] is None
    assert dumped["shots"] == {} and dumped["assets"] == {} and dumped["timings"] == {}
    assert dumped["cost"] == {}
    assert Project.model_validate(dumped).model_dump(mode="json") == dumped


def test_project_keys_must_match_ids() -> None:
    base = empty_project("cursus", "pirate").model_dump(mode="json")
    with pytest.raises(ValidationError, match="shots: key 'bad'"):
        Project.model_validate(merge_patch(base, {"shots": {"bad": {}}}))
    asset = {"id": "img-1", "kind": "image", "version": 1, "path": "media/a.png", "hash": "h"}
    with pytest.raises(ValidationError, match="assets: key 'other'"):
        Project.model_validate(merge_patch(base, {"assets": {"other": asset}}))
    timing = {"shot_id": "s002", "start": 0.0, "duration": 3.5, "source": "voice"}
    with pytest.raises(ValidationError, match="timings: key 's001'"):
        Project.model_validate(merge_patch(base, {"timings": {"s001": timing}}))
    with pytest.raises(ValidationError):
        Project.model_validate(merge_patch(base, {"unknown_field": 1}))
