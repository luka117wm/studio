"""M5.1: канон канала — модели, черновики, неизменяемые версии, резолв ссылок, API."""

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.models.canon import Character, Period, Style
from app.settings import Settings
from app.storage import canon_store
from app.storage.atomic import read_json, write_json_new
from app.storage.canon_store import (
    CHARACTERS,
    PERIODS,
    CanonConflict,
    CanonRefError,
    resolve_appearance,
    resolve_period,
    resolve_style,
)
from app.storage.db import connect
from app.storage.paths import StudioPaths
from app.tools.seed import seed

FIXTURES = Path(__file__).parent / "fixtures" / "canon"
STYLE = json.loads((FIXTURES / "style_cursus.json").read_text(encoding="utf-8"))
PERIOD = json.loads((FIXTURES / "period_caribbean_1716.json").read_text(encoding="utf-8"))
CHARACTER = json.loads((FIXTURES / "character_you.json").read_text(encoding="utf-8"))
BASE = "/api/canon/cursus"
PERIOD_URL = f"{BASE}/periods/caribbean-1716"
CHARACTER_URL = f"{BASE}/characters/you"


@pytest.fixture
def paths(settings: Settings) -> StudioPaths:
    return StudioPaths(settings.studio_data_dir)


@pytest.fixture
def seeded(client: TestClient, paths: StudioPaths) -> Iterator[TestClient]:
    conn = connect(paths.db_path)
    try:
        seed(paths, conn)
    finally:
        conn.close()
    yield client


def with_(base: dict[str, Any], **fields: Any) -> dict[str, Any]:
    return {**json.loads(json.dumps(base)), **fields}


def put(client: TestClient, url: str, body: dict[str, Any]) -> dict[str, Any]:
    response = client.put(f"{url}/draft", json=body)
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()
    return data


def publish(client: TestClient, url: str) -> dict[str, Any]:
    response = client.post(f"{url}/publish")
    assert response.status_code == 201, response.text
    data: dict[str, Any] = response.json()
    return data


def detail(response: Any, status: int) -> str:
    assert response.status_code == status, response.text
    text: str = response.json()["detail"]
    return text


def messages(response: Any) -> list[str]:
    assert response.status_code == 422, response.text
    return [error["msg"] for error in response.json()["detail"]]


# --- модели и правила публикации -----------------------------------------------------------------


def test_fixtures_are_publishable() -> None:
    assert Style.model_validate(STYLE).publish_problems() == []
    assert Period.model_validate(PERIOD).publish_problems() == []
    assert Character.model_validate(CHARACTER).publish_problems() == []


def test_skeleton_is_a_valid_draft_but_not_publishable() -> None:
    """Скелет «нужно каналу» (M5.2) — один id: форма годится, публикация — нет."""
    assert Style().publish_problems() == [
        "Стиль без рендера не публикуется — опишите технику изображения в поле render.",
        "Образцов палитры 0, а нужно от 3 до 5 — добавьте цвета.",
    ]
    assert Period(id="venice-1570").publish_problems() == [
        "Эпоха без названия не публикуется — заполните label, например «Карибы, 1716».",
        "Эпоха без региона не публикуется — заполните region, например Caribbean Sea.",
        "Эпоха без годов не публикуется — заполните years.from и years.to.",
        "Эпоха без запретов не публикуется — добавьте хотя бы один анахронизм.",
    ]
    assert Character(id="otto").publish_problems() == [
        "Персонаж без имени не публикуется — заполните label.",
        "Персонаж без черт лица не публикуется — заполните nature.face: по ним собирается "
        "лист портретов.",
        "Персонаж без обликов не публикуется — добавьте хотя бы один облик.",
    ]


