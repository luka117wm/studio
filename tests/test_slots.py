import datetime as dt
import json
import sqlite3
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api import episodes as episodes_api
from app.api import slots as slots_api
from app.api.episodes import EpisodeCreate
from app.settings import Settings
from app.slots import schedule
from app.slots.schedule import Schedule, SlotEpisode, SlotRisk
from app.storage.atomic import write_json_atomic
from app.storage.db import connect
from app.storage.paths import StudioPaths
from app.tools.seed import seed

# «Сегодня» артборда 1: пятница, 11 сентября; слоты через день.
TODAY = dt.date(2026, 9, 11)
SCHEDULE = Schedule(anchor=TODAY, every_days=2, risk_days=2)


@pytest.fixture
def paths(settings: Settings) -> StudioPaths:
    return StudioPaths(settings.studio_data_dir)


@pytest.fixture
def seeded(
    client: TestClient, paths: StudioPaths, monkeypatch: pytest.MonkeyPatch
) -> Iterator[TestClient]:
    monkeypatch.setattr(schedule, "today", lambda: TODAY)
    conn = connect(paths.db_path)
    try:
        seed(paths, conn)
    finally:
        conn.close()
    yield client


def create(client: TestClient, **body: Any) -> dict[str, Any]:
    response = client.post("/api/episodes", json={"channel": "cursus", **body})
    assert response.status_code == 201, response.text
    result: dict[str, Any] = response.json()
    return result


def set_state(paths: StudioPaths, episode_id: str, stage: str, status: str) -> None:
    """Стадию и статус меняют действия пайплайна следующих модулей — в тесте напрямую."""
    conn = connect(paths.db_path)
    try:
        conn.execute(
            "UPDATE episodes SET stage = ?, status = ? WHERE id = ?", (stage, status, episode_id)
        )
        conn.commit()
    finally:
        conn.close()


# --- даты расписания ------------------------------------------------------------------------------


def test_slots_run_both_ways_from_anchor() -> None:
    assert schedule.is_slot(SCHEDULE, dt.date(2026, 9, 1))  # за 10 дней до якоря
    assert not schedule.is_slot(SCHEDULE, dt.date(2026, 9, 2))
    assert schedule.slot_on_or_after(SCHEDULE, dt.date(2026, 9, 2)) == dt.date(2026, 9, 3)
    assert schedule.slot_on_or_after(SCHEDULE, dt.date(2026, 9, 3)) == dt.date(2026, 9, 3)
    every_three = Schedule(anchor=TODAY, every_days=3)
    assert schedule.slot_dates(every_three, dt.date(2026, 9, 12), 3) == [
        dt.date(2026, 9, 14),
        dt.date(2026, 9, 17),
        dt.date(2026, 9, 20),
    ]


def test_default_window_has_three_past_slots_even_between_slots() -> None:
    days = schedule.slot_dates(SCHEDULE, schedule.window_start(SCHEDULE, TODAY), 11)
    assert days[0] == dt.date(2026, 9, 5)
    assert days[3] == TODAY
    between = dt.date(2026, 9, 12)  # не день слота
    days = schedule.slot_dates(SCHEDULE, schedule.window_start(SCHEDULE, between), 11)
    assert [d for d in days if d < between] == [
        dt.date(2026, 9, 7),
        dt.date(2026, 9, 9),
        dt.date(2026, 9, 11),
    ]


def test_schedule_file_is_created_once_with_today_as_anchor(paths: StudioPaths) -> None:
    first = schedule.load_schedule(paths, TODAY)
    assert first == SCHEDULE
    assert json.loads(paths.schedule_path.read_text(encoding="utf-8")) == {
        "anchor": "2026-09-11",
        "every_days": 2,
        "risk_days": 2,
    }
    # Якорь не «ползёт» за сегодняшним днём: файл уже есть.
    assert schedule.load_schedule(paths, TODAY + dt.timedelta(days=5)) == SCHEDULE


def test_broken_schedule_is_500_with_what_to_do(seeded: TestClient, paths: StudioPaths) -> None:
    paths.schedule_path.parent.mkdir(parents=True, exist_ok=True)
    paths.schedule_path.write_text('{"anchor": "someday"}', encoding="utf-8")
    response = seeded.get("/api/slots")
    assert response.status_code == 500
    assert "schedule.json" in response.json()["detail"]
    assert "удалите его" in response.json()["detail"]


# --- состояния и риски: окно артборда 1 ----------------------------------------------------------

