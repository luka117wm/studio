"""M6.3: пачка кадров — выбор и пропуски, смета, бюджет суммой и гонка двух пачек, занятый кадр,
пауза (и после перезапуска), отмена, «Повторить упавшие», статус выпуска, события `batch.updated`,
новая версия плана снимает очередь. Окружение — `episode_env.py`; провайдер фейковый."""

import asyncio
import json
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.cost.budget import BudgetExceeded, committed_episode
from app.jobs import queue
from app.main import create_app
from app.models.director import Director
from app.models.project import Project
from app.pipeline.canon import anchors
from app.pipeline.images import batch
from app.providers.base import ProviderError
from app.storage.db import connect
from episode_env import (
    BASE,
    BOSUN,
    EPISODE,
    PLAN,
    SAFETY,
    Env,
    env_settings,
    make_env,
    run_handler,
    set_budgets,
)

SHOTS = [shot["id"] for shot in PLAN["shots"]]
WITH_BOSUN = [shot["id"] for shot in PLAN["shots"] if BOSUN in shot["image"]["appearances"]]
PRICE = 67_000  # маршрут `small` тестового конфига, 1K


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    with make_env(tmp_path, workers=3) as env:
        yield env


@pytest.fixture
def idle(tmp_path: Path) -> Iterator[Env]:
    """Очередь без исполнения: пачка стоит `queued`."""
    with make_env(tmp_path, workers=0) as env:
        yield env


def generate(env: Env, body: dict[str, Any] | None = None, status: int = 201) -> Any:
    return env.post(f"{BASE}/generate", body or {}, status)


def wait_batch(env: Env, batch_id: str, timeout: float = 15) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while True:
        summary: dict[str, Any] = env.get(f"/api/batches/{batch_id}")
        if summary["finished"]:
            return summary
        assert time.monotonic() < deadline, f"batch {batch_id} stuck: {summary}"
        time.sleep(0.02)


def episode_status(env: Env) -> str:
    status: str = env.get(f"/api/episodes/{EPISODE}")["status"]
    return status


def count(env: Env, sql: str, *params: Any) -> int:
    conn = connect(env.paths.db_path)
    try:
        return int(conn.execute(sql, params).fetchone()[0])
    finally:
        conn.close()


def slow_fake(env: Env, monkeypatch: pytest.MonkeyPatch, seconds: float) -> None:
    """Фейк отвечает не сразу: видно, что начатые доделываются, а очередь стоит."""
    real = env.fake.call

    async def slow(*args: Any) -> Any:
        await asyncio.sleep(seconds)
        return await real(*args)

    monkeypatch.setattr(env.fake, "call", slow)


def wait_until(predicate: Any, timeout: float = 10) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        assert time.monotonic() < deadline, "condition not met"
        time.sleep(0.02)


def statuses(env: Env, shot_ids: list[str]) -> list[str]:
    project = env.project()
    return [project["shots"][shot_id]["status"] for shot_id in shot_ids]


# --- выбор и смета -------------------------------------------------------------------------------


def test_estimate_takes_shots_without_image_and_stale_and_skips_problems(
    idle: Env, draw: Any
) -> None:
    draw(EPISODE, "s001")  # готов — в пачку не идёт
    draw(EPISODE, "s002")
    project = idle.project()
    project["shots"]["s002"].update({"status": "stale", "stale_reasons": ["Стиль канала"]})
    idle.write_project(project)
    (anchors.appearance_set(idle.paths, "cursus", BOSUN).root / "chosen.json").unlink()

    estimate = idle.get(f"{BASE}/generate/estimate")
    expected = [s for s in SHOTS if s != "s001" and s not in WITH_BOSUN]
    assert [s["shot_id"] for s in estimate["shots"]] == expected
    assert "s002" in expected and all(s["variant"] == 1 for s in estimate["shots"])
    assert estimate["count"] == len(expected)
    assert (estimate["model"], estimate["model_id"]) == ("small", "fake-image-small")
    assert estimate["unit"] == {"usd_micro": PRICE, "usd": "$0.067"}
    assert estimate["total"]["usd_micro"] == PRICE * len(expected)
    assert [s["shot_id"] for s in estimate["skipped"]] == WITH_BOSUN
    first = estimate["skipped"][0]
    assert first["reason"].startswith(f"Кадр {WITH_BOSUN[0]} нельзя рисовать: 1 проблема")
    assert first["problems"][0]["canon"] == {"kind": "appearance", "id": BOSUN, "issue": "no_sheet"}


