"""Из вставленного ответа чата — ровно один JSON-объект или понятная ошибка по-русски.

Порядок (`docs/bridge.md`, «Разбор ответа»):
1. Блоки кода. Берутся блоки ```json; если таких нет — блоки ``` без языка, начинающиеся с `{`.
   Два таких блока и больше — ошибка. Блоки на других языках пропускаются.
2. Блока нет — первый сбалансированный `{…}` в тексте; скобки внутри строк и экранирование
   учитываются.
3. Скобки не закрылись до конца — ответ обрезан, ошибка с номером последней строки.
4. Разбор — стандартный `json`; позиция ошибки пересчитывается в строку и столбец исходного
   ответа. `NaN`/`Infinity` — не JSON, ошибка.

Ничего не чинится: ни запятые, ни кавычки. Неверный ответ — ошибка с подсказкой, что попросить
у чата.
"""

import json
import re
from dataclasses import dataclass
from typing import Any, NoReturn

from app.pipeline.bridge.errors import BridgeAnswerError

_FENCE = re.compile(r"^[ \t]*```[ \t]*([A-Za-z0-9_+-]*)[ \t]*$")
_JSON_LANGS = {"json"}

HINT_ONE_BLOCK = "Попросите чат прислать JSON целиком одним блоком ```json."
HINT_CONTINUE = (
    "Напишите чату «continue», склейте продолжение с ответом и вставьте целиком —"
    " или запросите часть поменьше."
)
HINT_FIX = (
    "Попросите чат исправить JSON в этом месте и прислать ответ целиком одним блоком ```json."
)

# Сообщения `json.JSONDecodeError` → причина по-русски. Ключ — начало сообщения.
_REASONS: tuple[tuple[str, str], ...] = (
    ("Expecting value", "ожидалось значение"),
    (
        "Expecting property name enclosed in double quotes",
        "ожидалось имя поля в двойных кавычках — лишняя запятая или одинарные кавычки",
    ),
    ("Expecting ':' delimiter", "ожидалось двоеточие после имени поля"),
    ("Expecting ',' delimiter", "ожидалась запятая между элементами"),
    ("Unterminated string", "строка не закрыта кавычкой"),
    ("Invalid control character", "перенос строки или управляющий символ внутри строки"),
    ("Invalid \\uXXXX escape", "неверная последовательность \\uXXXX"),
    ("Invalid \\escape", "неверная последовательность после \\"),
    ("Extra data", "после JSON-объекта лишний текст"),
    ("Illegal trailing comma", "лишняя запятая перед закрывающей скобкой"),
)
_CLOSING = {"}": "{", "]": "["}


@dataclass(frozen=True)
class _Block:
    lang: str
    start: int  # начало содержимого в исходном тексте
    end: int  # конец содержимого: строка закрывающей ``` или конец текста


class _NonJsonConstant(ValueError):
    pass


def extract_json(text: str) -> dict[str, Any]:
    """Один JSON-объект из ответа чата или `BridgeAnswerError` с `message` и `hint`."""
    if not text.strip():
        raise BridgeAnswerError(
            "Ответ пустой.", "Скопируйте ответ чата целиком и вставьте его сюда."
        )

    block = _choose_block(text)
    if block is not None:
        start = _skip_space(text, block.start, block.end)
        if start == block.end:
            raise BridgeAnswerError("JSON-блок в ответе пустой.", HINT_ONE_BLOCK)
        if text[start] == "[":
            _not_object("список")
        end = _strip_end(text, start, block.end)
    else:
        start = text.find("{")
        if start < 0:
            raise BridgeAnswerError(
                "В ответе нет JSON — ни блока ```json, ни объекта в фигурных скобках.",
                "Возможно, чат ответил текстом или вставлен не тот ответ. " + HINT_ONE_BLOCK,
            )
        end = len(text)

    if text[start] == "{":
        closed = _balanced_end(text, start, end)
        if closed is None:
            line = _last_line(text, start, end)
            raise BridgeAnswerError(
                f"Ответ обрывается на строке {line}: JSON-объект не закрыт.",
                HINT_CONTINUE,
                line=line,
            )
        if block is None:
            end = closed

    value = _loads(text, start, end)
    if not isinstance(value, dict):
        _not_object(type(value).__name__)
    return value


