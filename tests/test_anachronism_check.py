"""M6.6: проверка анахронизмов — вопрос к VLM по миниатюре версии и `forbidden` эпохи кадра,
строгий разбор ответа, найденное только из списка (rapidfuzz), пометка `suspect`, деньги в цене
кадра и в журнале этапа `check`, кэш, выключатель в профиле канала, перепроверка.

Провайдер — фейковый (`FakeProvider.answers`), сеть не нужна. Окружение — `episode_env` с
включённой проверкой (по умолчанию там она выключена)."""

import asyncio
import json
import logging
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from app.cost import ledger
from app.cost.ledger import LedgerRow
from app.jobs.queue import Job
from app.jobs.worker import JobContext
from app.models.checks_config import load_checks_config
from app.pipeline.checks import anachronism
from app.pipeline.checks.anachronism import (
    AnachronismChecker,
    AnachronismOrder,
    AnswerError,
    match_forbidden,
    parse_answer,
)
from app.pipeline.checks.face import FaceChecker
from app.pipeline.checks.shot_check import ShotChecks
from app.pipeline.images.shot_job import ShotOrder, draw_shot, order_cost
from app.providers.base import (
    ImageRef,
    ImageRequest,
    ProviderError,
    VisionRequest,
    estimate_tokens,
)
from app.providers.gateway import CallContext, build_gateway
from app.settings import REPO_ROOT, Settings
from app.storage.db import connect
from app.storage.paths import StudioPaths
from episode_env import BASE, CANON, EPISODE, Env, make_env, set_anachronism, set_budgets

CONFIG = load_checks_config(REPO_ROOT / "config" / "checks.yaml")
FORBIDDEN: list[str] = json.loads((CANON / "period_caribbean_1716.json").read_text("utf-8"))[
    "forbidden"
]
PERIOD_REF = "periods/caribbean-1716/v001"
IMAGE_PRICE = 67_000  # фейковая картинка 1K — `tests/fixtures/config/pricing.yaml`


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    with make_env(tmp_path, anachronism=True) as env:
        yield env


@pytest.fixture
def off(tmp_path: Path) -> Iterator[Env]:
    with make_env(tmp_path) as env:
        yield env


@pytest.fixture
def idle(tmp_path: Path) -> Iterator[Env]:
    with make_env(tmp_path, workers=0, anachronism=True) as env:
        yield env


def rows(env: Env, stage: str) -> list[LedgerRow]:
    conn = connect(env.paths.db_path)
    try:
        return [r for r in ledger.list_rows(conn, channel="cursus") if r.stage == stage]
    finally:
        conn.close()


def vision_calls(env: Env) -> list[VisionRequest]:
    return [request for _, request in env.fake.calls if isinstance(request, VisionRequest)]


def anachronism_of(env: Env, shot_id: str, version: int = 1) -> dict[str, Any]:
    check: dict[str, Any] = env.project()["assets"][f"img-{shot_id}-v{version}"]["checks"][
        "anachronism"
    ]
    return check


def wait_until(predicate: Any, timeout: float = 10) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        assert time.monotonic() < deadline, "condition not met"
        time.sleep(0.02)


def episode_status(env: Env) -> str:
    status: str = env.get(f"/api/episodes/{EPISODE}")["status"]
    return status


class Captured(logging.Handler):
    """Журнал модуля в тесте: `create_app` пересобирает хендлеры и снимает caplog (L-017)."""

    def __init__(self) -> None:
        super().__init__(logging.WARNING)
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


# --- разбор ответа и сверка со списком ----------------------------------------------------------


def test_answer_is_exactly_one_found_object() -> None:
    assert parse_answer('  {"found": ["wristwatches", "plastic"]}\n') == ["wristwatches", "plastic"]
    assert parse_answer('{"found": []}') == []