def test_appearance_and_swatch_publish_rules() -> None:
    character = with_(CHARACTER)
    character["appearances"][2] = {"id": "you@captain-35"}
    assert Character.model_validate(character).publish_problems() == [
        "Облик you@captain-35 без названия не публикуется — заполните label.",
        "Облик you@captain-35 без эпохи не публикуется — укажите period.",
    ]
    style = with_(STYLE)
    style["palette"]["swatches"][0]["role"] = " "
    assert Style.model_validate(style).publish_problems() == [
        "У цвета #2b2118 нет роли — напишите в role, для чего он, например shadows."
    ]


def test_russian_text_and_empty_items_block_publishing() -> None:
    """Текст канона уходит в промпт картинки — только английский; подписи `label` — по-русски."""
    style = with_(STYLE, light={**STYLE["light"], "direction": "контровой свет"})
    assert Style.model_validate(style).publish_problems() == [
        "Поле light.direction написано по-русски — текст канона уходит в промпт картинки, "
        "пишите по-английски."
    ]
    period = with_(PERIOD, forbidden=[*PERIOD["forbidden"], "  ", "пластик"])
    assert Period.model_validate(period).publish_problems() == [
        "Пустая позиция в списке forbidden — заполните или удалите её.",
        "Список forbidden написан по-русски — текст канона уходит в промпт картинки, "
        "пишите по-английски.",
    ]
    character = with_(CHARACTER)
    character["appearances"][0]["clothing"] = "рубаха"
    assert Character.model_validate(character).publish_problems() == [
        "Поле clothing облика you@powder-monkey-11 написано по-русски — текст канона уходит "
        "в промпт картинки, пишите по-английски."
    ]


@pytest.mark.parametrize(
    ("model", "body", "message"),
    [
        (
            Style,
            {"palette": {"swatches": [{"role": "base", "hex": "brown"}]}},
            "Цвет «brown» не годится — нужен код #RRGGBB, например #2b2118.",
        ),
        (
            Style,
            {"palette": {"swatches": [{"hex": "#000000"}] * 6}},
            "Образцов палитры 6, а можно не больше 5 — уберите лишние.",
        ),
        (
            Period,
            {"id": "Venice_1570"},
            "id «Venice_1570» не годится — только строчные латинские буквы, цифры и дефис, "
            "например caribbean-1716.",
        ),
        (
            Period,
            {"id": "venice-1570", "years": {"from": 1580, "to": 1570}},
            "Годы эпохи наоборот: from 1580 позже to 1570 — поменяйте их местами.",
        ),
        (
            Character,
            {"id": "you", "appearances": [{"id": "otto@london-1666"}]},
            "Облик otto@london-1666 не принадлежит персонажу you — id облика начинается с «you@».",
        ),
        (
            Character,
            {"id": "you", "appearances": [{"id": "you@captain-35"}, {"id": "you@captain-35"}]},
            "Облик you@captain-35 повторяется — у каждого облика свой id.",
        ),
        (
            Character,
            {"id": "you", "appearances": [{"id": "captain-35"}]},
            "id облика «captain-35» не годится — нужен вид <персонаж>@<облик>, например "
            "you@powder-monkey-11.",
        ),
        (
            Character,
            {"id": "you", "appearances": [{"id": "you@captain-35", "age": 300}]},
            "Возраст 300 вне 0–120 — укажите полных лет.",
        ),
    ],
)
def test_shape_errors_are_russian(
    model: type[Style | Period | Character], body: dict[str, Any], message: str
) -> None:
    with pytest.raises(ValidationError) as caught:
        model.model_validate(body)
    assert [error["msg"] for error in caught.value.errors()] == [message]


def test_years_use_from_in_json() -> None:
    period = Period.model_validate(PERIOD)
    assert period.years is not None and period.years.from_ == 1714
    dumped = period.model_dump(mode="json", by_alias=True)
    assert dumped["years"] == {"from": 1714, "to": 1718}


# --- черновик и версии через API -----------------------------------------------------------------


