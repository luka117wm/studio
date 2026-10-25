"""Google Gemini: картинки (`models.generate_content`), вопросы о картинке с ответом JSON (M6.6)
и проверка ключа; анимация Veo — M8.

Картинка: текст промпта, затем референсы байтами; отдельного negative у моделей Gemini нет, он
идёт в текст фразой `Avoid: …` (`docs/providers.md`, «Картинки Gemini»). Размер — `params.size`
маршрута, соотношение сторон и seed — из запроса. Промежуточные «thought images» режима
размышления не берутся и не оплачиваются — только итоговая картинка. Отказ по содержанию —
`ProviderError` с понятным текстом, очередь его не повторяет.

Вопрос о картинке (`VisionRequest`): текст и картинка, ответ строго JSON по схеме
(`response_mime_type`, `response_json_schema`); разрешение картинки и уровень размышления — из
параметров маршрута (`media_resolution`, `thinking_level`). Расход — по `usage_metadata` ответа:
вход, выход вместе с размышлением.

Клиент без собственных повторов (`HttpRetryOptions(attempts=1)`): повторяет очередь.
"""

import json
from collections.abc import Collection, Sequence

import httpx
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import SecretStr

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
    VisionRequest,
    image_mime,
    network_error,
    parse_retry_after,
    request_usage,
    status_error,
    vision_usage,
)

TITLE = "Gemini"
CHECK_TIMEOUT_MS = 30_000
# Картинка Pro с размышлением идёт десятки секунд; дольше — сбой сети, его повторит очередь.
CALL_TIMEOUT_MS = 180_000
# Вопрос о картинке у Flash-Lite — секунды; дольше — сбой сети.
VISION_TIMEOUT_MS = 60_000
# Токенов на картинку у моделей Gemini 3 по `media_resolution` (ai.google.dev, «Media
# resolution», 2026-10-25); без параметра — по умолчанию, 1120.
_IMAGE_TOKENS: dict[str, int] = {"low": 280, "medium": 560, "high": 1120}
_DEFAULT_IMAGE_TOKENS = 1120
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
# Категория фильтра (`safetyRatings` с `blocked`), если модель её назвала: что смягчить в кадре.
_SAFETY_WITH_CATEGORY = "сработал фильтр безопасности: {category} — смягчите действие кадра"
_CATEGORIES: dict[str, str] = {
    "HARM_CATEGORY_DANGEROUS_CONTENT": "насилие и опасные действия",
    "HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT": "насилие и опасные действия",
    "HARM_CATEGORY_HARASSMENT": "травля и унижение",
    "HARM_CATEGORY_IMAGE_HARASSMENT": "травля и унижение",
    "HARM_CATEGORY_HATE_SPEECH": "вражда к группам людей",
    "HARM_CATEGORY_IMAGE_HATE": "вражда к группам людей",
    "HARM_CATEGORY_SEXUALLY_EXPLICIT": "откровенное содержание",
    "HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT": "откровенное содержание",
    "HARM_CATEGORY_CIVIC_INTEGRITY": "выборы и политика",
}


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: SecretStr, *, http_client: httpx.AsyncClient | None = None) -> None:
        self._api_key = api_key
        self._http_client = http_client  # тесты подменяют транспорт

    def usage(self, route: Route, request: AnyRequest) -> list[Usage]:
        if isinstance(request, VisionRequest):
            return vision_usage(request, _image_tokens(route))
        if not isinstance(request, ImageRequest | VideoRequest):
            raise RouteError(
                f"{TITLE} принимает кадры, видео и вопросы о картинке, а не «{request.kind}»."
            )
        return request_usage(request)

    async def call(
        self, route: Route, request: AnyRequest, refs: Sequence[RefImage] = ()
    ) -> Result:
        """Одна картинка: байты итогового изображения и `usage` — по картинке."""
        if isinstance(request, VideoRequest):
            raise NotImplementedError("Анимация Veo — модуль анимации (M8).")
        if isinstance(request, VisionRequest):
            return await self._ask(route, request, refs)
        if not isinstance(request, ImageRequest):
            raise RouteError(
                f"{TITLE} принимает кадры, видео и вопросы о картинке, а не «{request.kind}»."
            )
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
            raise network_error(TITLE, exc) from None
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

    async def _ask(self, route: Route, request: VisionRequest, refs: Sequence[RefImage]) -> Result:
        """Вопрос о картинке: ответ — текст JSON по схеме; расход — по `usage_metadata`."""
        if len(refs) != 1:
            raise RouteError(
                f"{TITLE}: в вопросе о картинке ровно одна картинка, а пришло {len(refs)}."
            )
        key = self._api_key.get_secret_value()
        if not key:
            raise ProviderError(f"{TITLE}: {NO_KEY}")
        client = self._client(key, VISION_TIMEOUT_MS)
        try:
            response = await client.models.generate_content(
                model=route.model,
                contents=[
                    types.Content(
                        role="user",
                        parts=[
                            types.Part.from_text(text=request.prompt),
                            types.Part.from_bytes(data=refs[0].data, mime_type=refs[0].mime_type),
                        ],
                    )
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_json_schema=request.response_schema or None,
                    max_output_tokens=request.max_output_tokens,
                    media_resolution=_media_resolution(route),
                    thinking_config=_thinking(route),
                    automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                ),
            )
        except genai_errors.APIError as exc:
            raise _api_error(exc) from None
        except httpx.TransportError as exc:
            raise network_error(TITLE, exc) from None
        finally:
            await client.aclose()
        text = _answer_text(response)
        meta = response.usage_metadata
        if meta is None or meta.prompt_token_count is None:
            usage = vision_usage(request, _image_tokens(route))  # счёта нет — по оценке, сверху
        else:
            out = (meta.candidates_token_count or 0) + (meta.thoughts_token_count or 0)
            usage = [
                Usage(unit="token_in", quantity=meta.prompt_token_count),
                Usage(unit="token_out", quantity=out),
            ]
        candidate = response.candidates[0] if response.candidates else None
        finish = _name(candidate.finish_reason) if candidate and candidate.finish_reason else None
        return Result(usage=usage, data=text.encode("utf-8"), ext="json", meta={"finish": finish})

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
            error = network_error(TITLE, exc)
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


