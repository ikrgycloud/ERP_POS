"""Sales and invoice DTOs."""

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True, slots=True)
class InvoiceLine:
    product_id: int
    product_name: str
    quantity: Decimal
    unit_price: Decimal
    discount_pct: Decimal = Decimal("0")
    gst_rate: Decimal = Decimal("0")
    order_item_id: int | None = None
    barcode: str | None = None
    sku: str | None = None
    category: str | None = None
    mrp: Decimal | None = None

    def __post_init__(self) -> None:
        if self.product_id <= 0:
            raise ValueError("product_id must be positive")
        if self.quantity <= 0:
            raise ValueError("quantity must be positive")
        if self.unit_price < 0:
            raise ValueError("unit_price cannot be negative")


@dataclass(frozen=True, slots=True)
class InvoiceLineSnapshot:
    product_id: int
    product_name: str
    quantity: Decimal
    unit_price: Decimal
    discount_pct: Decimal
    discount_amount: Decimal
    taxable_value: Decimal
    gst_rate: Decimal
    tax_amount: Decimal
    total: Decimal
    order_item_id: int | None = None
    barcode: str | None = None
    sku: str | None = None
    category: str | None = None
    mrp: Decimal | None = None


@dataclass(frozen=True, slots=True)
class InvoiceTotals:
    subtotal: Decimal
    discount: Decimal
    taxable_value: Decimal
    cgst: Decimal
    sgst: Decimal
    igst: Decimal
    grand_total: Decimal


@dataclass(frozen=True, slots=True)
class InvoiceDraft:
    lines: tuple[InvoiceLineSnapshot, ...]
    totals: InvoiceTotals
    is_reverse: bool = False
    linked_invoice_id: int | None = None