# Выпуски артборда: слот → (id, стадия, статус).
ARTBOARD = {
    "2026-09-05": ("viking", "publish", "published"),
    "2026-09-07": ("aztec", "publish", "published"),
    "2026-09-11": ("peasant", "export", "ready"),
    "2026-09-13": ("pirate", "edit", "warning"),
    "2026-09-15": ("monastery", "generate", "generating"),
    "2026-09-17": ("samurai", "script", "generating"),
    "2026-09-19": ("sweep", "generate", "failed"),
    "2026-09-21": ("arsenal", "idea", "queued"),
}

# date, weekday, episode_id, state, risk — как в `SLOTS` и рамках артборда при включённых рисках.
EXPECTED_WINDOW = [
    ("2026-09-05", 6, "viking", "published", None),
    ("2026-09-07", 1, "aztec", "published", None),
    ("2026-09-09", 3, None, "missed", None),
    ("2026-09-11", 5, "peasant", "today", None),
    ("2026-09-13", 7, "pirate", "filled", {"level": "warning", "reason": "not_exported"}),
    ("2026-09-15", 2, "monastery", "filled", None),
    ("2026-09-17", 4, "samurai", "filled", None),
    ("2026-09-19", 6, "sweep", "filled", {"level": "failed", "reason": "shots_failed"}),
    ("2026-09-21", 1, "arsenal", "filled", None),
    ("2026-09-23", 3, None, "empty", None),
    ("2026-09-25", 5, None, "empty", None),
]


def test_window_matches_artboard(seeded: TestClient, paths: StudioPaths) -> None:
    for slot, (episode_id, stage, status) in ARTBOARD.items():
        create(seeded, id=episode_id, slot=slot)
        set_state(paths, episode_id, stage, status)

    response = seeded.get("/api/slots")
    assert response.status_code == 200, response.text
    got = [
        (s["date"], s["weekday"], s["episode_id"], s["state"], s["risk"]) for s in response.json()
    ]
    assert got == EXPECTED_WINDOW
    assert {s["channel"] for s in response.json() if s["episode_id"]} == {"cursus"}

    # `from` округляется вверх до слота, `count` задаёт длину.
    window = seeded.get("/api/slots", params={"from": "2026-09-12", "count": 2}).json()
    assert [s["date"] for s in window] == ["2026-09-13", "2026-09-15"]


def ep(stage: str, status: str) -> SlotEpisode:
    return SlotEpisode(id="e", channel="cursus", stage=stage, status=status)


@pytest.mark.parametrize(
    ("day", "episode", "state", "risk"),
    [
        # прошлый слот с неопубликованным выпуском — пропущен, риска у прошлого нет
        (dt.date(2026, 9, 9), ep("edit", "warning"), "missed", None),
        # опубликованный — `published` и в будущем слоте
        (dt.date(2026, 9, 13), ep("publish", "published"), "published", None),
        # день слота, сценарий не готов — `failed`
        (
            TODAY,
            ep("script", "generating"),
            "today",
            SlotRisk(level="failed", reason="script_not_ready"),
        ),
        # через 2 дня (= risk_days), кадры идут — `warning`
        (
            dt.date(2026, 9, 13),
            ep("generate", "generating"),
            "filled",
            SlotRisk(level="warning", reason="shots_incomplete"),
        ),
        # экспорт упал — `failed` на любом расстоянии
        (
            dt.date(2026, 10, 1),
            ep("export", "failed"),
            "filled",
            SlotRisk(level="failed", reason="not_exported"),
        ),
        # экспорт идёт, слот близко — выпуск готов к слоту, риска нет
        (dt.date(2026, 9, 13), ep("export", "generating"), "filled", None),
        # стадия publish — риск публикации появится в M10
        (dt.date(2026, 9, 13), ep("publish", "failed"), "filled", None),
    ],
)
def test_state_and_risk_rules(
    day: dt.date, episode: SlotEpisode, state: str, risk: SlotRisk | None
) -> None:
    assert schedule.slot_state(day, TODAY, episode) == state
    assert schedule.slot_risk(SCHEDULE, day, TODAY, episode) == risk


# --- назначение ----------------------------------------------------------------------------------


def test_assign_rejects_date_off_schedule_with_nearest(seeded: TestClient) -> None:
    create(seeded, slot=None)
    response = seeded.put("/api/episodes/c01/slot", json={"date": "2026-09-12"})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["nearest"] == ["2026-09-09", "2026-09-11", "2026-09-13", "2026-09-15"]
    assert detail["message"] == (
        "12 сентября — не день публикации. Ближайшие слоты: 9 сентября, 11 сентября, "
        "13 сентября, 15 сентября."
    )


def test_assign_taken_slot_is_409_with_text(seeded: TestClient) -> None:
    create(seeded, title="Pirate Ship", slot="2026-09-23")
    create(seeded, slot=None)
    response = seeded.put("/api/episodes/c02/slot", json={"date": "2026-09-23"})
    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Слот 23 сентября занят выпуском «Pirate Ship» (c01); снимите его со слота или выберите "
        "другой."
    )


