"""M6.4: перерисовка и версии — следующий вариант (по версиям и незаконченным джобам), «Добавить
версию», «С правкой…» со стоп-листом, отказ фильтра и правка, выбор старой версии, цена до клика,
пачка `redraw`. Окружение — `episode_env.py`; провайдер фейковый."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from app.providers.base import ImageRequest, ProviderError
from episode_env import BASE, EPISODE, SAFETY, Env, make_env, run_handler, set_budgets

ACTION = "the boy drops the cartridge case and freezes, eyes on the open hatch"


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    with make_env(tmp_path, workers=1) as env:
        yield env


@pytest.fixture
def idle(tmp_path: Path) -> Iterator[Env]:
    """Очередь без исполнения: джобы стоят `queued`, обработчик запускает тест."""
    with make_env(tmp_path, workers=0) as env:
        yield env


def redraw(env: Env, shot_id: str, body: dict[str, Any] | None = None, status: int = 201) -> Any:
    return env.post(f"{BASE}/shots/{shot_id}/redraw", body or {}, status)


def versions(env: Env, shot_id: str) -> list[int]:
    return [v["version"] for v in env.get(f"{BASE}/shots/{shot_id}/images")["versions"]]


def jobs_count(env: Env) -> int:
    return len(env.get("/api/jobs?kind=shot_image")["items"])


def test_two_redraws_in_a_row_are_variants_2_and_3(idle: Env, draw: Any) -> None:
    draw(EPISODE, "s002")  # версия 1, вариант 1 — выбрана
    estimate = idle.get(f"{BASE}/shots/s002/redraw/estimate")
    assert estimate == {
        "shot_id": "s002",
        "variant": 2,
        "model": "small",
        "model_id": "fake-image-small",
        "usd": {"usd_micro": 67_000, "usd": "$0.067"},
    }
    first, second = redraw(idle, "s002"), redraw(idle, "s002")
    assert [first["payload"]["variant"], second["payload"]["variant"]] == [2, 3]
    assert first["payload"]["request"]["seed"] != second["payload"]["request"]["seed"]
    assert first["payload"]["input_hash"] != second["payload"]["input_hash"]
    assert idle.get(f"{BASE}/shots/s002/redraw/estimate")["variant"] == 4
    assert (idle.shot("s002")["status"], idle.shot("s002")["image_version"]) == ("queued", 1)

    for job in (first, second):
        assert run_handler(idle, job)["status"] == "charged"
    # Новые версии — в истории, выбранная не меняется: у готового кадра выбирает человек.
    assert versions(idle, "s002") == [3, 2, 1]
    state = idle.shot("s002")
    assert (state["status"], state["image_version"]) == ("done", 1)
    variants = [a["variant"] for a in idle.project()["assets"].values()]
    assert sorted(variants) == [1, 2, 3]


def test_redraw_of_a_shot_without_image_takes_the_new_version(idle: Env) -> None:
    job = redraw(idle, "s004")
    assert job["payload"]["variant"] == 1
    run_handler(idle, job)
    assert (idle.shot("s004")["status"], idle.shot("s004")["image_version"]) == ("done", 1)


def test_edit_with_style_token_is_422_and_nothing_is_written(idle: Env) -> None:
    before = idle.project()
    detail = redraw(idle, "s002", {"prompt": f"{ACTION}, cinematic lighting"}, 422)["detail"]
    assert [e["loc"] for e in detail] == [["shots", "s002", "user_override", "image", "prompt"]]
    assert "«cinematic lighting»" in detail[0]["msg"] and detail[0]["msg"].startswith("кадр s002")
    assert idle.project() == before
    assert jobs_count(idle) == 0


def test_empty_action_is_422(idle: Env) -> None:
    before = idle.project()
    detail = redraw(idle, "s002", {"prompt": "  "}, 422)["detail"]
    assert detail[0]["msg"].startswith("кадр s002:")
    assert idle.project() == before and jobs_count(idle) == 0


def test_budget_refusal_writes_no_edit(idle: Env) -> None:
    set_budgets(idle.paths, per_episode_usd=0.05)
    before = idle.project()
    refusal = redraw(idle, "s002", {"prompt": ACTION}, 409)["detail"]
    assert refusal["code"] == "budget_exceeded"
    assert idle.project() == before and jobs_count(idle) == 0


def test_edit_then_redraw_draws_the_new_action(env: Env) -> None:
    assert env.draw("s002")["status"] == "done"
    job = redraw(env, "s002", {"prompt": ACTION})
    assert ACTION in job["payload"]["request"]["prompt"] and job["payload"]["variant"] == 2
    assert env.wait(job["id"])["status"] == "done"
    sent = env.fake.calls[-1][1]
    assert isinstance(sent, ImageRequest) and f"Action: {ACTION}" in sent.prompt

    # Правка сделала картинку устаревшей — версия по новому действию выбралась сама (E-1).
    state = env.shot("s002")
    assert (state["status"], state["image_version"], state["stale_reasons"]) == ("done", 2, [])
    shot = next(s for s in env.get(f"{BASE}/plan")["shots"] if s["id"] == "s002")
    assert (shot["image"]["prompt"], shot["overridden"]) == (ACTION, ["image.prompt"])


def test_refusal_then_edit_clears_error_only_on_success(env: Env) -> None:
    env.fake.errors = [ProviderError(SAFETY)]
    assert env.draw("s002")["status"] == "failed"
    assert env.shot("s002")["error"] == SAFETY

    again = "Gemini не нарисовал картинку (IMAGE_PROHIBITED_CONTENT) — запрещённое содержание."
    env.fake.errors = [ProviderError(again)]
    failed = env.wait(redraw(env, "s002", {"prompt": ACTION})["id"])
    assert failed["status"] == "failed"
    assert (env.shot("s002")["status"], env.shot("s002")["error"]) == ("failed", again)

    done = env.wait(redraw(env, "s002", {"prompt": f"{ACTION}, then steps back"})["id"])
    assert done["status"] == "done"
    state = env.shot("s002")
    assert (state["status"], state["image_version"], "error" in state) == ("done", 1, False)


def test_choosing_an_old_version_keeps_the_new_one(env: Env) -> None:
    env.draw("s002")
    assert env.wait(redraw(env, "s002")["id"])["status"] == "done"
    assert env.wait(redraw(env, "s002")["id"])["status"] == "done"
    assert versions(env, "s002") == [3, 2, 1]
    assert env.shot("s002")["image_version"] == 1

    chosen = env.post(f"{BASE}/shots/s002/images/2/choose", None, 200)
    assert (chosen["image_version"], chosen["status"]) == (2, "done")
    env.post(f"{BASE}/shots/s002/images/1/choose", None, 200)
    assert env.shot("s002")["image_version"] == 1
    media = env.paths.shot_media_dir("cursus", EPISODE, "s002")
    assert sorted(p.name for p in media.iterdir() if p.is_file()) == [
        "v001.png",
        "v002.png",
        "v003.png",
    ]


def test_batch_redraw_counts_unfinished_variants(idle: Env, draw: Any) -> None:
    draw(EPISODE, "s002")
    redraw(idle, "s002")  # вариант 2 ждёт в очереди
    estimate = idle.get(f"{BASE}/generate/estimate?shots=s002,s004&redraw=true")
    assert [(s["shot_id"], s["variant"]) for s in estimate["shots"]] == [("s002", 3), ("s004", 1)]


def test_redraw_needs_an_approved_plan_and_a_shot_of_it(tmp_path: Path) -> None:
    with make_env(tmp_path, workers=0, approve=False) as env:
        assert redraw(env, "s002", None, 409)["detail"]["code"] == "plan_not_approved"
        env.post(f"/api/episodes/{EPISODE}/approve", None, 200)
        missing = redraw(env, "s999", {"prompt": ACTION}, 404)["detail"]
        assert missing == "Кадра s999 в действующем плане выпуска нет."
        assert env.client.get(f"{BASE}/shots/s999/redraw/estimate").status_code == 404
