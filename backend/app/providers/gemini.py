"""Google Gemini: картинки (`models.generate_content`) и проверка ключа; анимация Veo — M8.

Картинка: текст промпта, затем референсы байтами; отдельного negative у моделей Gemini нет, он
идёт в текст фразой `Avoid: …` (`docs/providers.md`, «Картинки Gemini»). Размер — `params.size`
маршрута, соотношение сторон и seed — из запроса. Промежуточные «thought images» режима
размышления не берутся и не оплачиваются — только итоговая картинка. Отказ по содержанию —
`ProviderError` с понятным текстом, очередь его не повторяет.

Клиент без собственных повторов (`HttpRetryOptions(attempts=1)`): повторяет очередь.
"""

import json
from collections.abc import Collection, Sequence

import httpx
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import SecretStr

from app.jobs.worker import TransientError
from app.providers.base import (
    AnyRequest,
    ImageRequest,
    KeyStatus,
    ProviderError,
    RefImage,
    Result,
    Route,
    RouteError,
    Usage,
    VideoRequest,
    image_mime,
    parse_retry_after,
    request_usage,
    status_error,
)

TITLE = "Gemini"
CHECK_TIMEOUT_MS = 30_000
# Картинка Pro с размышлением идёт десятки секунд; дольше — сбой сети, его повторит очередь.
CALL_TIMEOUT_MS = 180_000
NO_KEY = "GEMINI_API_KEY не задан в backend/.env — см. docs/api_keys.md."
_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}

# Почему модель не нарисовала картинку (`finishReason`, `promptFeedback.blockReason`) → что сделать.
_SAFETY = "сработал фильтр безопасности — уберите из промпта насилие, кровь и другие острые детали"
_PROHIBITED = "запрещённое содержание — перепишите промпт кадра"
_RECITATION = (
    "похоже на защищённую работу — уберите имена художников, персонажей и брендов из промпта"
)
_REFUSALS: dict[str, str] = {
    "SAFETY": _SAFETY,
    "IMAGE_SAFETY": _SAFETY,
    "PROHIBITED_CONTENT": _PROHIBITED,
    "IMAGE_PROHIBITED_CONTENT": _PROHIBITED,
    "BLOCKLIST": _PROHIBITED,
    "RECITATION": _RECITATION,
    "IMAGE_RECITATION": _RECITATION,
}
_NO_IMAGE = "модель не вернула картинку — повторите или упростите промпт"


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: SecretStr, *, http_client: httpx.AsyncClient | None = None) -> None:
        self._api_key = api_key
        self._http_client = http_client  # тесты подменяют транспорт

    def usage(self, route: Route, request: AnyRequest) -> list[Usage]:
        if not isinstance(request, ImageRequest | VideoRequest):
            raise RouteError(f"{TITLE} принимает кадры и видео, а не «{request.kind}».")
        return request_usage(request)

    async def call(
        self, route: Route, request: AnyRequest, refs: Sequence[RefImage] = ()
    ) -> Result:
        """Одна картинка: байты итогового изображения и `usage` — по картинке."""
        if isinstance(request, VideoRequest):
            raise NotImplementedError("Анимация Veo — модуль анимации (M8).")
        if not isinstance(request, ImageRequest):
            raise RouteError(f"{TITLE} принимает кадры и видео, а не «{request.kind}».")
        key = self._api_key.get_secret_value()
        if not key:
            raise ProviderError(f"{TITLE}: {NO_KEY}")
        client = self._client(key, CALL_TIMEOUT_MS)
        try:
            response = await client.models.generate_content(
                model=route.model,
                contents=[types.Content(role="user", parts=_parts(request, refs))],
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE"],
                    image_config=types.ImageConfig(
                        image_size=route.params.get("size"), aspect_ratio=request.aspect_ratio
                    ),
                    seed=request.seed,
                    # Инструментов нет; иначе SDK пишет в лог совет про автовызов функций.
                    automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                ),
            )
        except genai_errors.APIError as exc:
            raise _api_error(exc) from None
        except httpx.TransportError as exc:
            raise TransientError(f"{TITLE}: нет соединения: {exc}") from None
        finally:
            await client.aclose()
        images = _final_images(response)
        data, mime_type = images[-1]
        return Result(
            usage=[Usage(unit="image", quantity=len(images))],
            data=data,
            ext=_EXT.get(mime_type, "bin"),
            meta={"mime_type": mime_type},
        )

    async def check(self, expected_models: Collection[str] = ()) -> KeyStatus:
        """Список моделей — бесплатно; заодно видно, что модели из конфига доступны ключу."""
        key = self._api_key.get_secret_value()
        if not key:
            return KeyStatus(provider=self.name, configured=False, ok=False, message=NO_KEY)
        client = self._client(key, CHECK_TIMEOUT_MS)
        try:
            pager = await client.models.list(config={"page_size": 1000})
            names = {model.name.removeprefix("models/") async for model in pager if model.name}
        except genai_errors.APIError as exc:
            message = str(_api_error(exc))
            if _status(exc) == 401 and not key.startswith("AIza"):
                message += (
                    " Значение в GEMINI_API_KEY не похоже на ключ Google (он начинается с AIza,"
                    " 39 символов) — возможно, там ID проекта (gen-lang-client-…)."
                )
            return KeyStatus(provider=self.name, configured=True, ok=False, message=message)
        except httpx.TransportError as exc:
            error = TransientError(f"{TITLE}: нет соединения: {exc}")
            return KeyStatus(provider=self.name, configured=True, ok=False, message=str(error))
        finally:
            await client.aclose()
        return KeyStatus(
            provider=self.name,
            configured=True,
            ok=True,
            message=f"ключ принят, моделей доступно: {len(names)}",
            missing_models=sorted(set(expected_models) - names),
        )

    def _client(self, key: str, timeout_ms: int) -> "genai.client.AsyncClient":
        options = types.HttpOptions(
            timeout=timeout_ms,
            retry_options=types.HttpRetryOptions(attempts=1),
            httpx_async_client=self._http_client,
        )
        return genai.Client(api_key=key, http_options=options).aio