def test_explicit_shots_redraw_and_model(idle: Env, draw: Any) -> None:
    draw(EPISODE, "s001")
    estimate = idle.get(f"{BASE}/generate/estimate?shots=s001,s004,s999&model=large&redraw=true")
    assert [(s["shot_id"], s["variant"]) for s in estimate["shots"]] == [("s001", 2), ("s004", 1)]
    assert estimate["unit"]["usd"] == "$0.134" and estimate["total"]["usd_micro"] == 268_000
    assert estimate["skipped"] == [
        {"shot_id": "s999", "reason": "кадра s999 нет в действующем плане", "problems": []}
    ]
    response = idle.client.post(f"{BASE}/generate", json={"model": "nope"})
    assert response.status_code == 422


def test_nothing_to_draw_and_unapproved_plan_are_409(tmp_path: Path, draw: Any) -> None:
    with make_env(tmp_path, workers=0, approve=False) as env:
        refusal = generate(env, status=409)["detail"]
        assert refusal["code"] == "plan_not_approved"
        env.post(f"/api/episodes/{EPISODE}/approve", None, 200)
        for shot_id in SHOTS:
            draw(EPISODE, shot_id)
        refusal = generate(env, status=409)["detail"]
        assert refusal["code"] == "nothing_to_draw"
        assert count(env, "SELECT COUNT(*) FROM batches") == 0


# --- деньги --------------------------------------------------------------------------------------


def test_batch_over_episode_budget_is_409_with_sum_and_no_jobs(idle: Env) -> None:
    set_budgets(idle.paths, per_episode_usd=1.0)  # 20 × $0.067 = $1.34
    refusal = generate(idle, status=409)["detail"]
    assert (refusal["code"], refusal["level"], refusal["cost_usd_micro"]) == (
        "budget_exceeded",
        "episode",
        20 * PRICE,
    )
    rows = idle.images_ledger()
    assert [(r.status, r.episode_id, r.quantity, r.usd_micro) for r in rows] == [
        ("refused", EPISODE, 20, 20 * PRICE)
    ]
    assert count(idle, "SELECT COUNT(*) FROM jobs") == 0
    assert count(idle, "SELECT COUNT(*) FROM batches") == 0
    assert set(statuses(idle, SHOTS)) == {"todo"}
    assert episode_status(idle) == "queued"


def test_two_batches_race_for_the_budget(idle: Env) -> None:
    """Каждая пачка по отдельности влезает, обе — нет: проходит ровно одна (L-021)."""
    set_budgets(idle.paths, per_episode_usd=1.0)
    halves = [SHOTS[:10], SHOTS[10:]]  # по 10 × $0.067 = $0.67
    barrier = threading.Barrier(2)
    outcomes: list[str] = []

    def run(shots: list[str]) -> None:
        conn = connect(idle.paths.db_path)
        try:
            project = Project.model_validate(idle.project())
            director = Director.model_validate(
                json.loads(
                    idle.paths.director_version_path("cursus", EPISODE, 1).read_text("utf-8")
                )
            )
            selection = batch.select_shots(
                conn,
                idle.paths,
                idle.gateway,
                idle.config,
                channel="cursus",
                project=project,
                director=director,
                shots=shots,
            )
            barrier.wait()
            batch.create_batch(
                conn,
                idle.paths,
                idle.gateway,
                selection,
                episode_id=EPISODE,
                channel="cursus",
                parallel=3,
            )
            outcomes.append("created")
        except BudgetExceeded:
            outcomes.append("refused")
        finally:
            conn.close()

    threads = [threading.Thread(target=run, args=(half,)) for half in halves]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(outcomes) == ["created", "refused"]
    assert count(idle, "SELECT COUNT(*) FROM batches") == 1
    assert count(idle, "SELECT COUNT(*) FROM jobs") == 10


def test_shot_in_unfinished_batch_is_409_with_batch_id(idle: Env) -> None:
    first = generate(idle, {"shots": ["s001", "s002"]})["batch"]
    refusal = generate(idle, {"shots": ["s002", "s003"]}, status=409)["detail"]
    assert refusal == {
        "code": "shots_busy",
        "message": f"Кадр s002 уже рисуется в пачке {first['id']} — дождитесь окончания или"
        " отмените.",
        "skipped": [],
        "shots": ["s002"],
        "batch_id": first["id"],
    }
    # Одиночный джоб кадра (M6.2) видит кадр пачки занятым, и наоборот.
    assert idle.generate("s001", status=409)["detail"]["code"] == "shot_busy"
    single = idle.generate("s005")
    refusal = generate(idle, {"shots": ["s005"]}, status=409)["detail"]
    assert refusal["batch_id"] is None and single["id"] in refusal["message"]