@pytest.mark.parametrize(
    ("text", "reason"),
    [
        ('Sure! {"found": []}', "ответ не JSON"),
        ('```json\n{"found": []}\n```', "ответ не JSON"),
        ('{"found": []} and more', "ответ не JSON"),
        ('["wristwatches"]', 'ожидался объект {"found": [...]}'),
        ('{"items": ["plastic"]}', "ответ не по форме"),
        ('{"found": ["plastic"], "note": "x"}', "ответ не по форме"),
        ('{"found": "plastic"}', "ответ не по форме"),
        ('{"found": [1]}', "ответ не по форме"),
        ("", "ответ не JSON"),
    ],
)
def test_anything_else_is_not_parsed(text: str, reason: str) -> None:
    with pytest.raises(AnswerError, match=reason.replace("[", r"\[").replace("{", r"\{")):
        parse_answer(text)


def test_found_items_map_to_canon_wording_and_strangers_are_dropped() -> None:
    matched, dropped = match_forbidden(
        [
            "Wristwatch",
            "eyeglasses with metal frames",
            "smartphone",
            "plastic",
            "wristwatches",
            " ",
        ],
        FORBIDDEN,
        CONFIG.anachronism.match_score,
    )
    assert matched == ["wristwatches", "modern metal-framed eyeglasses", "plastic"]
    assert dropped == ["smartphone"]


# --- в джобе кадра -------------------------------------------------------------------------------


def test_found_forbidden_item_marks_version_suspect_with_canon_wording(env: Env) -> None:
    log = Captured()
    logging.getLogger("app.pipeline.checks.anachronism").addHandler(log)
    try:
        env.fake.answers = ['{"found": ["Wristwatch", "smartphone"]}']
        done = env.draw("s001")
    finally:
        logging.getLogger("app.pipeline.checks.anachronism").removeHandler(log)
    assert done["status"] == "done", done
    check = anachronism_of(env, "s001")
    usd = check.pop("usd_micro")
    check.pop("checked_at")
    assert check == {"status": "suspect", "found": ["wristwatches"], "period": PERIOD_REF}
    # Чужое — в журнал, не в пометку: модель не придумывает новые запреты.
    assert any("smartphone" in message for message in log.messages), log.messages
    # Пометка не блокирует: кадр готов, версия выбрана.
    state = env.shot("s001")
    assert (state["status"], state["image_version"]) == ("done", 1)

    # Вопрос — по миниатюре 320 этой версии и списку эпохи кадра.
    [request] = vision_calls(env)
    assert request.image.path.endswith(
        "projects/cursus/c09-canon-20/media/s001/thumbs/v001-320.webp"
    )
    assert all(f"- {item}" in request.prompt for item in FORBIDDEN)
    assert "Caribbean Sea: Bahamas, Jamaica and the Spanish Main, 1714 to 1718" in request.prompt
    assert request.response_schema == anachronism.RESPONSE_SCHEMA
    assert request.max_output_tokens == 256

    # Деньги: строки журнала этапа `check` с кадром и джобом; цена версии проверки — их сумма.
    charged = [r for r in rows(env, "check") if r.status == "charged"]
    assert {(r.unit, r.shot_id, r.job_id) for r in charged} == {
        ("token_in", "s001", done["id"]),
        ("token_out", "s001", done["id"]),
    }
    assert usd == sum(r.usd_micro for r in charged) > 0


def test_shot_price_includes_the_check_and_check_is_far_cheaper(env: Env) -> None:
    order = env.order("s002")
    assert order.check is not None
    assert (order.check.period, order.check.forbidden) == (PERIOD_REF, FORBIDDEN)
    check = anachronism.estimate(env.gateway, order.check)
    total = order_cost(env.gateway, order)
    assert total.usd_micro == IMAGE_PRICE + check.usd_micro
    assert [line.unit for line in total.lines] == ["image", "token_in", "token_out"]
    # Проверка дешевле кадра в десятки раз (у фейка картинка — 1120 токенов, сверху).
    assert 0 < check.usd_micro and check.usd_micro * 50 < IMAGE_PRICE
    job = env.generate("s002")
    assert (job["cost_usd_micro"], job["cost_stage"]) == (total.usd_micro, "images")
    # Смета пачки: цена кадра и сумма — с проверкой.
    estimate = env.get(f"{BASE}/generate/estimate?shots=s003,s004")
    assert estimate["unit"]["usd_micro"] == total.usd_micro
    assert estimate["total"]["usd_micro"] == 2 * total.usd_micro


