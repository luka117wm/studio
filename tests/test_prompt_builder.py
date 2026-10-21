"""M5.5: сборщик запроса картинки кадра — детерминизм на 20 кадрах, порядок секций и источники,
negative, референсы по крупности и лимит модели, хэш входов, проблемы с id кадра, предпросмотр.
Канон и листы кладутся на диск кодом M5.1/M5.4; провайдер — фейковый, сеть не нужна."""

import hashlib
import json
import shutil
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

from app.main import create_app
from app.models.canon import Character, Period, Style
from app.models.canon_config import ANGLES, CanonConfig, load_canon_config
from app.models.director import CanonRef, Director, Shot
from app.models.validators import validate_director
from app.pipeline.canon import anchors
from app.pipeline.canon.anchors import CandidateRecord
from app.pipeline.director_import.effective import PlanShot
from app.pipeline.images.prompt_builder import BuiltShot, ShotPrompt, build_shot_request
from app.providers.gateway import Gateway, build_gateway
from app.settings import REPO_ROOT, Settings
from app.storage import canon_store
from app.storage.canon_store import CHARACTERS, PERIODS, STYLE
from app.storage.db import connect, migrate
from app.storage.paths import StudioPaths
from app.tools.seed import seed

FIXTURES = REPO_ROOT / "tests" / "fixtures"
CANON = FIXTURES / "canon"
PLAN = json.loads((FIXTURES / "director_canon_20shots.json").read_text(encoding="utf-8"))
EPISODE = PLAN["meta"]["episode_id"]
YOU, BOSUN = "you@powder-monkey-11", "bosun@caribbean-1716"
PNG = b"\x89PNG\r\n\x1a\n"


