"""Провайдеры без сети (M2.6): проверка ключа на подменённом транспорте, разбор ошибок, единицы."""

import asyncio
import base64
import json
from pathlib import Path
from typing import Any

import httpx
import httpx2
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.jobs.worker import TransientError, is_retryable, retry_after_s
from app.providers.anthropic import AnthropicProvider
from app.providers.base import (
    CharQuota,
    ImageRef,
    ImageRequest,
    KeyStatus,
    ProviderError,
    RateLimited,
    RefImage,
    Result,
    Route,
    RouteError,
    SpeechRequest,
    TextRequest,
    Usage,
    VideoRequest,
    VisionRequest,
    status_error,
)
from app.providers.elevenlabs import ElevenLabsProvider
from app.providers.gateway import Gateway, build_gateway
from app.providers.gemini import GeminiProvider
from app.settings import Settings
from app.storage.paths import StudioPaths

KEY = SecretStr("test-key")
NO_KEY = SecretStr("")


def _json(status: int, body: Any, **headers: str) -> dict[str, Any]:
    return {"status_code": status, "content": json.dumps(body), "headers": headers}


# --- ошибки ------------------------------------------------------------------------------------


def test_status_error_maps_to_queue_behaviour() -> None:
    limited = status_error("Gemini", 429, "quota", retry_after=12)
    assert isinstance(limited, RateLimited) and limited.retry_after == 12
    assert is_retryable(limited) and retry_after_s(limited) == 12
    assert "через 12 с" in str(limited)

    overloaded = status_error("Gemini", 503, "overloaded")
    assert isinstance(overloaded, TransientError) and is_retryable(overloaded)

    for status in (401, 402, 403, 400):
        error = status_error("ElevenLabs", status, "nope")
        assert isinstance(error, ProviderError) and error.status_code == status
        assert not is_retryable(error), status
    assert "Проверьте ключ в backend/.env — см. docs/api_keys.md." in str(
        status_error("ElevenLabs", 401, "invalid_api_key")
    )


def test_usage_rejects_foreign_request_kinds() -> None:
    route = Route(stage="images", key="k", kind="image", provider="anthropic", model="m")
    with pytest.raises(RouteError):
        AnthropicProvider(KEY).usage(route, ImageRequest(prompt="deck"))
    with pytest.raises(RouteError):
        GeminiProvider(KEY).usage(route, SpeechRequest(text="hi", voice_id="v"))
    with pytest.raises(RouteError):
        ElevenLabsProvider(KEY).usage(route, TextRequest(prompt="hi", max_output_tokens=1))
    with pytest.raises(RouteError):
        AnthropicProvider(KEY).usage(route, ASK)
    speech = ElevenLabsProvider(KEY).usage(route, SpeechRequest(text="hello", voice_id="v"))
    assert [(u.unit, u.quantity) for u in speech] == [("char", 5)]


# --- проверка ключей ---------------------------------------------------------------------------


def test_missing_keys_are_reported_without_network(tmp_path: Path) -> None:
    settings = Settings(_env_file=None, studio_data_dir=tmp_path / "data")
    gateway = build_gateway(settings, StudioPaths(settings.studio_data_dir))
    statuses = asyncio.run(gateway.check_keys())
    assert [s.provider for s in statuses] == ["anthropic", "elevenlabs", "gemini"]
    assert all(not s.configured and not s.ok for s in statuses)
    assert all("docs/api_keys.md" in s.message for s in statuses)


def test_elevenlabs_check_reports_quota() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            **_json(
                200,
                {
                    "tier": "creator",
                    "character_count": 21_000,
                    "character_limit": 121_000,
                    "next_character_count_reset_unix": 1_791_000_000,
                },
            )
        )

    provider = ElevenLabsProvider(KEY, transport=httpx.MockTransport(handler))
    status = asyncio.run(provider.check())
    assert status.ok and status.quota is not None
    assert status.quota.remaining_chars == 100_000 and status.quota.tier == "creator"
    assert status.quota.resets_at == "2026-10-03T04:00:00+00:00"
    assert "осталось 100000 из 121000 символов" in status.message
    assert seen[0].url.path == "/v1/user/subscription"
    assert seen[0].headers["xi-api-key"] == "test-key"