def test_shipped_route_check_costs_under_a_tenth_of_a_cent(tmp_path: Path) -> None:
    """Настоящий маршрут `check` (config/providers.yaml, цена — pricing.yaml): картинка 280 токенов
    при `media_resolution: low`, оценка сверху меньше $0.001 (устав M6, решение 7) и в 70 раз
    меньше кадра nb2 1K."""
    settings = Settings(_env_file=None, studio_data_dir=tmp_path / "data")
    gateway = build_gateway(settings, StudioPaths(settings.studio_data_dir))
    order = AnachronismOrder(period=PERIOD_REF, setting="Caribbean Sea, 1716", forbidden=FORBIDDEN)
    cost = anachronism.estimate(gateway, order)
    assert (cost.provider, cost.model) == ("gemini", "gemini-3.5-flash-lite")
    token_in = next(line for line in cost.lines if line.unit == "token_in")
    request = anachronism.vision_request(gateway, order, ImageRef(path="x", sha256="0" * 64))
    assert (
        token_in.quantity
        == estimate_tokens(request.prompt + json.dumps(request.response_schema, sort_keys=True))
        + 280
    )
    image = gateway.estimate("images", ImageRequest(prompt="shot"))
    assert cost.usd_micro < 1_000 and cost.usd_micro * 70 < image.usd_micro


def test_unparsed_answer_fails_the_check_not_the_shot(env: Env) -> None:
    env.fake.answers = ['Here you go: {"found": ["wristwatches"]}']
    assert env.draw("s002")["status"] == "done"
    check = anachronism_of(env, "s002")
    assert (check["status"], check["found"]) == ("failed", [])
    assert check["reason"].startswith("Ответ проверки не разобран: ответ не JSON")
    assert env.shot("s002")["status"] == "done"


def test_provider_refusal_fails_the_check(env: Env) -> None:
    order = env.order("s002")
    assert order.check is not None
    image = env.paths.root / "projects" / "cursus" / EPISODE / "media" / "probe.png"
    image.parent.mkdir(parents=True, exist_ok=True)
    image.write_bytes(b"\x89PNG\r\n\x1a\nprobe")
    env.fake.errors = [ProviderError("Gemini: запрос отклонён (400): bad image")]
    result = asyncio.run(
        AnachronismChecker(CONFIG.anachronism).check(
            env.gateway,
            CallContext(stage="check", episode_id=EPISODE, shot_id="s002"),
            "cursus",
            order.check,
            image,
        )
    )
    assert (result.status, result.reason) == ("failed", "Gemini: запрос отклонён (400): bad image")
    assert [r.status for r in rows(env, "check")] == ["failed", "failed"]  # обе строки вызова, $0


def test_image_outside_the_episode_is_refused(env: Env) -> None:
    order = env.order("s002")
    assert order.check is not None
    stranger = env.paths.canon_dir("cursus") / "probe.png"
    stranger.write_bytes(b"\x89PNG\r\n\x1a\nprobe")
    result = asyncio.run(
        AnachronismChecker(CONFIG.anachronism).check(
            env.gateway,
            CallContext(stage="check", episode_id=EPISODE, shot_id="s002"),
            "cursus",
            order.check,
            stranger,
        )
    )
    assert result.status == "failed"
    assert result.reason is not None and "не из выпуска c09-canon-20" in result.reason
    assert vision_calls(env) == []


def test_switched_off_check_neither_calls_nor_marks(off: Env) -> None:
    assert off.order("s002").check is None
    assert off.draw("s002")["status"] == "done"
    check = anachronism_of(off, "s002")
    check.pop("checked_at")
    assert check == {"status": "off", "found": []}
    assert (vision_calls(off), rows(off, "check")) == ([], [])
    assert off.generate("s003")["cost_usd_micro"] == IMAGE_PRICE


