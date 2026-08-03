"""Pure invoice service."""

from decimal import Decimal

from shared_domain.finance.money import money
from shared_domain.sales.dtos import (
    InvoiceDraft,
    InvoiceLine,
    InvoiceLineSnapshot,
    InvoiceTotals,
)
from shared_domain.tax.gst import split_gst


class InvoiceService:
    def line_total(self, rate: Decimal, quantity: Decimal, discount_pct: Decimal) -> Decimal:
        gross = Decimal(str(rate)) * Decimal(str(quantity))
        discount = gross * Decimal(str(discount_pct)) / Decimal("100")
        return money(gross - discount)

    def snapshot_line(
        self,
        line: InvoiceLine,
        *,
        inter_state: bool = False,
    ) -> InvoiceLineSnapshot:
        taxable = self.line_total(line.unit_price, line.quantity, line.discount_pct)
        gross = money(line.unit_price * line.quantity)
        discount_amount = money(gross - taxable)
        taxes = split_gst(taxable, line.gst_rate, inter_state)
        tax_amount = money(taxes["cgst"] + taxes["sgst"] + taxes["igst"])
        return InvoiceLineSnapshot(
            product_id=line.product_id,
            product_name=line.product_name,
            quantity=line.quantity,
            unit_price=line.unit_price,
            discount_pct=line.discount_pct,
            discount_amount=discount_amount,
            taxable_value=taxable,
            gst_rate=line.gst_rate,
            tax_amount=tax_amount,
            total=money(taxable + tax_amount),
            order_item_id=line.order_item_id,
            barcode=line.barcode,
            sku=line.sku,
            category=line.category,
            mrp=line.mrp,
        )

    def totals(
        self,
        lines: list[InvoiceLine] | tuple[InvoiceLine, ...],
        *,
        inter_state: bool = False,
    ) -> InvoiceTotals:
        snapshots = [self.snapshot_line(line, inter_state=inter_state) for line in lines]
        subtotal = money(sum((line.unit_price * line.quantity for line in lines), Decimal("0")))
        taxable = money(sum((line.taxable_value for line in snapshots), Decimal("0")))
        discount = money(subtotal - taxable)
        cgst = money(sum((split_gst(line.taxable_value, line.gst_rate, inter_state)["cgst"] for line in snapshots), Decimal("0")))
        sgst = money(sum((split_gst(line.taxable_value, line.gst_rate, inter_state)["sgst"] for line in snapshots), Decimal("0")))
        igst = money(sum((split_gst(line.taxable_value, line.gst_rate, inter_state)["igst"] for line in snapshots), Decimal("0")))
        return InvoiceTotals(
            subtotal=subtotal,
            discount=discount,
            taxable_value=taxable,
            cgst=cgst,
            sgst=sgst,
            igst=igst,
            grand_total=money(taxable + cgst + sgst + igst),
        )

    def create_invoice_draft(
        self,
        lines: list[InvoiceLine] | tuple[InvoiceLine, ...],
        *,
        inter_state: bool = False,
        is_reverse: bool = False,
        linked_invoice_id: int | None = None,
    ) -> InvoiceDraft:
        if not lines:
            raise ValueError("Invoice requires at least one line")
        snapshots = tuple(
            self.snapshot_line(line, inter_state=inter_state)
            for line in lines
        )
        return InvoiceDraft(
            lines=snapshots,
            totals=self.totals(lines, inter_state=inter_state),
            is_reverse=is_reverse,
            linked_invoice_id=linked_invoice_id,
        )
