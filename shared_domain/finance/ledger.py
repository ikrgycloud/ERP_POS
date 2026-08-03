"""Pure financial ledger calculations."""

from decimal import Decimal

from shared_domain.finance.dtos import FinancialLedgerSummary, InvoiceFinancialSnapshot
from shared_domain.finance.money import money


class FinancialLedgerService:
    def invoice_total(
        self,
        *,
        taxable_value: Decimal,
        cgst: Decimal = Decimal("0"),
        sgst: Decimal = Decimal("0"),
        igst: Decimal = Decimal("0"),
    ) -> Decimal:
        return money(taxable_value + cgst + sgst + igst)

    def signed_invoice_total(self, snapshot: InvoiceFinancialSnapshot) -> Decimal:
        total = self.invoice_total(
            taxable_value=snapshot.taxable_value,
            cgst=snapshot.cgst,
            sgst=snapshot.sgst,
            igst=snapshot.igst,
        )
        return -total if snapshot.is_reverse else total

    def summarize_invoices(
        self,
        invoices: list[InvoiceFinancialSnapshot] | tuple[InvoiceFinancialSnapshot, ...],
        *,
        inventory_value: Decimal = Decimal("0"),
        expenses: Decimal = Decimal("0"),
    ) -> FinancialLedgerSummary:
        gross = Decimal("0")
        refunds = Decimal("0")
        discounts = Decimal("0")
        gst = Decimal("0")
        cogs = Decimal("0")
        for invoice in invoices:
            total = self.invoice_total(
                taxable_value=invoice.taxable_value,
                cgst=invoice.cgst,
                sgst=invoice.sgst,
                igst=invoice.igst,
            )
            if invoice.is_reverse:
                refunds += total
            else:
                gross += total
                discounts += invoice.discount
                cogs += invoice.cogs
            gst += invoice.cgst + invoice.sgst + invoice.igst
        return FinancialLedgerSummary(
            gross_revenue=money(gross),
            refunds=money(refunds),
            discounts=money(discounts),
            gst=money(gst),
            cogs=money(cogs),
            inventory_value=money(inventory_value),
            expenses=money(expenses),
        )

    def net_revenue(self, *, gross_revenue: Decimal, refunds: Decimal = Decimal("0"), discounts: Decimal = Decimal("0")) -> Decimal:
        return max(Decimal("0"), money(gross_revenue) - money(refunds) - money(discounts))
