"""Pure validation helpers shared by ERP and POS."""

from decimal import Decimal
import re

GSTIN_PATTERN = re.compile(
    r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$"
)
PHONE_PATTERN = re.compile(r"^\+?[0-9][0-9\s-]{7,18}$")


def is_valid_phone(value: str | None) -> bool:
    if not value:
        return False
    return PHONE_PATTERN.fullmatch(value.strip()) is not None


def is_strong_password(value: str | None, *, min_length: int = 8) -> bool:
    if not value or len(value) < min_length:
        return False
    return (
        any(ch.islower() for ch in value)
        and any(ch.isupper() for ch in value)
        and any(ch.isdigit() for ch in value)
    )


def is_valid_gstin(value: str | None) -> bool:
    if not value:
        return False
    return GSTIN_PATTERN.fullmatch(value.strip().upper()) is not None


def validate_positive_money(value: Decimal) -> None:
    if value <= 0:
        raise ValueError("Money amount must be positive")


def validate_non_negative_quantity(value: Decimal) -> None:
    if value < 0:
        raise ValueError("Quantity cannot be negative")
