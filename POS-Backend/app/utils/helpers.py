"""Pure helper functions — document numbering and GST math."""
from datetime import datetime, timezone
from decimal import Decimal

from shared_domain.finance.money import money
from shared_domain.tax.gst import split_gst as shared_split_gst


TWO = Decimal("0.01")


def gen_number(prefix: str, seq: int) -> str:
    """e.g. INV-20260708-0001"""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"{prefix}-{stamp}-{seq:04d}"


def line_total(rate: Decimal, qty: Decimal, discount_pct: Decimal) -> Decimal:
    gross = Decimal(str(rate)) * Decimal(str(qty))
    disc = gross * Decimal(str(discount_pct)) / Decimal("100")
    return money(gross - disc)


def discount_pct_for_price(discount_type: str | None, discount_value: Decimal, unit_price: Decimal) -> Decimal:
    """Convert a product discount into the percentage shape used by POS lines."""
    value = Decimal(str(discount_value or 0))
    price = Decimal(str(unit_price or 0))
    if value <= 0 or price <= 0:
        return Decimal("0")
    if (discount_type or "").strip().lower() == "percentage":
        return min(value, Decimal("100")).quantize(TWO)
    return min((value / price) * Decimal("100"), Decimal("100")).quantize(TWO)


def split_gst(taxable: Decimal, gst_rate: Decimal, inter_state: bool) -> dict:
    """Return cgst/sgst/igst for a taxable value.

    Intra-state splits GST into equal CGST + SGST; inter-state uses IGST.
    """
    return shared_split_gst(taxable, gst_rate, inter_state)
