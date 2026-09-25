"""Контракт провайдера: запросы, маршрут, единицы учёта, цена, результат, ошибки, проверка ключа.

Провайдер переводит запрос в единицы учёта (`usage`) и ходит в свой API; деньги из единиц
считает только `cost/pricing.py` (L-001) — одной функцией и для оценки до вызова, и для факта
после. ID модели провайдер получает из маршрута (`Route`), своих не держит (принцип 5).
Повторов внутри провайдера нет: SDK без ретраев, повторяет только очередь джобов — иначе
3 попытки очереди × 3 попытки SDK (`docs/jobs.md`, «Ретраи»).
"""

import math
from collections.abc import Collection
from dataclasses import dataclass, field
from typing import Annotated, Any, Literal, Protocol

from pydantic import BaseModel, Field

from app.jobs.worker import TransientError
from app.models.director import StrictModel

Unit = Literal["image", "char", "second", "token_in", "token_out", "search"]
RequestKind = Literal["text", "image", "speech", "video"]

# Какие единицы обязательно тратит запрос каждого вида (цена на них проверяется при старте).
# `search` у текста — только когда запрос разрешает поиск и у модели есть цена поиска.
UNITS_BY_KIND: dict[RequestKind, tuple[Unit, ...]] = {
    "text": ("token_in", "token_out"),
    "image": ("image",),
    "speech": ("char",),
    "video": ("second",),
}
# Параметр маршрута, который выбирает вариант цены, если цена единицы задана вариантами.
VARIANT_PARAM: dict[Unit, str] = {"image": "size", "second": "resolution"}

# Оценка токенов без сети: ≈ 4 символа английского текста на токен, новый токенизатор Claude
# даёт на ~30 % больше токенов — отсюда 3. Выход — по `max_output_tokens`, верхняя граница.
CHARS_PER_TOKEN = 3


class ConfigError(Exception):
    """Ошибка `config/providers.yaml` или `config/pricing.yaml`: приложение не стартует."""


class RouteError(ValueError):
    """Этап или модель не из каталога, запрос не того вида — ошибка вызывающего (422)."""


# --- запросы: только входы, от которых зависит результат (они же — хэш кэша, принцип 8) ------


class TextRequest(StrictModel):
    kind: Literal["text"] = "text"
    system: str = ""
    prompt: str = Field(min_length=1)
    max_output_tokens: int = Field(gt=0)
    max_searches: int = Field(default=0, ge=0)


class ImageRequest(StrictModel):
    kind: Literal["image"] = "image"
    prompt: str = Field(min_length=1)  # итоговый промпт от prompt_builder (принцип 13)
    negative: str = ""
    # Версии канона (стиль, эпоха, облики): смена версии — другой хэш, кадр не из кэша.
    canon: dict[str, str] = Field(default_factory=dict)
    refs: list[str] = Field(default_factory=list)  # опорные портреты и кадры стиля: хэши файлов
    seed: int | None = None


class SpeechRequest(StrictModel):
    kind: Literal["speech"] = "speech"
    text: str = Field(min_length=1)
    voice_id: str = Field(min_length=1)
    settings: dict[str, Any] = Field(default_factory=dict)


class VideoRequest(StrictModel):
    kind: Literal["video"] = "video"
    prompt: str = Field(min_length=1)
    start_frame: str = Field(min_length=1)  # хэш исходного кадра
    seconds: float = Field(gt=0)


AnyRequest = TextRequest | ImageRequest | SpeechRequest | VideoRequest
ProviderRequest = Annotated[AnyRequest, Field(discriminator="kind")]


class Route(BaseModel):
    """Куда идёт вызов этапа: элемент каталога из `config/providers.yaml`."""

    stage: str
    key: str  # ключ в каталоге этапа
    kind: RequestKind
    provider: str
    model: str
    params: dict[str, Any] = Field(default_factory=dict)


# --- единицы, цена, результат ------------------------------------------------------------------


class Usage(BaseModel):
    unit: Unit
    quantity: float = Field(ge=0)


class CostLine(BaseModel):
    unit: Unit
    quantity: float
    variant: str | None = None
    usd_micro: int


class Cost(BaseModel):
    """Цена вызова: оценка до постановки или факт после. Строку для кнопки собирает фронт."""

    stage: str
    provider: str
    model: str
    lines: list[CostLine]
    usd_micro: int
    # Цена модели проверялась дольше `pricing_stale_days` назад — сверить `config/pricing.yaml`.
    stale_pricing: bool = False