def _parts(request: ImageRequest, refs: Sequence[RefImage]) -> list[types.Part]:
    """Текст промпта (с negative фразой `Avoid:`), затем референсы в порядке запроса."""
    text = request.prompt
    if request.negative.strip():
        text = f"{text}\n\nAvoid: {request.negative.strip()}"
    return [
        types.Part.from_text(text=text),
        *(types.Part.from_bytes(data=ref.data, mime_type=ref.mime_type) for ref in refs),
    ]


def _final_images(response: types.GenerateContentResponse) -> list[tuple[bytes, str]]:
    """Итоговые картинки ответа без промежуточных «thought images»; нет картинки — отказ
    с причиной из ответа."""
    feedback = response.prompt_feedback
    if feedback is not None and feedback.block_reason is not None:
        raise _refusal(_name(feedback.block_reason), feedback.block_reason_message)
    candidate = response.candidates[0] if response.candidates else None
    parts = candidate.content.parts if candidate and candidate.content else None
    images = [
        (part.inline_data.data, part.inline_data.mime_type or image_mime(part.inline_data.data))
        for part in parts or []
        if not part.thought and part.inline_data is not None and part.inline_data.data
    ]
    if images:
        return [(data, mime or "application/octet-stream") for data, mime in images]
    reason = _name(candidate.finish_reason) if candidate and candidate.finish_reason else None
    raise _refusal(reason, candidate.finish_message if candidate else None)


def _name(value: object) -> str:
    return str(getattr(value, "value", value))


def _refusal(reason: str | None, detail: str | None) -> ProviderError:
    hint = _REFUSALS.get(reason or "", _NO_IMAGE)
    code = f" ({reason})" if reason else ""
    extra = f": {detail.strip().rstrip('.')}" if detail and detail.strip() else ""
    return ProviderError(f"{TITLE} не нарисовал картинку{code}{extra} — {hint}.")


def _api_error(exc: genai_errors.APIError) -> Exception:
    """Ошибка API → исключение по статусу; смысл — в теле ответа, а не в статусе (L-018)."""
    headers = getattr(exc.response, "headers", None)
    retry_after = parse_retry_after(headers.get("retry-after") if headers else None)
    return status_error(TITLE, _status(exc), exc.message or str(exc), retry_after)


def _status(exc: genai_errors.APIError) -> int:
    """Неверный ключ Gemini отвечает 400 INVALID_ARGUMENT (reason API_KEY_INVALID), а не 401."""
    if exc.code == 400 and "API_KEY_INVALID" in json.dumps(exc.details, default=str):
        return 401
    return exc.code