def test_elevenlabs_check_explains_rejected_key() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = {"detail": {"status": "invalid_api_key", "message": "Invalid API key"}}
        return httpx.Response(**_json(401, body))

    status = asyncio.run(ElevenLabsProvider(KEY, transport=httpx.MockTransport(handler)).check())
    assert status.configured and not status.ok
    assert "401" in status.message and "invalid_api_key" in status.message
    assert asyncio.run(ElevenLabsProvider(NO_KEY).check()).configured is False


def test_anthropic_check_lists_models_and_missing_ones() -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        assert request.url.path == "/v1/models"
        assert request.headers["x-api-key"] == "test-key"
        models = [
            {
                "id": model_id,
                "type": "model",
                "display_name": model_id,
                "created_at": "2026-01-01T00:00:00Z",
            }
            for model_id in ("claude-opus-5", "claude-sonnet-5")
        ]
        body = {"data": models, "has_more": False, "first_id": None, "last_id": None}
        return httpx2.Response(200, json=body)

    client = httpx2.AsyncClient(transport=httpx2.MockTransport(handler))
    status = asyncio.run(
        AnthropicProvider(KEY, http_client=client).check(["claude-opus-5", "claude-opus-9"])
    )
    assert status.ok and status.missing_models == ["claude-opus-9"]


def test_anthropic_check_rejected_key_is_not_ok() -> None:
    calls: list[int] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        calls.append(1)
        error = {"type": "authentication_error", "message": "invalid x-api-key"}
        return httpx2.Response(401, json={"type": "error", "error": error})

    client = httpx2.AsyncClient(transport=httpx2.MockTransport(handler))
    status = asyncio.run(AnthropicProvider(KEY, http_client=client).check())
    assert status.configured and not status.ok and "401" in status.message
    assert calls == [1]  # SDK сам не повторяет — повторяет только очередь


def test_gemini_check_lists_models_and_missing_ones() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/models")
        body = {"models": [{"name": "models/gemini-3.1-flash-image"}, {"name": "models/veo-x"}]}
        return httpx.Response(**_json(200, body))

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    status = asyncio.run(
        GeminiProvider(KEY, http_client=client).check(["gemini-3.1-flash-image", "gemini-9"])
    )
    assert status.ok and status.missing_models == ["gemini-9"]


def test_gemini_check_rate_limit_is_reported_once() -> None:
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        body = {"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED"}}
        return httpx.Response(**_json(429, body, **{"Retry-After": "7"}))

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    status = asyncio.run(GeminiProvider(KEY, http_client=client).check())
    assert not status.ok and "429" in status.message and "через 7 с" in status.message
    assert calls == [1]