# --- пачка целиком -------------------------------------------------------------------------------


def test_whole_episode_is_one_batch_and_becomes_ready(env: Env) -> None:
    created = generate(env)
    summary = created["batch"]
    assert (summary["jobs"]["total"], summary["model"], summary["paused"]) == (20, "small", False)
    assert summary["estimate"]["usd_micro"] == 20 * PRICE
    assert created["skipped"] == [] and created["warnings"] == []

    done = wait_batch(env, summary["id"])
    assert done["jobs"] == {
        "total": 20,
        "queued": 0,
        "running": 0,
        "done": 20,
        "failed": 0,
        "cancelled": 0,
    }
    assert done["spent"]["usd_micro"] == 20 * PRICE and done["eta_s"] is None
    wait_until(lambda: episode_status(env) == "ready")
    project = env.project()
    assert all(project["shots"][s]["image_version"] == 1 for s in SHOTS)
    assert len(env.fake.calls) == 20
    # Сводка шла в поток SSE по каждому переходу; последняя — пачка закончена.
    conn = connect(env.paths.db_path)
    try:
        rows = conn.execute(
            "SELECT data FROM job_events WHERE type = 'batch.updated' ORDER BY id"
        ).fetchall()
    finally:
        conn.close()
    assert len(rows) >= 1 + 2 * 20  # постановка, старт и конец каждого джоба
    last = json.loads(rows[-1]["data"])
    assert (last["id"], last["finished"], last["jobs"]["done"]) == (summary["id"], True, 20)


def test_episode_is_generating_while_batch_waits(idle: Env) -> None:
    generate(idle, {"shots": ["s001"]})
    assert episode_status(idle) == "generating"
    assert statuses(idle, ["s001", "s002"]) == ["queued", "todo"]


def test_one_refusal_fails_its_shot_others_finish_and_episode_is_warning(env: Env) -> None:
    env.fake.errors = [ProviderError(SAFETY)]
    summary = wait_batch(env, generate(env)["batch"]["id"])
    assert (summary["jobs"]["done"], summary["jobs"]["failed"]) == (19, 1)
    wait_until(lambda: episode_status(env) == "warning")
    failed = [s for s in SHOTS if env.shot(s)["status"] == "failed"]
    assert len(failed) == 1 and env.shot(failed[0])["error"] == SAFETY

    # Без правки отказ повторится — «Повторить упавшие» его не ставит и говорит почему.
    retry = env.post(f"/api/batches/{summary['id']}/retry-failed", {}, 409)["detail"]
    assert retry["code"] == "nothing_to_draw"
    assert retry["message"].startswith(f"Не повторены {failed[0]}: модель отказала")
    # Явно — повторяется.
    again = env.post(f"/api/batches/{summary['id']}/retry-failed", {"shots": failed})
    assert again["batch"]["retry_of"] == summary["id"] and again["batch"]["jobs"]["total"] == 1
    wait_batch(env, again["batch"]["id"])
    wait_until(lambda: episode_status(env) == "ready")
    assert env.shot(failed[0])["status"] == "done"