def test_assign_move_repeat_and_clear(seeded: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    created = create(seeded, slot=None)
    assert created["slot_date"] is None
    monkeypatch.setattr(slots_api, "now_iso", lambda: "2099-01-01T00:00:00+00:00")

    moved = seeded.put("/api/episodes/c01/slot", json={"date": "2026-09-15"})
    assert moved.status_code == 200, moved.text
    assert moved.json()["slot_date"] == "2026-09-15"
    assert moved.json()["updated_at"] == "2099-01-01T00:00:00+00:00"
    assert moved.json()["summary"]["shots_total"] == 0

    monkeypatch.setattr(slots_api, "now_iso", lambda: "2099-02-02T00:00:00+00:00")
    again = seeded.put("/api/episodes/c01/slot", json={"date": "2026-09-15"})
    assert again.status_code == 200
    assert again.json()["updated_at"] == "2099-01-01T00:00:00+00:00"  # повтор ничего не меняет

    # Перенос освобождает прежний слот: его может взять другой выпуск.
    assert seeded.put("/api/episodes/c01/slot", json={"date": "2026-09-17"}).status_code == 200
    create(seeded, slot="2026-09-15")

    cleared = seeded.put("/api/episodes/c01/slot", json={"date": None})
    assert cleared.status_code == 200
    assert cleared.json()["slot_date"] is None

    assert seeded.put("/api/episodes/nope/slot", json={"date": None}).status_code == 404
    assert seeded.put("/api/episodes/c01/slot", json={}).status_code == 422


# --- слот при создании ---------------------------------------------------------------------------


def test_create_takes_next_free_slot_after_today(seeded: TestClient) -> None:
    # Сегодняшний (11-е) свободен, но не берётся: новый выпуск в нём сразу в риске `failed`.
    assert create(seeded)["slot_date"] == "2026-09-13"
    assert create(seeded, slot="2026-09-17")["slot_date"] == "2026-09-17"
    assert create(seeded)["slot_date"] == "2026-09-15"
    assert create(seeded, channel="otto")["slot_date"] == "2026-09-19"  # полоса общая
    assert create(seeded, slot=None)["slot_date"] is None
    # Вручную сегодняшний назначается.
    assert create(seeded, slot="2026-09-11")["slot_date"] == "2026-09-11"


def test_create_with_bad_slot_leaves_nothing(seeded: TestClient, paths: StudioPaths) -> None:
    create(seeded, slot="2026-09-13")
    off = seeded.post("/api/episodes", json={"channel": "cursus", "slot": "2026-09-14"})
    assert off.status_code == 422
    taken = seeded.post("/api/episodes", json={"channel": "cursus", "slot": "2026-09-13"})
    assert taken.status_code == 409
    garbage = seeded.post("/api/episodes", json={"channel": "cursus", "slot": "soon"})
    assert [e["msg"] for e in garbage.json()["detail"]] == [
        "Слот «soon» не понят: пришлите next_free, дату ГГГГ-ММ-ДД или null."
    ]
    # Ни строки, ни каталога от отклонённых запросов.
    assert [e["id"] for e in seeded.get("/api/episodes").json()] == ["c01"]
    assert not paths.episode_dir("cursus", "c02").exists()


def test_parallel_creates_get_distinct_slots(
    seeded: TestClient, paths: StudioPaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Запись project.json замедлена — окно между выбором слота и вставкой перекрывается."""

    def write_slowly(path: Path, data: Any) -> None:
        time.sleep(0.2)
        write_json_atomic(path, data)

    monkeypatch.setattr(episodes_api, "write_json_atomic", write_slowly)
    barrier = threading.Barrier(2)
    errors: list[BaseException] = []

    def run() -> None:
        conn = connect(paths.db_path)
        try:
            barrier.wait()
            episodes_api.insert_episode(conn, paths, EpisodeCreate(channel="cursus"))
        except BaseException as exc:
            errors.append(exc)
        finally:
            conn.close()

    threads = [threading.Thread(target=run) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    slots = sorted(e["slot_date"] for e in seeded.get("/api/episodes").json())
    assert slots == ["2026-09-13", "2026-09-15"]


def test_db_refuses_two_episodes_in_one_slot(seeded: TestClient, paths: StudioPaths) -> None:
    """Страховка под проверкой API: уникальный индекс на `slot_date`."""
    create(seeded, slot="2026-09-13")
    create(seeded, slot=None)
    conn = connect(paths.db_path)
    try:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("UPDATE episodes SET slot_date = '2026-09-13' WHERE id = 'c02'")
    finally:
        conn.close()