def test_gemini_invalid_key_400_reads_as_rejected_key() -> None:
    """Gemini отвечает на неверный ключ 400 INVALID_ARGUMENT, а не 401."""

    def handler(request: httpx.Request) -> httpx.Response:
        error = {
            "code": 400,
            "message": "API key not valid. Please pass a valid API key.",
            "status": "INVALID_ARGUMENT",
            "details": [
                {"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "API_KEY_INVALID"}
            ],
        }
        return httpx.Response(**_json(400, {"error": error}))

    def status_for(key: str) -> str:
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        status = asyncio.run(GeminiProvider(SecretStr(key), http_client=client).check())
        assert not status.ok
        return status.message

    base = (
        "Gemini: ключ не принят (401): API key not valid. Please pass a valid API key."
        " Проверьте ключ в backend/.env — см. docs/api_keys.md."
    )
    assert status_for("AIza" + "x" * 35) == base
    # Частая ошибка — вставить ID проекта AI Studio вместо ключа: подсказка, куда смотреть.
    assert status_for("gen-lang-client-0123456789").startswith(base)
    assert "возможно, там ID проекта" in status_for("gen-lang-client-0123456789")


# --- картинка Gemini (M5.3) -----------------------------------------------------------------------

PNG = b"\x89PNG\r\n\x1a\n" + b"final image"
ANCHORS = Route(
    stage="anchors",
    key="nb-pro-1k",
    kind="image",
    provider="gemini",
    model="gemini-3-pro-image",
    params={"size": "1K"},
    max_refs=14,
)
CUP = ImageRequest(prompt="a clay cup on grey", negative="text, watermark", seed=7)


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def image_part(data: bytes, mime: str = "image/png", thought: bool = False) -> dict[str, Any]:
    part: dict[str, Any] = {"inlineData": {"mimeType": mime, "data": b64(data)}}
    if thought:
        part["thought"] = True
    return part


def candidate(*parts: dict[str, Any], finish: str = "STOP", **extra: Any) -> dict[str, Any]:
    return {
        "candidates": [
            {"content": {"role": "model", "parts": list(parts)}, "finishReason": finish, **extra}
        ]
    }


def draw(
    handler: Any,
    request: ImageRequest = CUP,
    refs: list[RefImage] | None = None,
    key: SecretStr = KEY,
) -> Result:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = GeminiProvider(key, http_client=client)
    return asyncio.run(provider.call(ANCHORS, request, refs or []))


def test_gemini_image_request_and_final_image() -> None:
    """Текст с negative, референсы байтами, размер маршрута, seed и стороны; «thought images»
    режима размышления не берутся и не оплачиваются."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        body = candidate(
            image_part(b"thought", thought=True), {"text": "Here it is."}, image_part(PNG)
        )
        return httpx.Response(**_json(200, body))

    ref = RefImage(data=b"\x89PNG\r\n\x1a\nref", mime_type="image/png")
    request = CUP.model_copy(update={"aspect_ratio": "3:4"})
    result = draw(handler, request, [ref])

    assert (result.data, result.ext, result.meta) == (PNG, "png", {"mime_type": "image/png"})
    assert result.usage == [Usage(unit="image", quantity=1)]
    [sent] = seen
    assert sent.url.path.endswith("/models/gemini-3-pro-image:generateContent")
    body = json.loads(sent.content)
    [content] = body["contents"]
    assert content["parts"][0] == {"text": "a clay cup on grey\n\nAvoid: text, watermark"}
    assert content["parts"][1]["inlineData"]["data"] == b64(ref.data)
    assert body["generationConfig"] == {
        "seed": 7,
        "responseModalities": ["IMAGE"],
        "imageConfig": {"aspectRatio": "3:4", "imageSize": "1K"},
    }


def test_gemini_image_without_negative_sends_prompt_as_is() -> None:
    sent: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return httpx.Response(**_json(200, candidate(image_part(PNG, "image/jpeg"))))

    result = draw(handler, ImageRequest(prompt="a cup"))
    assert sent[0]["contents"][0]["parts"] == [{"text": "a cup"}]
    assert "seed" not in sent[0]["generationConfig"]
    assert result.ext == "jpg"


def test_gemini_image_error_meaning_is_in_body() -> None:
    """L-018: смысл — в теле ответа; 400 не повторяется."""

    def handler(request: httpx.Request) -> httpx.Response:
        error = {
            "code": 400,
            "message": "Too many images in the request: 15, the maximum is 14.",
            "status": "INVALID_ARGUMENT",
        }
        return httpx.Response(**_json(400, {"error": error}))

    with pytest.raises(ProviderError) as caught:
        draw(handler)
    assert str(caught.value) == (
        "Gemini: запрос отклонён (400): Too many images in the request: 15, the maximum is 14"
    )
    assert caught.value.status_code == 400
    assert not is_retryable(caught.value)


@pytest.mark.parametrize(
    ("status", "kind"), [(429, RateLimited), (503, TransientError), (500, TransientError)]
)
def test_gemini_image_retryable_statuses(status: int, kind: type[Exception]) -> None:
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        error = {"code": status, "message": "busy", "status": "UNAVAILABLE"}
        return httpx.Response(**_json(status, {"error": error}, **{"Retry-After": "5"}))

    with pytest.raises(kind) as caught:
        draw(handler)
    assert is_retryable(caught.value)
    assert calls == [1]  # SDK сам не повторяет
    if status == 429:
        assert retry_after_s(caught.value) == 5


def test_gemini_image_network_is_transient() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    with pytest.raises(TransientError, match="нет соединения"):
        draw(handler)


def test_network_error_names_the_exception_when_its_text_is_empty() -> None:
    """Вживую (M5.4) обрыв через VPN пришёл с пустым текстом: «нет соединения:» без причины."""

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadError("")

    with pytest.raises(TransientError) as caught:
        draw(handler)
    assert str(caught.value) == "Gemini: нет соединения (ReadError)"


@pytest.mark.parametrize(
    ("body", "message"),
    [
        (
            # `finishMessage` SDK (google-genai 2.25, Gemini Developer API) при разборе отбрасывает:
            # причина — только код `finishReason`.
            candidate(finish="IMAGE_SAFETY", finishMessage="Unable to show the generated image."),
            "Gemini не нарисовал картинку (IMAGE_SAFETY) — сработал фильтр безопасности — уберите"
            " из промпта насилие, кровь и другие острые детали.",
        ),
        (
            {
                "promptFeedback": {
                    "blockReason": "IMAGE_SAFETY",
                    "blockReasonMessage": "The prompt could not be submitted.",
                }
            },
            "Gemini не нарисовал картинку (IMAGE_SAFETY): The prompt could not be submitted —"
            " сработал фильтр безопасности — уберите из промпта насилие, кровь и другие острые"
            " детали.",
        ),
        (
            # Категория фильтра, если модель её назвала (`safetyRatings` с `blocked`, M6.2):
            # что смягчить в действии кадра. Незаблокированные категории не называются.
            candidate(
                finish="IMAGE_SAFETY",
                safetyRatings=[
                    {
                        "category": "HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT",
                        "probability": "HIGH",
                        "blocked": True,
                    },
                    {"category": "HARM_CATEGORY_HARASSMENT", "probability": "NEGLIGIBLE"},
                ],
            ),
            "Gemini не нарисовал картинку (IMAGE_SAFETY) — сработал фильтр безопасности: насилие и"
            " опасные действия — смягчите действие кадра.",
        ),
        (
            {
                "promptFeedback": {
                    "blockReason": "SAFETY",
                    "safetyRatings": [
                        {
                            "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                            "probability": "MEDIUM",
                            "blocked": True,
                        },
                        {
                            "category": "HARM_CATEGORY_DANGEROUS_CONTENT",
                            "probability": "HIGH",
                            "blocked": True,
                        },
                    ],
                }
            },
            "Gemini не нарисовал картинку (SAFETY) — сработал фильтр безопасности: откровенное"
            " содержание, насилие и опасные действия — смягчите действие кадра.",
        ),
        (
            {"promptFeedback": {"blockReason": "PROHIBITED_CONTENT"}},
            "Gemini не нарисовал картинку (PROHIBITED_CONTENT) — запрещённое содержание —"
            " перепишите промпт кадра.",
        ),
        (
            candidate({"text": "I can only describe it."}, finish="NO_IMAGE"),
            "Gemini не нарисовал картинку (NO_IMAGE) — модель не вернула картинку — повторите"
            " или упростите промпт.",
        ),
        (
            candidate(image_part(b"thought", thought=True)),
            "Gemini не нарисовал картинку (STOP) — модель не вернула картинку — повторите или"
            " упростите промпт.",
        ),
    ],
)
def test_gemini_content_refusal_is_clear_and_not_retried(
    body: dict[str, Any], message: str
) -> None:
    with pytest.raises(ProviderError) as caught:
        draw(lambda request: httpx.Response(**_json(200, body)))
    assert str(caught.value) == message
    assert not is_retryable(caught.value)


def test_gemini_image_without_key_and_video_without_network() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("без ключа и для видео сеть не нужна")

    with pytest.raises(ProviderError, match="GEMINI_API_KEY не задан"):
        draw(handler, key=NO_KEY)
    video = VideoRequest(prompt="sway", start_frame="abc", seconds=4)
    with pytest.raises(NotImplementedError, match="M8"):
        asyncio.run(GeminiProvider(KEY).call(ANCHORS, video))


# --- вопрос о картинке Gemini (M6.6) ------------------------------------------------------------

CHECK = Route(
    stage="check",
    key="flash-lite",
    kind="vision",
    provider="gemini",
    model="gemini-3.5-flash-lite",
    params={"media_resolution": "low", "thinking_level": "minimal", "max_output_tokens": 256},
)
SCHEMA = {
    "type": "object",
    "properties": {"found": {"type": "array", "items": {"type": "string"}}},
    "required": ["found"],
}
ASK = VisionRequest(
    prompt="Name forbidden items.",
    image=ImageRef(path="projects/cursus/e/media/s001/thumbs/v001-320.webp", sha256="0" * 64),
    response_schema=SCHEMA,
    max_output_tokens=256,
)
THUMB = RefImage(data=b"RIFF\x00\x00\x00\x00WEBPthumb", mime_type="image/webp")


def ask(handler: Any, refs: list[RefImage] | None = None, key: SecretStr = KEY) -> Result:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = GeminiProvider(key, http_client=client)
    return asyncio.run(provider.call(CHECK, ASK, [THUMB] if refs is None else refs))


def test_gemini_vision_asks_for_json_and_charges_actual_tokens() -> None:
    """Текст и картинка, ответ JSON по схеме; разрешение, рассуждение и лимит — из маршрута;
    расход — по `usageMetadata`: выход вместе с размышлением, части размышления не берутся."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        body = {
            "candidates": [
                {
                    "content": {
                        "role": "model",
                        "parts": [
                            {"text": "thinking about it", "thought": True},
                            {"text": '{"found": ["wristwatches"]}'},
                        ],
                    },
                    "finishReason": "STOP",
                }
            ],
            "usageMetadata": {
                "promptTokenCount": 612,
                "candidatesTokenCount": 9,
                "thoughtsTokenCount": 40,
                "totalTokenCount": 661,
            },
        }
        return httpx.Response(**_json(200, body))

    result = ask(handler)
    assert (result.data, result.ext, result.meta) == (
        b'{"found": ["wristwatches"]}',
        "json",
        {"finish": "STOP"},
    )
    assert result.usage == [
        Usage(unit="token_in", quantity=612),
        Usage(unit="token_out", quantity=49),
    ]
    [sent] = seen
    assert sent.url.path.endswith("/models/gemini-3.5-flash-lite:generateContent")
    body = json.loads(sent.content)
    [content] = body["contents"]
    assert content["parts"][0] == {"text": "Name forbidden items."}
    inline = content["parts"][1]["inlineData"]
    # SDK пишет тип snake_case (`mime_type`), API принимает оба написания.
    assert (inline["data"], inline.get("mimeType", inline.get("mime_type"))) == (
        b64(THUMB.data),
        "image/webp",
    )
    config = body["generationConfig"]
    # Вложенное поле SDK 2.25 пишет snake_case — API принимает оба написания (живой тест).
    assert config.pop("thinkingConfig") in (
        {"thinkingLevel": "MINIMAL"},
        {"thinking_level": "MINIMAL"},
    )
    assert config == {
        "responseMimeType": "application/json",
        "responseJsonSchema": SCHEMA,
        "maxOutputTokens": 256,
        "mediaResolution": "MEDIA_RESOLUTION_LOW",
    }