def test_retry_failed_takes_edited_shots_with_the_same_variant_and_model(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    env.fake.errors = [ProviderError(SAFETY)]
    summary = wait_batch(env, generate(env, {"shots": ["s004"], "model": "large"})["batch"]["id"])
    assert summary["jobs"]["failed"] == 1
    # «С правкой…»: действие кадра поправлено — запрос другой, повтор без явного списка.
    edit = env.client.patch(
        f"/api/projects/{EPISODE}",
        json={"shots": {"s004": {"user_override": {"image": {"prompt": "a coiled rope on deck"}}}}},
    )
    assert edit.status_code == 200, edit.text
    again = env.post(f"/api/batches/{summary['id']}/retry-failed", {})
    assert (again["batch"]["model"], again["warnings"]) == ("large", [])
    wait_batch(env, again["batch"]["id"])
    asset = env.project()["assets"]["img-s004-v1"]
    assert (asset["model"], asset["variant"]) == ("large", 1)


# --- пауза и отмена ------------------------------------------------------------------------------


def test_pause_holds_queue_survives_restart_and_resume_finishes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    shots = SHOTS[:5]
    with make_env(tmp_path, workers=2, images_parallel=1) as env:
        slow_fake(env, monkeypatch, 0.3)
        batch_id = generate(env, {"shots": shots})["batch"]["id"]
        wait_until(lambda: env.get(f"/api/batches/{batch_id}")["jobs"]["running"] == 1)
        paused = env.post(f"/api/batches/{batch_id}/pause", None, 200)
        assert paused["paused"] is True
        # Начатый доходит до `done`, новые не стартуют.
        wait_until(lambda: env.get(f"/api/batches/{batch_id}")["jobs"]["done"] == 1)
        time.sleep(0.5)
        held = env.get(f"/api/batches/{batch_id}")
        assert (held["jobs"]["done"], held["jobs"]["queued"], held["jobs"]["running"]) == (1, 4, 0)
        assert held["eta_s"] is None  # на паузе ждать нечего
        assert episode_status(env) == "generating"

    # Перезапуск бэкенда: пауза на месте.
    settings = env_settings(tmp_path, workers=2, images_parallel=1)
    with TestClient(create_app(settings)) as client:
        time.sleep(1.2)  # опрос очереди — раз в секунду
        state = client.get(f"/api/batches/{batch_id}").json()
        assert (state["paused"], state["jobs"]["queued"]) == (True, 4)
        assert client.post(f"/api/batches/{batch_id}/resume").json()["paused"] is False
        deadline = time.monotonic() + 10
        while not client.get(f"/api/batches/{batch_id}").json()["finished"]:
            assert time.monotonic() < deadline
            time.sleep(0.05)
        assert client.get(f"/api/batches/{batch_id}").json()["jobs"]["done"] == 5


def test_cancel_drops_queue_finishes_started_and_frees_budget(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with make_env(tmp_path, workers=1) as env:
        slow_fake(env, monkeypatch, 0.3)
        shots = SHOTS[:5]
        batch_id = generate(env, {"shots": shots})["batch"]["id"]
        wait_until(lambda: env.get(f"/api/batches/{batch_id}")["jobs"]["running"] == 1)
        cancelled = env.post(f"/api/batches/{batch_id}/cancel", None, 200)
        assert cancelled["cancelled"] is True
        assert (cancelled["jobs"]["cancelled"], cancelled["jobs"]["running"]) == (4, 1)
        summary = wait_batch(env, batch_id)
        assert (summary["jobs"]["done"], summary["jobs"]["cancelled"]) == (1, 4)
        # Отменённые остаются в истории; их кадры — к своему статусу; бюджет свободен.
        assert len(env.get(f"/api/jobs?batch={batch_id}")["items"]) == 5
        assert sorted(statuses(env, shots)) == ["done", "todo", "todo", "todo", "todo"]
        conn = connect(env.paths.db_path)
        try:
            assert committed_episode(conn, EPISODE).queued == 0
        finally:
            conn.close()
        wait_until(lambda: episode_status(env) == "warning")


def test_new_plan_version_cancels_queued_shot_jobs(idle: Env) -> None:
    batch_id = generate(idle, {"shots": ["s001", "s002"]})["batch"]["id"]
    changed = json.loads(json.dumps(PLAN))
    changed["shots"][0]["vo"] += " Again."
    idle.post(f"{BASE}/director", changed, 200)
    summary = idle.get(f"/api/batches/{batch_id}")
    assert (summary["cancelled"], summary["jobs"]["cancelled"]) == (True, 2)
    assert statuses(idle, ["s001", "s002"]) == ["todo", "todo"]
    episode = idle.get(f"/api/episodes/{EPISODE}")
    assert (episode["stage"], episode["status"]) == ("script", "queued")


def test_version_drawn_by_the_previous_plan_is_not_chosen(idle: Env) -> None:
    """Джоб, начатый до новой версии плана, дорисовывает — но версия сама не выбирается."""
    idle.generate("s002")
    conn = connect(idle.paths.db_path)
    try:
        running = queue.claim(conn)  # джоб уже рисует: его импорт не отменяет
    finally:
        conn.close()
    assert running is not None
    changed = json.loads(json.dumps(PLAN))
    changed["shots"][0]["vo"] += " Again."
    idle.post(f"{BASE}/director", changed, 200)
    result = run_handler(idle, running.model_dump(mode="json"))
    assert result["status"] == "charged"
    state = idle.shot("s002")
    assert (state["status"], "image_version" in state) == ("todo", False)
    assert list(idle.project()["assets"]) == ["img-s002-v1"]


# --- правка кадра и версия по действующему запросу (M6.11) ---------------------------------------

ACTION = {"user_override": {"image": {"prompt": "drops the cartridge case and stares"}}}


def test_action_edit_cancels_queued_order_of_that_shot_only(idle: Env) -> None:
    """Заказ в очереди рисовал бы прежний промпт: правка действия его снимает, пачка идёт дальше;
    правка VO заказ не трогает — картинка от VO не зависит."""
    batch_id = generate(idle, {"shots": ["s001", "s002", "s003"]})["batch"]["id"]
    vo = {"user_override": {"vo": "Another line of voice."}}
    response = idle.client.patch(BASE, json={"shots": {"s001": ACTION, "s003": vo}})
    assert response.status_code == 200, response.text

    summary = idle.get(f"/api/batches/{batch_id}")
    assert (summary["cancelled"], summary["jobs"]["cancelled"], summary["jobs"]["queued"]) == (
        False,
        1,
        2,
    )
    assert statuses(idle, ["s001", "s002", "s003"]) == ["todo", "queued", "queued"]
    assert episode_status(idle) == "generating"


def test_version_drawn_by_the_previous_prompt_is_not_chosen(idle: Env) -> None:
    """Джоб, начатый до правки действия, дорисовывает — но версия сама не выбирается: она по
    прежнему промпту (обобщение D-1, `current.drawn_by_current`). Без правки — выбирается."""
    idle.generate("s002")
    idle.generate("s003")
    conn = connect(idle.paths.db_path)
    try:
        first, second = queue.claim(conn), queue.claim(conn)  # оба уже рисуют
    finally:
        conn.close()
    assert first is not None and second is not None
    assert idle.client.patch(BASE, json={"shots": {"s002": ACTION}}).status_code == 200

    assert run_handler(idle, first.model_dump(mode="json"))["status"] == "charged"
    state = idle.shot("s002")
    assert (state["status"], "image_version" in state) == ("todo", False)
    assert "img-s002-v1" in idle.project()["assets"]
    assert idle.get(f"{BASE}/shots/s002/images")["matches_plan"] == []

    assert run_handler(idle, second.model_dump(mode="json"))["status"] == "charged"
    assert (idle.shot("s003")["status"], idle.shot("s003")["image_version"]) == ("done", 1)
    assert idle.get(f"{BASE}/shots/s003/images")["matches_plan"] == [1]


def test_redraw_with_edit_cancels_queued_order_by_the_old_prompt(idle: Env) -> None:
    queued = idle.generate("s004")
    job = idle.post(f"{BASE}/shots/s004/redraw", {"prompt": "climbs the rigging at dusk"})
    assert idle.get(f"/api/jobs/{queued['id']}")["status"] == "cancelled"
    assert idle.get(f"/api/jobs/{job['id']}")["status"] == "queued"
    assert job["payload"]["variant"] == 2
    assert idle.shot("s004")["status"] == "queued"


def test_matches_plan_follows_edits_of_the_action(env: Env) -> None:
    env.draw("s001")
    assert env.get(f"{BASE}/shots/s001/images")["matches_plan"] == [1]
    assert env.client.patch(BASE, json={"shots": {"s001": ACTION}}).status_code == 200
    assert env.get(f"{BASE}/shots/s001/images")["matches_plan"] == []
    back = {"user_override": {"image": {"prompt": None}}}
    assert env.client.patch(BASE, json={"shots": {"s001": back}}).status_code == 200
    # Версия снова по действующему запросу, но кадр `stale` до выбора человеком: правку
    # туда-обратно не угадываем.
    assert env.get(f"{BASE}/shots/s001/images")["matches_plan"] == [1]
    assert env.shot("s001")["status"] == "stale"


def test_unknown_batch_is_404(idle: Env) -> None:
    for method, url in (
        ("GET", "/api/batches/nope"),
        ("POST", "/api/batches/nope/pause"),
        ("POST", "/api/batches/nope/cancel"),
        ("POST", "/api/batches/nope/retry-failed"),
    ):
        response = idle.client.request(method, url, json={} if method == "POST" else None)
        assert response.status_code == 404, (url, response.text)
        assert response.json()["detail"] == "Пачка «nope» не найдена."