def test_patch_profile_switches_the_check_and_keeps_seeds(env: Env) -> None:
    env.client.patch("/api/channels/cursus", json={"seeds": ["pirates"]})
    # Профиль, где проверки не меняли, поля не имеет — всё включено (L-033).
    assert "checks" not in env.get("/api/channels/otto")
    response = env.client.patch("/api/channels/cursus", json={"checks": {"anachronism": False}})
    assert response.status_code == 200, response.text
    assert (response.json()["checks"], response.json()["seeds"]) == (
        {"anachronism": False},
        ["pirates"],
    )
    assert env.draw("s002")["status"] == "done"
    assert anachronism_of(env, "s002")["status"] == "off"
    assert rows(env, "check") == []
    empty = env.client.patch("/api/channels/cursus", json={})
    assert empty.status_code == 422
    assert empty.json()["detail"][0]["msg"] == (
        "Править нечего — пришлите семена ниши (seeds) или проверки (checks)."
    )


def test_switching_off_after_enqueue_skips_the_call(idle: Env) -> None:
    job = idle.generate("s002")
    assert ShotOrder.model_validate(job["payload"]).check is not None
    set_anachronism(idle.paths, False)
    checks = ShotChecks(
        face=FaceChecker(CONFIG.face, idle.paths.models_dir),
        anachronism=AnachronismChecker(CONFIG.anachronism),
    )
    ctx = JobContext(
        Job.model_validate(job), idle.paths.db_path, lambda: None, threading.Event(), idle.gateway
    )
    asyncio.run(draw_shot(ctx, ShotOrder.model_validate(job["payload"]), checks))
    assert anachronism_of(idle, "s002")["status"] == "off"
    assert vision_calls(idle) == []


# --- перепроверка, кэш, статус выпуска ----------------------------------------------------------


def test_recheck_of_the_same_version_is_cached_for_free(env: Env) -> None:
    assert env.draw("s002")["status"] == "done"
    first = anachronism_of(env, "s002")
    job = env.post(f"{BASE}/shots/s002/check")
    assert job["cost_stage"] == "check" and job["cost_usd_micro"] > 0
    done = env.wait(job["id"])
    assert done["status"] == "done", done
    assert done["result"]["anachronism"] == "ok"
    again = anachronism_of(env, "s002")
    assert (again["status"], again["usd_micro"], first["usd_micro"] > 0) == ("ok", 0, True)
    assert len(vision_calls(env)) == 1  # второй раз — из кэша
    assert [r.status for r in rows(env, "check") if r.unit == "token_in"] == ["charged", "cached"]


def test_recheck_without_characters_checks_anachronisms_only(env: Env) -> None:
    assert env.draw("s001")["status"] == "done"
    assert "face" not in env.project()["assets"]["img-s001-v1"]["checks"]
    job = env.post(f"{BASE}/shots/s001/check")
    done = env.wait(job["id"])
    # Персонажей нет — только анахронизмы; та же картинка и тот же вопрос — ответ из кэша.
    assert done["result"] == {"shot_id": "s001", "version": 1, "face": None, "anachronism": "ok"}
    assert done["message"] == "Кадр s001 · версия 1 · анахронизмов не видно"


def test_recheck_refused_by_budget(env: Env) -> None:
    assert env.draw("s002")["status"] == "done"
    set_budgets(env.paths, per_episode_usd=0.05)  # уже потрачено больше
    response = env.client.post(f"{BASE}/shots/s002/check")
    assert response.status_code == 409, response.text
    order = env.order("s002")
    assert order.check is not None
    detail = response.json()["detail"]
    assert (detail["level"], detail["cost_usd_micro"]) == (
        "episode",
        anachronism.estimate(env.gateway, order.check).usd_micro,
    )
    assert {r.status for r in rows(env, "check")} == {"charged", "refused"}


def test_suspect_on_chosen_version_makes_episode_warning(env: Env) -> None:
    created = env.post(f"{BASE}/generate", {})
    wait_until(lambda: env.get(f"/api/batches/{created['batch']['id']}")["finished"])
    wait_until(lambda: episode_status(env) == "ready")
    assert all(anachronism_of(env, f"s{n:03d}")["status"] == "ok" for n in range(1, 21))

    # Новая версия s002 с подозрением; выбираем её — выпуск `warning`, стадия та же.
    env.fake.answers = ['{"found": ["rubber boots"]}']
    redraw = env.post(f"{BASE}/shots/s002/redraw", {})
    assert env.wait(redraw["id"])["status"] == "done"
    assert anachronism_of(env, "s002", 2)["found"] == ["rubber boots"]
    env.post(f"{BASE}/shots/s002/images/2/choose", None, 200)
    assert episode_status(env) == "warning"
    assert env.get(f"/api/episodes/{EPISODE}")["stage"] == "generate"
    env.post(f"{BASE}/shots/s002/images/1/choose", None, 200)
    assert episode_status(env) == "ready"