def canon_json(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((CANON / name).read_text(encoding="utf-8"))
    return data


STYLE_DATA = canon_json("style_cursus.json")
PERIOD_DATA = canon_json("period_caribbean_1716.json")
YOU_DATA = canon_json("character_you.json")
BOSUN_DATA = canon_json("character_bosun.json")


def edit_yaml(path: Path, change: Callable[[dict[str, Any]], None]) -> None:
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    change(data)
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")


def make_config(tmp_path: Path, max_refs: int) -> Path:
    """Тестовые маршруты с лимитом референсов у модели кадров."""
    config = tmp_path / "config"
    shutil.copytree(FIXTURES / "config", config)

    def providers(data: dict[str, Any]) -> None:
        for entry in data["stages"]["images"]["catalog"].values():
            entry["max_refs"] = max_refs

    edit_yaml(config / "providers.yaml", providers)
    return config


def publish(paths: StudioPaths, layer: Any, entity_id: str | None, data: Any) -> None:
    canon_store.save_draft(paths, "cursus", layer, entity_id, data)
    canon_store.publish(paths, "cursus", layer, entity_id)


def publish_canon(paths: StudioPaths) -> None:
    publish(paths, STYLE, None, Style.model_validate(STYLE_DATA))
    publish(paths, PERIODS, "caribbean-1716", Period.model_validate(PERIOD_DATA))
    publish(paths, CHARACTERS, "you", Character.model_validate(YOU_DATA))
    publish(paths, CHARACTERS, "bosun", Character.model_validate(BOSUN_DATA))


def fake_file(folder: Path, key: str, owner: str) -> Path:
    digest = hashlib.sha256(f"{owner}/{key}".encode()).hexdigest()
    path = folder / f"{key}-{digest[:16]}.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(PNG + f"{owner}/{key}".encode())
    return path


def make_sheet(paths: StudioPaths, config: CanonConfig, appearance_id: str) -> None:
    """Лист 6/6 версии v001 — записями M5.4, без вызовов модели."""
    s = anchors.appearance_set(paths, "cursus", appearance_id)
    for angle in ANGLES:
        path = fake_file(s.files, f"{angle}-1", appearance_id)
        record = CandidateRecord(
            id=path.stem,
            slot=angle,
            n=1,
            status="ready",
            file=path.relative_to(s.root).as_posix(),
            seed=1,
            version="v001",
            canon={},
            created_at="2026-10-16T00:00:00+00:00",
        )
        anchors.record_candidate(s, record)
        anchors.choose(paths, "cursus", appearance_id, angle, record.id, config)


def make_style_frames(
    paths: StudioPaths, config: CanonConfig, version: str = "v001", period: str = "caribbean-1716"
) -> None:
    s = anchors.style_set(paths, "cursus")
    for frame in config.style_frames.frames:
        path = fake_file(s.files, f"{frame.id}-1", f"style-{version}-{period}")
        record = CandidateRecord(
            id=path.stem,
            slot=frame.id,
            n=1,
            status="ready",
            file=path.relative_to(s.root).as_posix(),
            seed=1,
            version=version,
            canon={"style": f"style/{version}", "period": f"periods/{period}/v001"},
            created_at="2026-10-16T00:00:00+00:00",
        )
        anchors.record_candidate(s, record, auto_choose=True)


@dataclass
class Env:
    paths: StudioPaths
    gateway: Gateway
    config: CanonConfig
    director: Director

    def shot(self, shot_id: str) -> Shot:
        return next(s for s in self.director.shots if s.id == shot_id)

    def build(
        self, shot: str | Shot, canon_ref: CanonRef | None = None, episode: str = EPISODE
    ) -> BuiltShot:
        return build_shot_request(
            self.paths,
            self.gateway,
            self.config,
            episode_id=episode,
            channel="cursus",
            canon_ref=canon_ref or self.canon_ref(),
            shot=self.shot(shot) if isinstance(shot, str) else shot,
        )

    def canon_ref(self, **changes: Any) -> CanonRef:
        assert self.director.canon_ref is not None
        return self.director.canon_ref.model_copy(update=changes)


def messages(prompt: ShotPrompt) -> list[str]:
    return [p.message for p in prompt.problems]


def targets(prompt: ShotPrompt) -> list[tuple[str, str, str] | None]:
    """Адресаты проблем канона: (вид сущности, id, вид проблемы)."""
    return [(p.canon.kind, p.canon.id, p.canon.issue) if p.canon else None for p in prompt.problems]


def make_env(tmp_path: Path, *, max_refs: int = 14, sheets: tuple[str, ...] = (YOU, BOSUN)) -> Env:
    config_dir = make_config(tmp_path, max_refs)
    settings = Settings(_env_file=None, studio_data_dir=tmp_path / "data", config_dir=config_dir)
    paths = StudioPaths(settings.studio_data_dir)
    migrate(paths.db_path)
    conn = connect(paths.db_path)
    try:
        seed(paths, conn)
    finally:
        conn.close()
    config = load_canon_config(config_dir / "canon.yaml")
    publish_canon(paths)
    for appearance_id in sheets:
        make_sheet(paths, config, appearance_id)
    make_style_frames(paths, config)
    return Env(paths, build_gateway(settings, paths), config, validate_director(PLAN))


@pytest.fixture
def env(tmp_path: Path) -> Env:
    return make_env(tmp_path)


# --- детерминизм ---------------------------------------------------------------------------------


def test_twenty_shots_twice_give_byte_identical_requests(env: Env) -> None:
    first = [env.build(shot) for shot in env.director.shots]
    second = [env.build(shot) for shot in env.director.shots]
    assert [b.prompt.model_dump_json() for b in first] == [
        b.prompt.model_dump_json() for b in second
    ]
    assert [b.request.model_dump_json() for b in first if b.request] == [
        b.request.model_dump_json() for b in second if b.request
    ]
    assert all(b.prompt.problems == [] and b.request is not None for b in first)
    hashes = [b.prompt.input_hash for b in first]
    assert len(set(hashes)) == 20 and None not in hashes
    assert len({b.prompt.seed for b in first}) == 20


# --- секции, источники, negative -----------------------------------------------------------------


def test_sections_order_sources_and_text(env: Env) -> None:
    prompt = env.build("s006").prompt  # action, двое: мальчик и боцман
    assert [s.kind for s in prompt.sections] == [
        "style",
        "period",
        "appearance",
        "appearance",
        "action",
        "shot_size",
    ]
    assert [s.source for s in prompt.sections] == [
        "style/v001",
        "periods/caribbean-1716/v001",
        "characters/you/v001#powder-monkey-11",
        "characters/bosun/v001#caribbean-1716",
        "shot",
        "shot",
    ]
    assert [s.label for s in prompt.sections] == [
        "Стиль канала",
        "Эпоха: Карибы, 1716",
        "Облик: Пороховая обезьяна, 11",
        "Облик: Боцман, 1716",
        "Действие",
        "Крупность: action",
    ]
    assert prompt.text == "\n\n".join(s.text for s in prompt.sections)
    headers = [s.text.split("\n", 1)[0] for s in prompt.sections]
    assert headers == [
        "Rendering (style reference images 9–10):",
        "Era:",
        "Person 1 (reference images 1–4):",
        "Person 2 (reference images 5–8):",
        "Action: the bosun grabs the boy by the collar and drags him away from an open hatch",
        "Shot size: medium-wide shot of the action, whole figures readable",
    ]
    # Кадр — со стилем целиком: свет, оптика и композиция, в отличие от листа портретов.
    style = prompt.sections[0].text
    for text in (STYLE_DATA["light"]["direction"], STYLE_DATA["optics"]["focal"]):
        assert text in style
    assert "horn-paned lanterns" in prompt.sections[1].text
    assert "broken nose" in prompt.sections[3].text and "- Age: 40" in prompt.sections[3].text
    assert [r.label for r in prompt.refs] == [
        f"{YOU} — фас",
        f"{YOU} — три четверти",
        f"{YOU} — в полный рост",
        f"{YOU} — в действии",
        f"{BOSUN} — фас",
        f"{BOSUN} — три четверти",
        f"{BOSUN} — в полный рост",
        f"{BOSUN} — в действии",
        "Кадр стиля — общий план",
        "Кадр стиля — портрет",
    ]
    assert all(r.file.startswith("channels/cursus/canon/anchors/") for r in prompt.refs)
    assert (prompt.model, prompt.usd.usd, prompt.aspect_ratio) == (
        "fake-image-small",
        "$0.067",
        "16:9",
    )


def test_negative_is_union_by_layer_without_repeats(env: Env) -> None:
    negative = env.build("s006").prompt.negative.split(", ")
    expected = [*STYLE_DATA["negative_global"], *PERIOD_DATA["forbidden"], "adult beard", "hat"]
    # У боцмана «Hat» и «Text» уже есть в слоях выше — без учёта регистра не повторяются.
    assert negative == [*expected, "officer's coat"]


def test_refs_follow_shot_size(env: Env) -> None:
    detail = env.build("s004").prompt  # detail без персонажа
    assert [s.kind for s in detail.sections] == ["style", "period", "action", "shot_size"]
    assert [r.label for r in detail.refs] == ["Кадр стиля — деталь", "Кадр стиля — портрет"]
    assert detail.sections[0].text.startswith("Rendering (style reference images 1–2):")
    reaction = env.build("s008").prompt  # reaction боцмана
    assert [r.slot for r in reaction.refs] == [
        "front",
        "three_quarter",
        "profile",
        "portrait",
        "night",
    ]
    establishing = env.build("s001").prompt
    assert [r.slot for r in establishing.refs] == ["establishing", "crowd"]


def test_human_edit_is_labelled_and_changes_hash(env: Env) -> None:
    shot = env.shot("s002")
    edited = PlanShot(
        **shot.model_copy(
            update={"image": shot.image.model_copy(update={"prompt": "drops the case and runs"})}
        ).model_dump(),
        status="queued",
        stale_reasons=[],
        duration_locked=False,
        prompt_locked=False,
        overridden=["image.prompt"],
    )
    built = env.build(edited).prompt
    action = next(s for s in built.sections if s.kind == "action")
    assert (action.label, action.text) == (
        "Действие — правка человека",
        "Action: drops the case and runs",
    )
    assert built.input_hash != env.build("s002").prompt.input_hash


# --- хэш входов ----------------------------------------------------------------------------------


def test_hash_changes_with_style_and_appearance_versions(env: Env) -> None:
    base = env.build("s002").prompt
    publish(env.paths, STYLE, None, Style.model_validate({**STYLE_DATA, "grain": "coarse grain"}))
    style_v2 = env.build("s002", env.canon_ref(style="style/v002")).prompt
    assert style_v2.problems == [] and style_v2.input_hash != base.input_hash
    assert "coarse grain" in style_v2.text and style_v2.warnings == []  # зерно — кадры стиля в силе

    nature = {**YOU_DATA["nature"], "personality": "silent and stubborn"}
    publish(env.paths, CHARACTERS, "you", Character.model_validate({**YOU_DATA, "nature": nature}))
    appearances = {**env.canon_ref().appearances, YOU: "characters/you/v002#powder-monkey-11"}
    you_v2 = env.build("s002", env.canon_ref(appearances=appearances)).prompt
    assert you_v2.problems == []  # характер лист не устаревает
    assert you_v2.input_hash not in (base.input_hash, style_v2.input_hash)
    assert you_v2.seed != base.seed
    assert env.build("s002").prompt.input_hash == base.input_hash  # прибитые версии — тот же


# --- лимит референсов ----------------------------------------------------------------------------


def test_ref_limit_drops_style_frames_then_angles_but_never_fronts(tmp_path: Path) -> None:
    env = make_env(tmp_path, max_refs=5)
    prompt = env.build("s006").prompt  # 4 + 4 ракурса + 2 кадра стиля = 10
    assert prompt.problems == []
    assert [r.label for r in prompt.refs] == [
        f"{YOU} — фас",
        f"{YOU} — три четверти",
        f"{YOU} — в полный рост",
        f"{YOU} — в действии",
        f"{BOSUN} — фас",
    ]
    assert [(r.slot, r.reason.split(":")[1].strip()) for r in prompt.dropped] == [
        ("portrait", "кадры стиля уходят первыми"),
        ("establishing", "кадры стиля уходят первыми"),
        ("in_action", "ракурсы сверх фаса уходят с последнего облика"),
        ("full_body", "ракурсы сверх фаса уходят с последнего облика"),
        ("three_quarter", "ракурсы сверх фаса уходят с последнего облика"),
    ]
    headers = [s.text.split("\n", 1)[0] for s in prompt.sections]
    assert headers[0] == "Rendering:" and headers[3] == "Person 2 (reference image 5):"


def test_fronts_that_do_not_fit_are_a_problem(tmp_path: Path) -> None:
    env = make_env(tmp_path, max_refs=1)
    built = env.build("s006")
    assert messages(built.prompt) == [
        "кадр s006: обликов в кадре 2, а модель fake-image-small принимает референсов не больше 1"
        " — даже фасы не помещаются, уберите облик из кадра"
    ]
    assert built.prompt.problems[0].canon is None  # не канон: на экран 12 ссылки нет
    assert built.request is None and built.prompt.input_hash is None


# --- проблемы и предупреждения -------------------------------------------------------------------


def test_style_token_in_action_is_a_problem_with_shot_id(env: Env) -> None:
    shot = env.shot("s002")
    styled = shot.model_copy(
        update={"image": shot.image.model_copy(update={"prompt": "cinematic lighting on the deck"})}
    )
    built = env.build(styled)
    assert messages(built.prompt) == [
        "кадр s002: в действии стилевой токен «cinematic lighting» (lighting) — стиль задаёт"
        " канон, опишите только действие, композицию и ракурс"
    ]
    assert built.prompt.problems[0].canon is None
    assert built.request is None


def test_missing_sheet_and_unresolved_canon_are_problems(tmp_path: Path) -> None:
    """Проблема канона — текст и адресат (сущность и вид), как у отказа «Утвердить план»."""
    env = make_env(tmp_path, sheets=(YOU,))
    sheet = env.build("s008").prompt
    assert messages(sheet) == [
        f"кадр s008: у облика {BOSUN} нет листа опорных портретов — соберите его на экране «Канон»"
    ]
    assert targets(sheet) == [("appearance", BOSUN, "no_sheet")]
    periods = {"caribbean-1716": "periods/caribbean-1716/v009"}
    late = env.build("s001", env.canon_ref(periods=periods)).prompt
    assert messages(late) == [
        "кадр s001: эпоха periods/caribbean-1716/v009 не найдена в каноне cursus"
    ]
    assert targets(late) == [("period", "caribbean-1716", "unresolved")]  # версии есть, v009 нет
    unknown = env.build(
        "s001", env.canon_ref(periods={"tortuga-1690": "periods/tortuga-1690/v001"})
    )
    assert targets(unknown.prompt) == [("period", "caribbean-1716", "unresolved")]
    missing = env.build("s002", env.canon_ref(appearances={})).prompt
    assert messages(missing) == [
        f"кадр s002: облика {YOU} нет в canon_ref плана — импортируйте план заново"
    ]
    assert targets(missing) == [("appearance", YOU, "unresolved")]


def test_unpublished_canon_is_a_problem_with_its_entity(tmp_path: Path) -> None:
    """Персонажа без единой версии ссылка не находит — «не опубликован», а не «ссылка не та»."""
    env = make_env(tmp_path, sheets=(YOU,))
    ghost = "ghost@caribbean-1716"
    ref = env.canon_ref(
        appearances={
            YOU: f"characters/you/v001#{YOU.split('@')[1]}",
            ghost: "characters/ghost/v001#caribbean-1716",
        }
    )
    shot = env.shot("s002")
    with_ghost = shot.model_copy(
        update={"image": shot.image.model_copy(update={"appearances": [ghost]})}
    )
    prompt = env.build(with_ghost, ref).prompt
    assert targets(prompt) == [("appearance", ghost, "unpublished")]


def test_style_frames_of_other_period_or_stale_are_not_served(env: Env) -> None:
    make_style_frames(env.paths, env.config, period="england-1347")
    other = env.build("s001").prompt
    assert other.refs == [] and other.problems == []
    assert other.warnings == [
        "кадр стиля «общий план» сделан в другой эпохе (periods/england-1347/v001) — в кадр"
        " эпохи caribbean-1716 не подаётся",
        "кадр стиля «толпа» сделан в другой эпохе (periods/england-1347/v001) — в кадр"
        " эпохи caribbean-1716 не подаётся",
    ]

    make_style_frames(env.paths, env.config)  # снова Карибы, стиль v001
    light = {**STYLE_DATA["light"], "direction": "top light"}
    publish(env.paths, STYLE, None, Style.model_validate({**STYLE_DATA, "light": light}))
    stale = env.build("s001", env.canon_ref(style="style/v002")).prompt
    assert stale.refs == []
    assert stale.warnings[0] == (
        "кадр стиля «общий план» устарел против style/v002 — пересоберите кадры стиля на экране"
        " «Канон»"
    )


# --- предпросмотр --------------------------------------------------------------------------------


@pytest.fixture
def client(tmp_path: Path) -> Iterator[tuple[TestClient, Env]]:
    env = make_env(tmp_path)
    settings = Settings(
        _env_file=None, studio_data_dir=env.paths.root, config_dir=tmp_path / "config"
    )
    with TestClient(create_app(settings)) as client:
        yield client, env


def test_preview_endpoint_shows_sections_refs_and_price(client: tuple[TestClient, Env]) -> None:
    http, env = client
    url = f"/api/projects/{EPISODE}"
    created = http.post("/api/episodes", json={"id": EPISODE, "channel": "cursus", "title": "X"})
    assert created.status_code == 201, created.text
    assert http.get(f"{url}/shots/s006/prompt").status_code == 409  # плана ещё нет
    assert http.post(f"{url}/director", json=PLAN).status_code == 200

    response = http.get(f"{url}/shots/s006/prompt")
    assert response.status_code == 200, response.text
    body = response.json()
    assert [s["source"] for s in body["sections"]][:4] == [
        "style/v001",
        "periods/caribbean-1716/v001",
        "characters/you/v001#powder-monkey-11",
        "characters/bosun/v001#caribbean-1716",
    ]
    assert len(body["refs"]) == 10 and body["refs"][0]["label"] == f"{YOU} — фас"
    assert (body["model"], body["usd"]["usd"], body["problems"]) == (
        "fake-image-small",
        "$0.067",
        [],
    )
    assert body["input_hash"] == env.build("s006").prompt.input_hash

    missing = http.get(f"{url}/shots/s999/prompt")
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Кадра s999 в действующем плане выпуска нет."
