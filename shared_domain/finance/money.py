"""Money helpers shared by ERP and POS calculations."""

from decimal import Decimal, ROUND_HALF_UP

MONEY_QUANT = Decimal("0.01")


def to_decimal(value: Decimal | int | float | str) -> Decimal:
    return Decimal(str(value))


def money(value: Decimal | int | float | str) -> Decimal:
    return to_decimal(value).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