def test_recheck_with_check_switched_off_keeps_the_paid_mark(env: Env) -> None:
    env.fake.answers = ['{"found": ["plastic"]}']
    assert env.draw("s002")["status"] == "done"
    assert anachronism_of(env, "s002")["status"] == "suspect"
    set_anachronism(env.paths, False)
    done = env.wait(env.post(f"{BASE}/shots/s002/check")["id"])
    assert (done["status"], done["result"]["anachronism"]) == ("done", "off")
    # Выключатель не стирает оплаченную пометку: она остаётся, пока проверку не включат снова.
    assert anachronism_of(env, "s002")["found"] == ["plastic"]


# --- смета перепроверки (M6.10) ------------------------------------------------------------------


def test_check_estimate_prices_each_shot_like_the_check_job(env: Env) -> None:
    for shot in ("s001", "s002"):
        assert env.draw(shot)["status"] == "done"
    estimate = env.get(f"{BASE}/check/estimate?shots=s002,s001,s003,s099,s002")
    order = env.order("s002")
    assert order.check is not None
    question = anachronism.estimate(env.gateway, order.check).usd_micro
    assert (estimate["vlm"], estimate["question"]["usd_micro"]) == (True, question)
    priced = [(s["shot_id"], s["face"], s["usd"]["usd_micro"]) for s in estimate["shots"]]
    assert priced == [("s002", True, question), ("s001", False, question)]
    # Сумма — сумма цен заказов (L-053), не «первая × N»
    total = sum(s["usd"]["usd_micro"] for s in estimate["shots"])
    assert (estimate["count"], estimate["total"]["usd_micro"]) == (2, total)
    assert estimate["skipped"] == [
        {"shot_id": "s003", "reason": "У кадра s003 ещё нет картинок — сначала сгенерируйте кадр."},
        {"shot_id": "s099", "reason": "Кадра s099 нет в плане v001 — проверьте id кадра."},
    ]
    # Смета и оценка джоба — одна цена
    job = env.post(f"{BASE}/shots/s002/check")
    assert job["cost_usd_micro"] == question


def test_check_estimate_with_check_off_is_free_and_still_names_the_question(off: Env) -> None:
    for shot in ("s001", "s002"):
        assert off.draw(shot)["status"] == "done"
    estimate = off.get(f"{BASE}/check/estimate?shots=s001,s002")
    assert estimate["vlm"] is False
    assert estimate["question"] is not None and estimate["question"]["usd_micro"] > 0
    assert [(s["shot_id"], s["face"], s["usd"]["usd_micro"]) for s in estimate["shots"]] == [
        ("s002", True, 0)
    ]
    assert (estimate["count"], estimate["total"]["usd_micro"]) == (1, 0)
    assert estimate["skipped"] == [
        {
            "shot_id": "s001",
            "reason": "В кадре s001 нет персонажей, а проверка анахронизмов выключена в профиле"
            " канала — проверять нечего.",
        }
    ]
    # Без кадров — только цена вопроса для подписи выключателя; включение её не меняет
    bare = off.get(f"{BASE}/check/estimate")
    assert (bare["count"], bare["shots"], bare["question"]) == (0, [], estimate["question"])
    set_anachronism(off.paths, True)
    assert off.get(f"{BASE}/check/estimate")["question"] == estimate["question"]


def test_check_estimate_without_plan_is_404(env: Env) -> None:
    env.post("/api/episodes", {"id": "c10-no-plan", "channel": "cursus", "title": "No plan"})
    response = env.client.get("/api/projects/c10-no-plan/check/estimate?shots=s001")
    assert response.status_code == 404
    assert response.json()["detail"] == (
        "План ещё не импортирован — кадров нет. Импортируйте план на экране «Сценарий»."
    )
