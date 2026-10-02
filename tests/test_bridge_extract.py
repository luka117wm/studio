"""`extract_json`: таблица ответов чата → объект или ошибка с текстом для пользователя."""

from typing import Any

import pytest

from app.pipeline.bridge import BridgeAnswerError, extract_json
from app.pipeline.bridge.extract import HINT_CONTINUE, HINT_FIX, HINT_ONE_BLOCK

PLAN = {"meta": {"episode_id": "c07"}, "shots": [{"id": "s001", "vo": "You are eleven."}]}

ACCEPTED: list[tuple[str, str, dict[str, Any]]] = [
    (
        "блок json с прозой вокруг",
        'Here is part 1 of 4.\n\n```json\n{"meta": {"episode_id": "c07"},\n "shots": [{"id":'
        ' "s001", "vo": "You are eleven."}]}\n```\n\nLet me know when to continue {part 2}.',
        PLAN,
    ),
    ("блок без языка", '```\n{"a": 1}\n```', {"a": 1}),
    ("язык заглавными", 'Plan:\n```JSON\n{"a": 1}\n```', {"a": 1}),
    ("голый объект с прозой", 'Sure! {"a": {"b": [1, 2]}} Hope this helps.', {"a": {"b": [1, 2]}}),
    (
        "скобки и кавычки в строках",
        'Result: {"vo": "a } tricky { line \\" with ] quote", "n": {"x": "[{"}} trailing }',
        {"vo": 'a } tricky { line " with ] quote', "n": {"x": "[{"}},
    ),
    (
        "блок json важнее блоков без языка",
        'Example:\n```\n{"draft": true}\n```\nFinal:\n```json\n{"a": 1}\n```',
        {"a": 1},
    ),
    (
        "блоки других языков пропускаются",
        'Code:\n```python\nx = {"no": 1}\n```\n```json\n{"a": 1}\n```',
        {"a": 1},
    ),
    (
        "блок без языка с прозой не считается JSON",
        'Notes:\n```\nshot list below\n```\n```\n{"a": 1}\n```',
        {"a": 1},
    ),
    ("незакрытый блок с целым объектом", 'Here:\n```json\n{"a": 1}\n', {"a": 1}),
]


@pytest.mark.parametrize(("case", "text", "expected"), ACCEPTED, ids=[c[0] for c in ACCEPTED])
def test_accepted(case: str, text: str, expected: dict[str, Any]) -> None:
    assert extract_json(text) == expected


def _error(text: str) -> BridgeAnswerError:
    with pytest.raises(BridgeAnswerError) as caught:
        extract_json(text)
    return caught.value


def test_two_blocks() -> None:
    error = _error('```json\n{"a": 1}\n```\nand part 2:\n```json\n{"b": 2}\n```')
    assert error.message == "В ответе 2 JSON-блока, ожидался один."
    assert error.hint == HINT_ONE_BLOCK
    five = "\n".join(f'```json\n{{"n": {n}}}\n```' for n in range(5))
    assert _error(five).message == "В ответе 5 JSON-блоков, ожидался один."


def test_truncated_block_names_last_line() -> None:
    text = 'Sure!\n```json\n{\n  "shots": [\n    {"id": "s001", "vo": "You are eleven\n\n  '
    error = _error(text)
    assert error.message == "Ответ обрывается на строке 5: JSON-объект не закрыт."
    assert error.line == 5
    assert error.hint == HINT_CONTINUE


def test_truncated_bare_object() -> None:
    error = _error('Part 1:\n{"shots": [\n  {"id": "s001"},\n  {"id": "s002"')
    assert error.message == "Ответ обрывается на строке 4: JSON-объект не закрыт."


def test_syntax_error_position_is_in_original_answer() -> None:
    text = 'Here is the plan:\n\n```json\n{\n  "a": 1\n  "b": 2\n}\n```\n'
    error = _error(text)
    assert error.message == (
        "JSON не разобран: строка 6, столбец 3 — ожидалась запятая между элементами."
    )
    assert (error.line, error.column) == (6, 3)
    assert error.hint == HINT_FIX


@pytest.mark.parametrize(
    ("text", "message"),
    [
        (
            'Plan {"a": 1, "b": 2,}',
            "JSON не разобран: строка 1, столбец 22 — ожидалось имя поля в двойных кавычках —"
            " лишняя запятая или одинарные кавычки.",
        ),
        (
            "```json\n{'a': 1}\n```",
            "JSON не разобран: строка 2, столбец 2 — ожидалось имя поля в двойных кавычках —"
            " лишняя запятая или одинарные кавычки.",
        ),
        (
            '```json\n{"a": 1}\n{"b": 2}\n```',
            "JSON не разобран: строка 3, столбец 1 — после JSON-объекта лишний текст.",
        ),
        (
            '```json\n{"vo": "line one\nline two"}\n```',
            "JSON не разобран: строка 2, столбец 17 — перенос строки или управляющий символ"
            " внутри строки.",
        ),
        (
            '{"a": [1, 2}',
            "JSON не разобран: строка 1, столбец 12 — ожидалась запятая между элементами.",
        ),
    ],
)
def test_syntax_errors_are_explained(text: str, message: str) -> None:
    assert _error(text).message == message


@pytest.mark.parametrize("text", ["", "   \n\t\n"])
def test_empty_answer(text: str) -> None:
    error = _error(text)
    assert error.message == "Ответ пустой."
    assert error.hint == "Скопируйте ответ чата целиком и вставьте его сюда."


def test_answer_without_json() -> None:
    error = _error("I can't help with that part of the plan, sorry.")
    assert error.message == "В ответе нет JSON — ни блока ```json, ни объекта в фигурных скобках."
    assert error.hint.startswith("Возможно, чат ответил текстом")


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ('```json\n[{"a": 1}]\n```', "Ожидался JSON-объект {…}, а в ответе список."),
        ('```json\n"just text"\n```', "Ожидался JSON-объект {…}, а в ответе строка."),
        ("```json\n\n```", "JSON-блок в ответе пустой."),
        ('{"strength": NaN}', "В JSON значение NaN — такого в JSON нет."),
    ],
)
def test_not_an_object_or_not_json(text: str, message: str) -> None:
    assert _error(text).message == message


def test_nothing_is_repaired() -> None:
    """Одинарные кавычки, висячая запятая, комментарий — ошибка, а не тихая починка."""
    for text in ["{'a': 1}", '{"a": 1,}', '{"a": 1 // note\n}']:
        with pytest.raises(BridgeAnswerError):
            extract_json(text)
