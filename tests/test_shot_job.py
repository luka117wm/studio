"""M6.2: джоб кадра `shot_image` — заказ при постановке, вариант и хэш как у предпросмотра, шлюз,
версия кадра, кэш с привязкой (L-042), отказы модели и бюджета, отмена, каталог моделей.

Канон и листы кладутся на диск кодом M5.1/M5.4, план импортируется и утверждается через API;
провайдер — фейковый, сеть не нужна."""

import json
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.cost.budget import BudgetExceeded
from app.jobs.worker import TransientError
from app.main import create_app
from app.pipeline.canon import anchors
from app.providers.base import ProviderError
from app.settings import Settings
from episode_env import (
    BASE,
    BOSUN,
    EPISODE,
    PLAN,
    SAFETY,
    Env,
    make_env,
    run_handler,
    set_budgets,
)


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    with make_env(tmp_path) as env:
        yield env


@pytest.fixture
def idle(tmp_path: Path) -> Iterator[Env]:
    """Очередь без исполнения: джоб стоит `queued`, пока тест сам не запустит обработчик."""
    with make_env(tmp_path, workers=0) as env:
        yield env


# --- заказ ---------------------------------------------------------------------------------------


def test_variant_one_hash_is_the_preview_hash_and_variant_two_changes_seed(env: Env) -> None:
    preview = env.get(f"{BASE}/shots/s002/prompt")
    first = env.order("s002")
    assert (first.input_hash, first.request.seed) == (preview["input_hash"], preview["seed"])
    assert (first.variant, first.model, first.model_id) == (1, "small", "fake-image-small")
    assert first.request.prompt == preview["text"]

    second = env.order("s002", variant=2)
    assert second.request.seed != first.request.seed
    assert second.input_hash != first.input_hash
    # Вариант меняет только seed: промпт, negative и референсы те же.
    same = first.request.model_dump(exclude={"seed"})
    assert second.request.model_dump(exclude={"seed"}) == same

    large = env.order("s002", model="large")
    assert (large.model, large.model_id) == ("large", "fake-image-large")
    assert large.request == first.request and large.input_hash != first.input_hash


def test_unknown_model_is_422_and_shot_outside_plan_is_404(env: Env) -> None:
    response = env.client.post(f"{BASE}/shots/s002/generate", json={"model": "nope"})
    assert response.status_code == 422
    assert response.json()["detail"].startswith(
        "Модели «nope» нет в каталоге этапа «images». Доступны: small (fake-image-small),"
        " large (fake-image-large)."
    )
    missing = env.generate("s999", status=404)
    assert missing["detail"] == "Кадра s999 в действующем плане выпуска нет."
    assert env.get("/api/jobs?kind=shot_image")["items"] == []


def test_plan_not_approved_is_409(tmp_path: Path) -> None:
    with make_env(tmp_path, approve=False) as env:
        refusal = env.generate("s002", status=409)["detail"]
        assert refusal == {
            "code": "plan_not_approved",
            "message": "План не утверждён — утвердите его на экране «Сценарий»: кадры рисуются"
            " только по утверждённому плану.",
            "problems": [],
            "job_id": None,
        }
        env.post(f"/api/episodes/{EPISODE}/approve", None, 200)
        changed = json.loads(json.dumps(PLAN))
        changed["shots"][1]["image"]["prompt"] += " with a lantern"
        env.post(f"{BASE}/director", changed, 200)
        refusal = env.generate("s002", status=409)["detail"]
        assert refusal["message"] == (
            "Утверждена версия v001, а текущая — v002: утвердите план снова на экране «Сценарий»."
        )
        assert env.get("/api/jobs?kind=shot_image")["items"] == []
        assert env.shot("s002")["status"] == "todo"


def test_canon_problem_is_409_with_targets_and_no_job(env: Env) -> None:
    # Лист боцмана пропал после утверждения: рисовать кадр с ним нельзя.
    (anchors.appearance_set(env.paths, "cursus", BOSUN).root / "chosen.json").unlink()
    refusal = env.generate("s006", status=409)["detail"]
    assert refusal["code"] == "shot_problems"
    assert (
        refusal["message"] == "Кадр s006 нельзя рисовать: 1 проблема — исправьте и поставьте снова."
    )
    assert refusal["problems"] == [
        {
            "message": f"кадр s006: у облика {BOSUN} нет листа опорных портретов — соберите его на"
            " экране «Канон»",
            "canon": {"kind": "appearance", "id": BOSUN, "issue": "no_sheet"},
        }
    ]
    assert env.get("/api/jobs?kind=shot_image")["items"] == []
    assert env.fake.calls == []


# --- джоб ----------------------------------------------------------------------------------------