@dataclass(frozen=True)
class Result:
    usage: list[Usage]  # фактический расход — по нему строка журнала `charged`
    data: bytes | None = None  # файл результата; кладёт в `media/` gateway, не провайдер
    ext: str | None = None
    meta: dict[str, Any] = field(default_factory=dict)


def estimate_tokens(text: str) -> int:
    return math.ceil(len(text) / CHARS_PER_TOKEN)


def request_usage(request: AnyRequest) -> list[Usage]:
    """Единицы запроса по его виду — оценка до вызова; факт возвращает провайдер в `Result`."""
    if isinstance(request, TextRequest):
        usage = [
            Usage(unit="token_in", quantity=estimate_tokens(request.system + request.prompt)),
            Usage(unit="token_out", quantity=request.max_output_tokens),
        ]
        if request.max_searches:
            usage.append(Usage(unit="search", quantity=request.max_searches))
        return usage
    if isinstance(request, ImageRequest):
        return [Usage(unit="image", quantity=1)]
    if isinstance(request, SpeechRequest):
        return [Usage(unit="char", quantity=len(request.text))]
    return [Usage(unit="second", quantity=request.seconds)]


# --- проверка ключа ----------------------------------------------------------------------------


class CharQuota(BaseModel):
    """Пакет символов ElevenLabs — один на аккаунт и общий для голоса и видео."""

    tier: str | None
    used_chars: int
    limit_chars: int
    resets_at: str | None  # ISO 8601 UTC

    @property
    def remaining_chars(self) -> int:
        return max(self.limit_chars - self.used_chars, 0)


class KeyStatus(BaseModel):
    provider: str
    configured: bool  # ключ задан в `backend/.env`
    ok: bool  # провайдер принял ключ
    message: str
    # Модели из `config/providers.yaml`, которых провайдер не отдаёт этому ключу.
    missing_models: list[str] = Field(default_factory=list)
    quota: CharQuota | None = None


# --- ошибки -------------------------------------------------------------------------------------


class ProviderError(Exception):
    """Отказ провайдера, который повтор не исправит (4xx): по `status_code` очередь его не
    повторяет. Текст — для пользователя: что случилось и что сделать."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class RateLimited(TransientError):
    """429: очередь повторит вызов не раньше `retry_after` секунд, если провайдер их назвал."""

    status_code = 429

    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


def parse_retry_after(value: str | None) -> float | None:
    """`Retry-After` в секундах; дату вместо секунд наши провайдеры не шлют — тогда None."""
    if value is None:
        return None
    try:
        seconds = float(value)
    except ValueError:
        return None
    return seconds if seconds >= 0 else None


def status_error(
    title: str, status: int, detail: str, retry_after: float | None = None
) -> Exception:
    """HTTP-статус провайдера → исключение с понятным текстом и правильным поведением очереди."""
    detail = detail.strip().rstrip(".") or "без подробностей"
    if status == 429:
        when = f" через {retry_after:.0f} с" if retry_after is not None else ""
        return RateLimited(
            f"{title}: слишком много запросов (429). Очередь повторит вызов{when}; если"
            " повторяется — уменьшите JOB_WORKERS.",
            retry_after,
        )
    if status >= 500:
        return TransientError(f"{title}: сбой на стороне провайдера ({status}): {detail}")
    if status == 401:
        message = f"ключ не принят (401): {detail}. Проверьте ключ в backend/.env"
    elif status == 402:
        message = f"нужна оплата или тариф выше (402): {detail}. Пополните баланс или смените тариф"
    elif status == 403:
        message = f"нет доступа (403): {detail}. Проверьте права ключа и биллинг"
    else:
        return ProviderError(f"{title}: запрос отклонён ({status}): {detail}", status)
    return ProviderError(f"{title}: {message} — см. docs/api_keys.md.", status)


class Provider(Protocol):
    """Провайдер модели. `usage` — без сети; `call` и `check` — один запрос, без повторов."""

    name: str

    def usage(self, route: Route, request: ProviderRequest) -> list[Usage]: ...

    async def call(self, route: Route, request: ProviderRequest) -> Result: ...

    async def check(self, expected_models: Collection[str] = ()) -> KeyStatus: ...