def _choose_block(text: str) -> _Block | None:
    blocks = _code_blocks(text)
    labeled = [b for b in blocks if b.lang.lower() in _JSON_LANGS]
    candidates = labeled or [
        b for b in blocks if not b.lang and text[b.start : b.end].lstrip().startswith("{")
    ]
    if len(candidates) > 1:
        count = len(candidates)
        noun = "JSON-блока" if count % 10 in (2, 3, 4) and count % 100 // 10 != 1 else "JSON-блоков"
        raise BridgeAnswerError(f"В ответе {count} {noun}, ожидался один.", HINT_ONE_BLOCK)
    return candidates[0] if candidates else None


def _code_blocks(text: str) -> list[_Block]:
    """Блоки ``` по строкам. Незакрытый блок идёт до конца текста — ответ мог оборваться."""
    blocks: list[_Block] = []
    lines = text.splitlines(keepends=True)
    offset = 0
    opened: tuple[str, int] | None = None
    for line in lines:
        match = _FENCE.match(line.rstrip("\r\n"))
        if match:
            if opened is None:
                opened = (match.group(1), offset + len(line))
            elif not match.group(1):
                blocks.append(_Block(lang=opened[0], start=opened[1], end=offset))
                opened = None
        offset += len(line)
    if opened is not None:
        blocks.append(_Block(lang=opened[0], start=opened[1], end=len(text)))
    return blocks


def _balanced_end(text: str, start: int, end: int) -> int | None:
    """Позиция за скобкой, закрывающей `text[start]`, или None, если до `end` она не закрылась.

    Несовпадающая скобка (`{ … ]`) тоже завершает поиск: ошибку в этом месте покажет `json`.
    """
    stack: list[str] = []
    in_string = False
    escaped = False
    for index in range(start, end):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char in "{[":
            stack.append(char)
        elif char in _CLOSING:
            if not stack or stack.pop() != _CLOSING[char]:
                return index + 1
            if not stack:
                return index + 1
    return None


def _loads(text: str, start: int, end: int) -> Any:
    try:
        return json.loads(text[start:end], parse_constant=_reject_constant)
    except json.JSONDecodeError as exc:
        line, column = _line_col(text, start + exc.pos)
        raise BridgeAnswerError(
            f"JSON не разобран: строка {line}, столбец {column} — {_reason(exc.msg)}.",
            HINT_FIX,
            line=line,
            column=column,
        ) from exc
    except _NonJsonConstant as exc:
        raise BridgeAnswerError(
            f"В JSON значение {exc} — такого в JSON нет.",
            "Попросите чат заменить его числом или null и прислать ответ целиком.",
        ) from exc


def _reject_constant(name: str) -> NoReturn:
    raise _NonJsonConstant(name)


def _not_object(kind: str) -> NoReturn:
    names = {
        "list": "список",
        "str": "строка",
        "int": "число",
        "float": "число",
        "bool": "true или false",
        "NoneType": "null",
    }
    raise BridgeAnswerError(
        f"Ожидался JSON-объект {{…}}, а в ответе {names.get(kind, kind)}.",
        "Попросите чат прислать результат одним объектом в фигурных скобках, по формату из"
        " промпта.",
    )


def _reason(message: str) -> str:
    for prefix, reason in _REASONS:
        if message.startswith(prefix):
            return reason
    return f"ошибка синтаксиса ({message})"


def _line_col(text: str, pos: int) -> tuple[int, int]:
    line = text.count("\n", 0, pos) + 1
    column = pos - (text.rfind("\n", 0, pos) + 1) + 1
    return line, column


def _last_line(text: str, start: int, end: int) -> int:
    """Номер последней непустой строки в `text[start:end]` — там ответ оборвался."""
    return _line_col(text, _strip_end(text, start, end) - 1)[0]


def _skip_space(text: str, start: int, end: int) -> int:
    while start < end and text[start].isspace():
        start += 1
    return start


def _strip_end(text: str, start: int, end: int) -> int:
    while end > start and text[end - 1].isspace():
        end -= 1
    return end