def test_generate_draws_a_version_with_ledger_row(env: Env) -> None:
    preview = env.get(f"{BASE}/shots/s002/prompt")
    job = env.generate("s002")
    assert (job["kind"], job["episode_id"], job["cost_stage"], job["cost_usd_micro"]) == (
        "shot_image",
        EPISODE,
        "images",
        67_000,
    )
    done = env.wait(job["id"])
    assert done["status"] == "done", done
    assert done["result"] == {
        "shot_id": "s002",
        "version": 1,
        "status": "charged",
        "usd_micro": 67_000,
    }
    assert done["message"] == "Кадр s002 · готово: версия 1"

    state = env.shot("s002")
    assert (state["status"], state["image_version"], "error" in state) == ("done", 1, False)
    asset = env.project()["assets"]["img-s002-v1"]
    asset.pop("created_at")
    face = asset.pop("checks")["face"]  # весов в тестах нет — проверка лица пропущена (M6.5)
    assert asset == {
        "id": "img-s002-v1",
        "shot_id": "s002",
        "kind": "image",
        "version": 1,
        "path": "media/s002/v001.png",
        "hash": preview["input_hash"],
        "status": "ok",
        "model": "small",
        "model_id": "fake-image-small",
        "seed": preview["seed"],
        "variant": 1,
        "usd_micro": 67_000,
        "cached": False,
    }
    assert (face["status"], [a["id"] for a in face["appearances"]]) == (
        "skipped",
        ["you@powder-monkey-11"],
    )
    assert "fetch_models" in face["reason"]
    # Версия — та же картинка, что положил шлюз, без второй копии на диске.
    version = env.paths.shot_image_path("cursus", EPISODE, "s002", 1, "png")
    gateway_file = env.paths.media_dir("cursus", EPISODE) / "images"
    (stored,) = gateway_file.iterdir()
    assert os.stat(version).st_ino == os.stat(stored).st_ino
    assert sorted(
        p.name for p in env.paths.shot_thumbs_dir("cursus", EPISODE, "s002").iterdir()
    ) == [
        "v001-160.webp",
        "v001-320.webp",
    ]
    assert [
        (r.status, r.episode_id, r.shot_id, r.job_id, r.usd_micro) for r in env.images_ledger()
    ] == [("charged", EPISODE, "s002", job["id"], 67_000)]
    assert len(env.fake.calls) == 1


def test_same_order_again_is_neither_paid_nor_a_new_version(env: Env) -> None:
    env.draw("s002")
    again = env.draw("s002")
    assert again["result"] == {"shot_id": "s002", "version": 1, "status": "exists", "usd_micro": 0}
    assert again["message"] == "Кадр s002 · версия 1 уже нарисована"
    assert list(env.project()["assets"]) == ["img-s002-v1"]
    assert len(env.fake.calls) == 1
    assert [r.status for r in env.images_ledger()] == ["charged"]


def test_hash_in_cache_becomes_a_new_version_of_the_shot(env: Env) -> None:
    """L-042: строка `assets` кадра потеряна, файл шлюза на месте — шлюз отдаёт `cached`, и ассет
    становится новой версией кадра, как оплаченный."""
    env.draw("s002")
    project = env.project()
    del project["assets"]["img-s002-v1"]
    del project["shots"]["s002"]["image_version"]
    project["shots"]["s002"]["status"] = "todo"
    env.write_project(project)

    again = env.draw("s002")
    assert again["result"] == {"shot_id": "s002", "version": 2, "status": "cached", "usd_micro": 0}
    asset = env.project()["assets"]["img-s002-v2"]
    assert (asset["cached"], asset["usd_micro"], asset["path"]) == (True, 0, "media/s002/v002.png")
    assert (env.shot("s002")["status"], env.shot("s002")["image_version"]) == ("done", 2)
    assert len(env.fake.calls) == 1
    assert [(r.status, r.usd_micro) for r in env.images_ledger()] == [
        ("charged", 67_000),
        ("cached", 0),
    ]


def test_model_choice_is_remembered_by_the_version(env: Env) -> None:
    job = env.generate("s004", model="large")
    assert job["cost_usd_micro"] == 134_000
    assert env.wait(job["id"])["status"] == "done"
    asset = env.project()["assets"]["img-s004-v1"]
    assert (asset["model"], asset["model_id"], asset["usd_micro"]) == (
        "large",
        "fake-image-large",
        134_000,
    )


def test_safety_refusal_fails_the_shot_once_without_retry(env: Env) -> None:
    env.fake.errors = [ProviderError(SAFETY)]
    failed = env.draw("s002")
    assert (failed["status"], failed["attempts"]) == ("failed", 1)
    assert failed["error"] == f"ProviderError: {SAFETY}"
    assert len(env.fake.calls) == 1
    state = env.shot("s002")
    assert (state["status"], state["error"], "image_version" in state) == ("failed", SAFETY, False)
    assert env.project()["assets"] == {}
    assert [(r.status, r.usd_micro) for r in env.images_ledger()] == [("failed", 0)]

    # После правки (здесь — просто без отказа) новая версия снимает причину.
    assert env.draw("s002")["status"] == "done"
    state = env.shot("s002")
    assert (state["status"], state["image_version"], "error" in state) == ("done", 1, False)