def test_period_draft_publish_and_versions_are_immutable(
    seeded: TestClient, paths: StudioPaths
) -> None:
    folder = paths.canon_period_dir("cursus", "caribbean-1716")
    draft = put(seeded, PERIOD_URL, PERIOD)
    assert draft["draft"] is True and draft["version"] is None and draft["based_on"] is None
    assert seeded.get(PERIOD_URL).json()["draft"] is True

    first = publish(seeded, PERIOD_URL)
    assert (first["draft"], first["version"], first["based_on"]) == (False, "v001", None)
    v001 = folder / "v001.json"
    assert read_json(v001)["data"] == PERIOD
    assert not (folder / "draft.json").exists()
    before = v001.read_bytes()

    edited = with_(PERIOD, forbidden=[*PERIOD["forbidden"], "potatoes in the ship's rations"])
    assert put(seeded, PERIOD_URL, edited)["based_on"] == "v001"
    second = publish(seeded, PERIOD_URL)
    assert (second["version"], second["based_on"]) == ("v002", "v001")
    assert v001.read_bytes() == before
    assert read_json(folder / "v002.json")["data"]["forbidden"][-1] == (
        "potatoes in the ship's rations"
    )

    assert seeded.get(PERIOD_URL).json()["version"] == "v002"
    old = seeded.get(PERIOD_URL, params={"version": "v001"}).json()
    assert old["version"] == "v001" and old["data"] == PERIOD


def test_period_without_forbidden_is_409_and_draft_kept(
    seeded: TestClient, paths: StudioPaths
) -> None:
    folder = paths.canon_period_dir("cursus", "caribbean-1716")
    put(seeded, PERIOD_URL, with_(PERIOD, forbidden=[]))
    assert detail(seeded.post(f"{PERIOD_URL}/publish"), 409) == (
        "Эпоха без запретов не публикуется — добавьте хотя бы один анахронизм."
    )
    assert read_json(folder / "draft.json")["data"]["forbidden"] == []
    assert not (folder / "v001.json").exists()


def test_all_publish_problems_come_in_one_409(seeded: TestClient) -> None:
    put(seeded, CHARACTER_URL, {"id": "you", "label": "Ты"})
    assert detail(seeded.post(f"{CHARACTER_URL}/publish"), 409).split("\n") == [
        "Персонаж без черт лица не публикуется — заполните nature.face: по ним собирается "
        "лист портретов.",
        "Персонаж без обликов не публикуется — добавьте хотя бы один облик.",
    ]