def _image_tokens(route: Route) -> int:
    value = route.params.get("media_resolution")
    return _IMAGE_TOKENS.get(str(value), _DEFAULT_IMAGE_TOKENS) if value else _DEFAULT_IMAGE_TOKENS


def _media_resolution(route: Route) -> types.MediaResolution | None:
    value = route.params.get("media_resolution")
    return None if not value else types.MediaResolution(f"MEDIA_RESOLUTION_{str(value).upper()}")


def _thinking(route: Route) -> types.ThinkingConfig | None:
    value = route.params.get("thinking_level")
    return (
        None
        if not value
        else types.ThinkingConfig(thinking_level=types.ThinkingLevel(str(value).upper()))
    )


def _answer_text(response: types.GenerateContentResponse) -> str:
    """Итоговый текст ответа без частей размышления; нет текста — отказ с причиной."""
    feedback = response.prompt_feedback
    if feedback is not None and feedback.block_reason is not None:
        raise _no_answer(_name(feedback.block_reason), feedback.block_reason_message)
    candidate = response.candidates[0] if response.candidates else None
    parts = candidate.content.parts if candidate and candidate.content else None
    text = "".join(part.text for part in parts or [] if not part.thought and part.text)
    if text.strip():
        return text
    reason = _name(candidate.finish_reason) if candidate and candidate.finish_reason else None
    raise _no_answer(reason, candidate.finish_message if candidate else None)


def _no_answer(reason: str | None, detail: str | None) -> ProviderError:
    code = f" ({reason})" if reason else ""
    extra = f": {detail.strip().rstrip('.')}" if detail and detail.strip() else ""
    return ProviderError(
        f"{TITLE} не ответил на вопрос о картинке{code}{extra} — перепроверьте кадр позже."
    )


def _final_images(response: types.GenerateContentResponse) -> list[tuple[bytes, str]]:
    """Итоговые картинки ответа без промежуточных «thought images»; нет картинки — отказ
    с причиной из ответа."""
    feedback = response.prompt_feedback
    if feedback is not None and feedback.block_reason is not None:
        raise _refusal(
            _name(feedback.block_reason),
            feedback.block_reason_message,
            _blocked_categories(feedback.safety_ratings),
        )
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
    raise _refusal(
        reason,
        candidate.finish_message if candidate else None,
        _blocked_categories(candidate.safety_ratings if candidate else None),
    )


def _name(value: object) -> str:
    return str(getattr(value, "value", value))


def _blocked_categories(ratings: list[types.SafetyRating] | None) -> list[str]:
    """Категории, по которым фильтр заблокировал ответ, — по-русски, без повторов."""
    names = [
        _CATEGORIES.get(_name(rating.category), "")
        for rating in ratings or []
        if rating.blocked and rating.category is not None
    ]
    return list(dict.fromkeys(name for name in names if name))


def _refusal(reason: str | None, detail: str | None, categories: list[str]) -> ProviderError:
    hint = _REFUSALS.get(reason or "", _NO_IMAGE)
    if categories and hint == _SAFETY:
        hint = _SAFETY_WITH_CATEGORY.format(category=", ".join(categories))
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