def test_gemini_vision_estimate_counts_image_by_media_resolution() -> None:
    usage = GeminiProvider(KEY).usage(CHECK, ASK)
    text = ASK.prompt + json.dumps(SCHEMA, sort_keys=True)
    assert usage == [
        Usage(unit="token_in", quantity=-(-len(text) // 3) + 280),
        Usage(unit="token_out", quantity=256),
    ]
    high = CHECK.model_copy(update={"params": {"media_resolution": "high"}})
    assert GeminiProvider(KEY).usage(high, ASK)[0].quantity == -(-len(text) // 3) + 1120


@pytest.mark.parametrize(
    ("body", "message"),
    [
        (
            {"promptFeedback": {"blockReason": "SAFETY"}},
            "Gemini не ответил на вопрос о картинке (SAFETY) — перепроверьте кадр позже.",
        ),
        (
            {"candidates": [{"content": {"role": "model", "parts": []}, "finishReason": "OTHER"}]},
            "Gemini не ответил на вопрос о картинке (OTHER) — перепроверьте кадр позже.",
        ),
    ],
)
def test_gemini_vision_without_answer_is_a_refusal(body: dict[str, Any], message: str) -> None:
    with pytest.raises(ProviderError) as caught:
        ask(lambda request: httpx.Response(**_json(200, body)))
    assert str(caught.value) == message
    assert not is_retryable(caught.value)


def test_gemini_vision_errors_and_wrong_image_count() -> None:
    with pytest.raises(ProviderError, match=r"запрос отклонён \(400\): bad schema"):
        ask(
            lambda r: httpx.Response(
                **_json(
                    400,
                    {"error": {"code": 400, "message": "bad schema", "status": "INVALID_ARGUMENT"}},
                )
            )
        )
    with pytest.raises(TransientError):
        ask(lambda r: httpx.Response(**_json(503, {"error": {"code": 503, "message": "busy"}})))

    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("без картинки и без ключа сеть не нужна")

    with pytest.raises(RouteError, match="ровно одна картинка"):
        ask(handler, refs=[])
    with pytest.raises(ProviderError, match="GEMINI_API_KEY не задан"):
        ask(handler, key=NO_KEY)


def test_elevenlabs_missing_permission_reads_as_no_access() -> None:
    """Верный ключ без права `user_read` ElevenLabs отвечает 401 missing_permissions."""

    def handler(request: httpx.Request) -> httpx.Response:
        detail = {
            "status": "missing_permissions",
            "message": "The API key you used is missing the permission user_read.",
        }
        return httpx.Response(**_json(401, {"detail": detail}))

    status = asyncio.run(ElevenLabsProvider(KEY, transport=httpx.MockTransport(handler)).check())
    assert "нет доступа (403): missing_permissions" in status.message
    assert "user_read. Проверьте права ключа" in status.message


class CountingProvider:
    """Считает проверки ключа — для кэша `GET /api/providers/status`."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.checks = 0

    async def check(self, expected_models: Any = ()) -> KeyStatus:
        self.checks += 1
        quota = CharQuota(tier="creator", used_chars=1, limit_chars=10, resets_at=None)
        return KeyStatus(provider=self.name, configured=True, ok=True, message="ok", quota=quota)


def test_providers_status_endpoint_caches_and_refreshes(app: FastAPI) -> None:
    gateway: Gateway = app.state.gateway
    fakes = {name: CountingProvider(name) for name in ("anthropic", "gemini", "elevenlabs")}
    gateway.registry.providers.update(fakes)  # type: ignore[arg-type]
    with TestClient(app) as client:
        first = client.get("/api/providers/status").json()
        assert [s["provider"] for s in first] == ["anthropic", "elevenlabs", "gemini"]
        assert first[1]["quota"]["limit_chars"] == 10
        client.get("/api/providers/status")  # из памяти, без запросов к провайдерам
        assert [f.checks for f in fakes.values()] == [1, 1, 1]
        client.get("/api/providers/status", params={"refresh": "true"})
        assert [f.checks for f in fakes.values()] == [2, 2, 2]