def test_publish_never_overwrites_an_existing_version(
    seeded: TestClient, paths: StudioPaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Гонка двух публикаций: номер посчитан по старому списку, а `v002` уже лежит на диске."""
    folder = paths.canon_period_dir("cursus", "caribbean-1716")
    put(seeded, PERIOD_URL, PERIOD)
    publish(seeded, PERIOD_URL)
    put(seeded, PERIOD_URL, with_(PERIOD, region="Bahamas"))
    publish(seeded, PERIOD_URL)
    v002 = (folder / "v002.json").read_bytes()
    put(seeded, PERIOD_URL, with_(PERIOD, region="Jamaica"))
    monkeypatch.setattr(canon_store, "_numbers", lambda _folder: [1])
    assert detail(seeded.post(f"{PERIOD_URL}/publish"), 409) == (
        "Версия v002 эпохи caribbean-1716 уже есть — опубликованные версии не "
        "перезаписываются, обновите страницу."
    )
    assert (folder / "v002.json").read_bytes() == v002
    assert read_json(folder / "draft.json")["data"]["region"] == "Jamaica"
    assert sorted(p.name for p in folder.iterdir()) == ["draft.json", "v001.json", "v002.json"]


def test_write_json_new_refuses_existing_file(tmp_path: Path) -> None:
    target = tmp_path / "v001.json"
    write_json_new(target, {"a": 1})
    with pytest.raises(FileExistsError):
        write_json_new(target, {"a": 2})
    assert read_json(target) == {"a": 1}
    assert [p.name for p in tmp_path.iterdir()] == ["v001.json"]


def test_identical_draft_is_not_published(seeded: TestClient) -> None:
    put(seeded, PERIOD_URL, PERIOD)
    publish(seeded, PERIOD_URL)
    put(seeded, PERIOD_URL, PERIOD)
    assert detail(seeded.post(f"{PERIOD_URL}/publish"), 409) == (
        "Черновик эпохи caribbean-1716 не отличается от v001 — публиковать нечего, "
        "сбросьте черновик."
    )


def test_draft_from_version_and_discard(seeded: TestClient, paths: StudioPaths) -> None:
    folder = paths.canon_period_dir("cursus", "caribbean-1716")
    put(seeded, PERIOD_URL, PERIOD)
    publish(seeded, PERIOD_URL)
    put(seeded, PERIOD_URL, with_(PERIOD, region="Bahamas"))
    publish(seeded, PERIOD_URL)

    response = seeded.post(f"{PERIOD_URL}/draft", params={"from": "v001"})
    assert response.status_code == 201, response.text
    assert (response.json()["based_on"], response.json()["data"]) == ("v001", PERIOD)
    # Правки черновика сохраняют, из какой версии он начат.
    assert put(seeded, PERIOD_URL, with_(PERIOD, region="Tortuga"))["based_on"] == "v001"

    assert detail(seeded.post(f"{PERIOD_URL}/draft", params={"from": "v002"}), 409) == (
        "У эпохи caribbean-1716 уже есть черновик — опубликуйте или сбросьте его, потом "
        "создавайте черновик из v002."
    )
    assert read_json(folder / "draft.json")["data"]["region"] == "Tortuga"

    assert seeded.delete(f"{PERIOD_URL}/draft").status_code == 204
    assert not (folder / "draft.json").exists()
    assert seeded.get(PERIOD_URL).json()["version"] == "v002"
    assert detail(seeded.delete(f"{PERIOD_URL}/draft"), 404) == (
        "У эпохи caribbean-1716 нет черновика — сбрасывать нечего."
    )
    assert detail(seeded.post(f"{PERIOD_URL}/publish"), 409) == (
        "У эпохи caribbean-1716 нет черновика — публиковать нечего."
    )
    assert detail(seeded.post(f"{PERIOD_URL}/draft", params={"from": "v009"}), 404) == (
        "У эпохи caribbean-1716 нет версии v009 — есть: v001, v002."
    )


def test_style_and_character_round_trip(seeded: TestClient, paths: StudioPaths) -> None:
    style = put(seeded, f"{BASE}/style", STYLE)
    assert style["data"] == STYLE
    assert publish(seeded, f"{BASE}/style")["version"] == "v001"
    assert (paths.canon_style_dir("cursus") / "v001.json").exists()

    put(seeded, CHARACTER_URL, CHARACTER)
    doc = publish(seeded, CHARACTER_URL)
    assert doc["version"] == "v001"
    assert [a["id"] for a in doc["data"]["appearances"]] == [
        "you@powder-monkey-11",
        "you@quartermaster-28",
        "you@captain-35",
    ]


def test_missing_entities_and_versions_are_404(seeded: TestClient) -> None:
    assert detail(seeded.get(f"{BASE}/style"), 404) == (
        "Стиля канала в каноне cursus нет — создайте черновик."
    )
    assert detail(seeded.get(f"{BASE}/periods/venice-1570"), 404) == (
        "Эпохи venice-1570 в каноне cursus нет — создайте черновик."
    )
    assert detail(seeded.post(f"{BASE}/characters/otto/publish"), 404) == (
        "Персонажа otto в каноне cursus нет — создайте черновик."
    )
    put(seeded, PERIOD_URL, PERIOD)
    assert detail(seeded.get(PERIOD_URL, params={"version": "v001"}), 404) == (
        "У эпохи caribbean-1716 нет версии v001 — есть: опубликованных версий нет."
    )


def test_bad_ids_and_versions_are_422(seeded: TestClient) -> None:
    assert messages(seeded.put(f"{BASE}/periods/venice-1570/draft", json=PERIOD)) == [
        "id «caribbean-1716» в теле не совпадает с адресом «venice-1570» — исправьте одно из двух."
    ]
    assert messages(seeded.get(f"{BASE}/periods/Venice_1570")) == [
        "id «Venice_1570» не годится — только строчные латинские буквы, цифры и дефис, "
        "например caribbean-1716."
    ]
    assert seeded.get(f"{BASE}/periods/%2E%2E").status_code == 422
    assert messages(seeded.get(PERIOD_URL, params={"version": "2"})) == [
        "Версия «2» не годится — нужна вида v001."
    ]
    assert messages(seeded.post(f"{PERIOD_URL}/draft", params={"from": "latest"})) == [
        "Версия «latest» не годится — нужна вида v001."
    ]
    assert detail(seeded.get("/api/canon/vlog"), 404).startswith("Канал «vlog» не найден.")


def test_summary_lists_layers(seeded: TestClient) -> None:
    empty = seeded.get(BASE).json()
    assert empty == {
        "channel": "cursus",
        "style": {"versions": [], "draft": False},
        "periods": [],
        "characters": [],
    }
    put(seeded, f"{BASE}/style", STYLE)
    put(seeded, PERIOD_URL, PERIOD)
    publish(seeded, PERIOD_URL)
    put(seeded, f"{BASE}/periods/venice-1570", {"id": "venice-1570"})
    put(seeded, CHARACTER_URL, CHARACTER)

    summary = seeded.get(BASE).json()
    assert summary["style"]["draft"] is True and summary["style"]["versions"] == []
    caribbean, venice = summary["periods"]
    assert (caribbean["id"], caribbean["label"], caribbean["draft"]) == (
        "caribbean-1716",
        "Карибы, 1716",
        False,
    )
    assert [v["version"] for v in caribbean["versions"]] == ["v001"]
    assert caribbean["forbidden_count"] == len(PERIOD["forbidden"])
    assert (caribbean["region"], caribbean["years"]) == (PERIOD["region"], PERIOD["years"])
    assert (venice["id"], venice["draft"], venice["forbidden_count"]) == ("venice-1570", True, 0)
    assert (venice["region"], venice["years"], venice["episodes"]) == ("", None, 0)
    assert summary["characters"] == [
        {
            "id": "you",
            "label": "Ты",
            "versions": [],
            "draft": True,
            "appearances_count": 3,
            "sheets_ready": 0,
            "sheets_outdated": 0,
        }
    ]


def test_channels_are_isolated(seeded: TestClient, paths: StudioPaths) -> None:
    put(seeded, "/api/canon/otto/style", STYLE)
    publish(seeded, "/api/canon/otto/style")
    put(seeded, "/api/canon/otto/periods/caribbean-1716", PERIOD)

    summary = seeded.get(BASE).json()
    assert summary["style"] == {"versions": [], "draft": False} and summary["periods"] == []
    assert seeded.get(f"{BASE}/style").status_code == 404
    assert seeded.get(PERIOD_URL).status_code == 404
    assert not paths.canon_dir("cursus").exists()
    with pytest.raises(CanonRefError):
        resolve_style(paths, "cursus", "style/v001")
    assert resolve_style(paths, "otto", "style/v001") == Style.model_validate(STYLE)


# --- резолв ссылок canon_ref ---------------------------------------------------------------------


def test_resolve_refs(seeded: TestClient, paths: StudioPaths) -> None:
    put(seeded, f"{BASE}/style", STYLE)
    publish(seeded, f"{BASE}/style")
    put(seeded, PERIOD_URL, PERIOD)
    publish(seeded, PERIOD_URL)
    put(seeded, CHARACTER_URL, CHARACTER)
    publish(seeded, CHARACTER_URL)
    # Черновик поверх версии ссылкой не резолвится: план прибит к версии.
    put(seeded, PERIOD_URL, with_(PERIOD, region="Bahamas"))

    assert resolve_style(paths, "cursus", "style/v001").palette.rule.startswith("earthy")
    period = resolve_period(paths, "cursus", "periods/caribbean-1716/v001")
    assert period.region == PERIOD["region"]
    character, appearance = resolve_appearance(paths, "cursus", "characters/you/v001#captain-35")
    assert character.id == "you" and appearance.id == "you@captain-35"
    assert appearance.age == 35 and character.nature.face.startswith("narrow face")


@pytest.mark.parametrize(
    ("resolve", "ref", "message"),
    [
        (resolve_style, "style/v002", "стиль style/v002 не найден в каноне cursus"),
        (
            resolve_period,
            "periods/caribbean-1716/v004",
            "эпоха periods/caribbean-1716/v004 не найдена в каноне cursus",
        ),
        (
            resolve_period,
            "periods/venice-1570/v001",
            "эпоха periods/venice-1570/v001 не найдена в каноне cursus",
        ),
        (
            resolve_appearance,
            "characters/you/v001#comito-34",
            "облик you@comito-34 не найден в characters/you/v001",
        ),
        (
            resolve_appearance,
            "characters/you/v004#captain-35",
            "персонаж characters/you/v004 не найден в каноне cursus",
        ),
        (
            resolve_period,
            "periods/caribbean-1716/v1",
            "ссылка «periods/caribbean-1716/v1» не по формату periods/<эпоха>/vNNN",
        ),
        (
            resolve_appearance,
            "characters/you/v001",
            "ссылка «characters/you/v001» не по формату characters/<персонаж>/vNNN#<облик>",
        ),
    ],
)
def test_resolve_errors_name_the_ref(
    seeded: TestClient, paths: StudioPaths, resolve: Any, ref: str, message: str
) -> None:
    put(seeded, f"{BASE}/style", STYLE)
    publish(seeded, f"{BASE}/style")
    put(seeded, PERIOD_URL, PERIOD)
    publish(seeded, PERIOD_URL)
    put(seeded, CHARACTER_URL, CHARACTER)
    publish(seeded, CHARACTER_URL)
    with pytest.raises(CanonRefError) as caught:
        resolve(paths, "cursus", ref)
    assert str(caught.value) == message
    assert caught.value.ref == ref


# --- хранилище напрямую и пути ------------------------------------------------------------------


def test_store_keeps_draft_when_publish_refused(seeded: TestClient, paths: StudioPaths) -> None:
    canon_store.save_draft(paths, "cursus", CHARACTERS, "you", Character(id="you"))
    with pytest.raises(CanonConflict):
        canon_store.publish(paths, "cursus", CHARACTERS, "you")
    assert canon_store.read_entry(paths, "cursus", CHARACTERS, "you").version is None
    with pytest.raises(ValueError):
        canon_store.save_draft(paths, "cursus", PERIODS, "venice-1570", Period(id="rome-44"))


def test_anchor_paths(paths: StudioPaths) -> None:
    anchors = paths.canon_dir("cursus") / "anchors"
    assert paths.anchor_dir("cursus", "you@captain-35") == anchors / "you@captain-35"
    assert paths.anchor_candidates_dir("cursus", "you@captain-35").name == "candidates"
    assert paths.anchor_rejected_dir("cursus", "you@captain-35").name == "rejected"
    assert paths.anchor_chosen_path("cursus", "you@captain-35").name == "chosen.json"
    assert paths.style_anchors_dir("cursus") == anchors / "style"
    for bad in ("style", "../you@x", "you@", "You@captain-35"):
        with pytest.raises(ValueError):
            paths.anchor_dir("cursus", bad)
    with pytest.raises(ValueError):
        paths.canon_period_dir("cursus", "..")
