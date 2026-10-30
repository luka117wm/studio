"""Деньги в ответах API (L-001): микродоллары считать, строку показывать.

Без зависимостей от прайса и провайдеров: модель `Money` нужна и очереди джобов (сводка пачки,
M6.3), а `pricing.py` тянет `providers/`, которые тянут очередь. Расчёт цен — `pricing.py`.
"""

from decimal import ROUND_HALF_UP, Decimal

from pydantic import BaseModel

MICRO = Decimal(1_000_000)


def format_usd(micro: int) -> str:
    """Микродоллары → «$151.20», «$150»; только для ответов API, в журнале — микродоллары."""
    sign = "-" if micro < 0 else ""
    cents = (Decimal(abs(micro)) / MICRO).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if micro and not cents:
        return f"{sign}<$0.01"
    if cents == cents.to_integral_value():
        return f"{sign}${int(cents)}"
    return f"{sign}${cents}"


def format_unit_usd(micro: int) -> str:
    """Цена одного вызова в подписи сметы: «$0.067», «$0.32» — до десятых цента, где они есть;
    дешевле — «<$0.001». Суммы показывает `format_usd`."""
    mills = (Decimal(micro) / MICRO).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    if micro and not mills:
        return "<$0.001"
    if mills == mills.quantize(Decimal("0.01")):
        return format_usd(micro)
    return f"${mills}"


class Money(BaseModel):
    """Деньги в ответе API: по `usd_micro` считать, `usd` показывать."""

    usd_micro: int
    usd: str


def money(micro: int) -> Money:
    return Money(usd_micro=micro, usd=format_usd(micro))
