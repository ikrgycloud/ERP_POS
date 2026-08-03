"""GST calculation helpers."""

from decimal import Decimal

from shared_domain.finance.money import money, to_decimal


def split_gst(
    taxable_value: Decimal | int | float | str,
    gst_rate: Decimal | int | float | str,
    inter_state: bool = False,
) -> dict[str, Decimal]:
    taxable = money(taxable_value)
    rate = to_decimal(gst_rate)
    tax = money(taxable * rate / Decimal("100"))
    if inter_state:
        return {"cgst": Decimal("0.00"), "sgst": Decimal("0.00"), "igst": tax}
    half = money(tax / Decimal("2"))
    return {"cgst": half, "sgst": money(tax - half), "igst": Decimal("0.00")}
