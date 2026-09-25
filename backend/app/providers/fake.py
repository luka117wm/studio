"""Фейковый провайдер для тестов: без сети, результат детерминирован входами, цена — по прайсу.

Маршрутизируется как любой другой (`provider: fake` в конфиге), поэтому тесты гоняют через него
весь путь gateway: оценку, бюджет, журнал, кэш. В `config/providers.yaml` его нет.
"""

import hashlib
from collections.abc import Collection

from app.providers.base import (
    AnyRequest,
    KeyStatus,
    Result,
    Route,
    Usage,
    request_usage,
)

_EXT = {"text": "txt", "image": "png", "speech": "mp3", "video": "mp4"}


class FakeProvider:
    name = "fake"

    def __init__(self) -> None:
        self.calls: list[tuple[Route, AnyRequest]] = []
        self.errors: list[Exception] = []  # следующий вызов бросит первое из них

    def usage(self, route: Route, request: AnyRequest) -> list[Usage]:
        return request_usage(request)

    async def call(self, route: Route, request: AnyRequest) -> Result:
        self.calls.append((route, request))
        if self.errors:
            raise self.errors.pop(0)
        seed = f"{route.model}\n{request.model_dump_json()}".encode()
        data = hashlib.sha256(seed).digest() * 4
        return Result(usage=request_usage(request), data=data, ext=_EXT[request.kind])

    async def check(self, expected_models: Collection[str] = ()) -> KeyStatus:
        return KeyStatus(
            provider=self.name, configured=True, ok=True, message="ключ не нужен (тестовый)"
        )
