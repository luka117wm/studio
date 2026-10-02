"""Ошибка ответа чата: что не так и что попросить у чата. Контракт — `docs/bridge.md`.

Одна форма на все задачи моста: разбор JSON (`extract.py`) и проверка схемой задачи (M4.2). API
отдаёт её как `BridgeError` со статусом 422.
"""

from pydantic import BaseModel


class BridgeIssue(BaseModel):
    """Одна ошибка внутри ответа: где (`shots[3].image.prompt`, `s012`) и что не так."""

    path: str
    message: str


class BridgeError(BaseModel):
    """Тело ответа 422 на неверный ответ чата. Тексты — для пользователя, по-русски."""

    message: str
    hint: str
    errors: list[BridgeIssue] = []


class BridgeAnswerError(Exception):
    """Ответ чата не принят. `line`/`column` — место в исходном тексте ответа, если оно известно."""

    def __init__(
        self,
        message: str,
        hint: str,
        errors: list[BridgeIssue] | None = None,
        *,
        line: int | None = None,
        column: int | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.hint = hint
        self.errors = errors or []
        self.line = line
        self.column = column

    def to_model(self) -> BridgeError:
        return BridgeError(message=self.message, hint=self.hint, errors=self.errors)
