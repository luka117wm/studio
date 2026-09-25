"""Выгрузка схем API (M2.7): файлы в docs/ совпадают с генерацией, группы полны, режимы верны."""

import json

import pytest

from app.jobs.queue import JobSummary
from app.settings import REPO_ROOT
from app.tools.gen_schema import API_GROUPS, build_api_schema, main, render_all


def test_schema_files_are_up_to_date() -> None:
    stale = [
        path.relative_to(REPO_ROOT).as_posix()
        for path, text in render_all().items()
        if not path.is_file() or path.read_text(encoding="utf-8") != text
    ]
    assert stale == [], "перегенерируйте: pnpm -C frontend typegen"


def test_groups_have_every_model_and_id_only_on_file() -> None:
    for group, models in API_GROUPS.items():
        schema = build_api_schema(group)
        assert schema["$id"] == f"studio.api/{group}"
        assert {model.__name__ for model, _ in models} <= set(schema["$defs"])
        # `$id` внутри `$defs` сменил бы базовый URI, и `#/$defs/…` в подсхеме не нашлись бы.
        assert all("$id" not in definition for definition in schema["$defs"].values())


def test_response_defaults_are_required_request_defaults_are_not() -> None:
    defs = build_api_schema("job")["$defs"]
    assert "cost_usd_micro" in defs["Job"]["required"]
    assert set(defs["JobSummary"]["required"]) == set(JobSummary.model_fields)
    assert defs["JobCreate"]["required"] == ["kind"]


def test_stdout_mode_prints_all_files_and_writes_nothing(
    capsys: pytest.CaptureFixture[str],
) -> None:
    before = {path: path.stat().st_mtime_ns for path in render_all() if path.is_file()}
    main(["--stdout"])
    printed = json.loads(capsys.readouterr().out)
    expected = {path.relative_to(REPO_ROOT).as_posix() for path in render_all()}
    assert set(printed) == expected
    assert "docs/director.schema.json" in printed
    assert {path: path.stat().st_mtime_ns for path in before} == before