def test_network_error_is_retried_by_the_queue(env: Env) -> None:
    env.fake.errors = [TransientError("Gemini: нет соединения (ConnectError)")]
    done = env.draw("s002")
    assert (done["status"], done["attempts"], done["result"]["status"]) == ("done", 2, "charged")
    assert len(env.fake.calls) == 2
    assert (env.shot("s002")["status"], "error" in env.shot("s002")) == ("done", False)


def test_budget_is_checked_before_the_queue(env: Env) -> None:
    set_budgets(env.paths, per_episode_usd=0.05)
    refusal = env.generate("s002", status=409)["detail"]
    assert (refusal["code"], refusal["level"], refusal["cost_usd_micro"]) == (
        "budget_exceeded",
        "episode",
        67_000,
    )
    assert env.get("/api/jobs?kind=shot_image")["items"] == []
    assert env.shot("s002")["status"] == "todo"
    assert env.fake.calls == []


def test_budget_at_call_time_fails_the_shot(idle: Env) -> None:
    job = idle.generate("s002")
    assert idle.shot("s002")["status"] == "queued"
    set_budgets(idle.paths, per_episode_usd=0.05)  # лимит заняли, пока джоб ждал
    with pytest.raises(BudgetExceeded) as caught:
        run_handler(idle, job)
    state = idle.shot("s002")
    assert (state["status"], state["error"]) == ("failed", str(caught.value))
    assert idle.fake.calls == []


def test_busy_shot_is_409_and_cancel_returns_its_status(idle: Env) -> None:
    job = idle.generate("s002")
    busy = idle.generate("s002", status=409)["detail"]
    assert busy == {
        "code": "shot_busy",
        "message": f"Кадр s002 уже рисуется (джоб {job['id']}) — дождитесь окончания или"
        " отмените его.",
        "problems": [],
        "job_id": job["id"],
    }
    assert idle.shot("s002")["status"] == "queued"
    cancelled = idle.post(f"/api/jobs/{job['id']}/cancel", None, 200)
    assert cancelled["status"] == "cancelled"
    assert idle.shot("s002")["status"] == "todo"
    # Отменённый джоб кадр больше не держит.
    assert idle.generate("s002")["status"] == "queued"


def test_handler_marks_the_shot_generating_while_it_draws(
    idle: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    job = idle.generate("s002")
    seen: list[str] = []
    real_call = idle.fake.call

    async def watching(*args: Any) -> Any:
        seen.append(idle.shot("s002")["status"])
        return await real_call(*args)

    monkeypatch.setattr(idle.fake, "call", watching)
    result = run_handler(idle, job)
    assert seen == ["generating"]
    assert result == {"shot_id": "s002", "version": 1, "status": "charged", "usd_micro": 67_000}
    assert idle.shot("s002")["status"] == "done"


# --- каталог -------------------------------------------------------------------------------------


def test_catalog_lists_models_with_labels_prices_and_default(env: Env) -> None:
    assert env.get("/api/providers/catalog/images") == {
        "stage": "images",
        "kind": "image",
        "default": "small",
        "models": [
            {
                "key": "small",
                "label": "Fake Small",
                "model": "fake-image-small",
                "unit": "image",
                "price": {"usd_micro": 67_000, "usd": "$0.067"},
            },
            {
                "key": "large",
                "label": "large",  # подписи нет — ключ
                "model": "fake-image-large",
                "unit": "image",
                "price": {"usd_micro": 134_000, "usd": "$0.134"},
            },
        ],
    }
    missing = env.client.get("/api/providers/catalog/nope")
    assert missing.status_code == 404
    assert missing.json()["detail"].startswith("Этапа «nope» нет в config/providers.yaml.")


def test_shipped_images_catalog_has_labels_and_prices(tmp_path: Path) -> None:
    settings = Settings(_env_file=None, studio_data_dir=tmp_path / "data")  # настоящие config/
    with TestClient(create_app(settings)) as client:
        catalog = client.get("/api/providers/catalog/images").json()
    assert catalog["default"] == "nb2"
    assert [(m["key"], m["label"], m["price"]["usd"]) for m in catalog["models"]] == [
        ("nb2-lite", "Nano Banana 2 Lite", "$0.034"),
        ("nb2", "Nano Banana 2", "$0.067"),
        ("nb2-2k", "Nano Banana 2 · 2K", "$0.101"),
        ("nb-pro", "Nano Banana Pro", "$0.134"),
    ]
