"""Фейковый провайдер для тестов: без сети, результат детерминирован входами, цена — по прайсу.

Маршрутизируется как любой другой (`provider: fake` в конфиге), поэтому тесты гоняют через него
весь путь gateway: оценку, бюджет, журнал, кэш. В `config/providers.yaml` его нет.
"""

import hashlib
from collections.abc import Collection, Sequence

import cv2
import numpy as np

from app.providers.base import (
    AnyRequest,
    KeyStatus,
    RefImage,
    Result,
    Route,
    Usage,
    request_usage,
)

_EXT = {"text": "txt", "image": "png", "speech": "mp3", "video": "mp4", "vision": "json"}
# Ответ на вопрос о картинке по умолчанию (M6.6): ничего из списка не видно.
NOTHING_FOUND = '{"found": []}'
# Картинка-ответ: настоящий PNG 16:9 (по нему строятся миниатюры версии кадра, M6.2).
IMAGE_SIZE = (64, 36)


class FakeProvider:
    name = "fake"

    def __init__(self) -> None:
        self.calls: list[tuple[Route, AnyRequest]] = []
        self.refs: list[list[RefImage]] = []  # байты референсов каждого вызова
        self.errors: list[Exception] = []  # следующий вызов бросит первое из них
        # Ответы на вопросы о картинке (M6.6) по очереди; кончились — `NOTHING_FOUND`.
        self.answers: list[str] = []

    def usage(self, route: Route, request: AnyRequest) -> list[Usage]:
        return request_usage(request)

    async def call(
        self, route: Route, request: AnyRequest, refs: Sequence[RefImage] = ()
    ) -> Result:
        self.calls.append((route, request))
        self.refs.append(list(refs))
        if self.errors:
            raise self.errors.pop(0)
        seed = f"{route.model}\n{request.model_dump_json()}".encode()
        data = hashlib.sha256(seed).digest() * 4
        if request.kind == "vision":
            data = (self.answers.pop(0) if self.answers else NOTHING_FOUND).encode("utf-8")
        elif request.kind == "image":
            # Настоящий PNG: его шлюз примет референсом (фас листа, M5.4), а версия кадра
            # построит миниатюры (M6.2). Пиксели — от входов: другой запрос — другие байты.
            data = _png(data)
        return Result(usage=request_usage(request), data=data, ext=_EXT[request.kind])

    async def check(self, expected_models: Collection[str] = ()) -> KeyStatus:
        return KeyStatus(
            provider=self.name, configured=True, ok=True, message="ключ не нужен (тестовый)"
        )


def _png(digest: bytes) -> bytes:
    width, height = IMAGE_SIZE
    pixels = np.resize(np.frombuffer(digest, dtype=np.uint8), (height, width, 3))
    ok, encoded = cv2.imencode(".png", pixels)
    assert ok, "cv2 could not encode a PNG"
    return encoded.tobytes()
