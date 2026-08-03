from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy.orm import Session

from app.models import Invoice, InvoicePayment
from app.services import apply_order_inventory, invoice_total, reverse_order_inventory

MONEY = Decimal("0.01")
PAYMENT_METHODS = {"cash", "upi", "card", "bank_transfer", "wallet", "cheque", "other"}
ENTRY_STATUSES = {"successful", "pending", "failed", "reversed"}
POSITIVE_TYPES = {"payment", "credit_adjustment"}
NEGATIVE_TYPES = {"refund", "debit_adjustment"}


def money(value: Decimal | int | float | str) -> Decimal:
    return Decimal(str(value)).quantize(MONEY, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class PaymentSummary:
    invoice_id: int
    invoice_number: str
    grand_total: Decimal
    paid_amount: Decimal
    remaining_amount: Decimal
    payment_percentage: Decimal
    payment_status: str
    invoice_status: str
    last_payment_date: datetime | None
    payment_count: int

    def as_dict(self) -> dict[str, object]:
        return self.__dict__.copy()


def payment_effect(entry: InvoicePayment) -> Decimal:
    if entry.status != "successful":
        return Decimal("0.00")
    if entry.transaction_type in POSITIVE_TYPES:
        return money(entry.amount)
    if entry.transaction_type in NEGATIVE_TYPES:
        return -money(entry.amount)
    # A reversal row is the immutable audit/receipt record. Its original row is
    # marked reversed, so counting it again would subtract twice.
    return Decimal("0.00")


def status_for(total: Decimal, paid: Decimal) -> tuple[str, Decimal, Decimal]:
    total = money(total)
    paid = max(Decimal("0.00"), money(paid))
    remaining = max(Decimal("0.00"), money(total - paid))
    percentage = Decimal("0.00") if total <= 0 else (paid * 100 / total).quantize(MONEY, rounding=ROUND_HALF_UP)
    if paid <= 0:
        status = "Unpaid"
    elif paid < total:
        status = "Partially Paid"
    elif paid == total:
        status = "Paid"
    else:
        status = "Overpaid"
    return status, remaining, percentage


def calculate_payment_summary(db: Session, invoice: Invoice) -> PaymentSummary:
    entries = invoice.__dict__.get("payments")
    if entries is None:
        entries = (
            db.query(InvoicePayment)
            .filter(InvoicePayment.invoice_id == invoice.id)
            .order_by(InvoicePayment.paid_at.asc(), InvoicePayment.id.asc())
            .all()
        )
    def ledger_order(entry: InvoicePayment) -> tuple[datetime, int]:
        paid_at = entry.paid_at
        if paid_at.tzinfo is not None:
            paid_at = paid_at.astimezone(timezone.utc).replace(tzinfo=None)
        return paid_at, entry.id or 0

    entries = sorted(entries, key=ledger_order)
    paid = money(sum((payment_effect(entry) for entry in entries), Decimal("0.00")))
    total = money(invoice_total(invoice))
    payment_status, remaining, percentage = status_for(total, paid)
    successful = [entry for entry in entries if entry.status == "successful" and entry.transaction_type in POSITIVE_TYPES]
    last_payment = successful[-1].paid_at if successful else None
    invoice_status = "Closed" if payment_status == "Paid" else ("Generated" if invoice.status == "Closed" else invoice.status)
    return PaymentSummary(
        invoice_id=invoice.id,
        invoice_number=invoice.invoice_number,
        grand_total=total,
        paid_amount=paid,
        remaining_amount=remaining,
        payment_percentage=percentage,
        payment_status=payment_status,
        invoice_status=invoice_status,
        last_payment_date=last_payment,
        payment_count=len(entries),
    )


def sync_invoice_payment_fields(db: Session, invoice: Invoice, summary: PaymentSummary) -> bool:
    auto_delivered_now = False
    invoice.paid_amount = summary.paid_amount
    invoice.remaining_amount = summary.remaining_amount
    invoice.payment_percentage = summary.payment_percentage
    invoice.payment_status = summary.payment_status
    invoice.last_payment_date = summary.last_payment_date
    if summary.payment_status == "Paid":
        invoice.status = "Closed"
    elif invoice.status == "Closed":
        invoice.status = "Generated"

    # A generated invoice is the collection record for its order. Keep the
    # order badge in sync so Orders, Invoices, Dashboard and Reports express
    # the same collection state without manual editing.
    order = invoice.order
    if order is not None and order.status not in {"Deleted", "Cancelled"}:
        order.payment_status = summary.payment_status
        completed_status = "Received" if order.type == "purchase" else "Delivered"
        pending_statuses = {"Draft", "Sent"} if order.type == "purchase" else {"Draft", "Packed"}
        if summary.payment_status == "Paid" and (order.status in pending_statuses or order.payment_auto_delivered):
            if not order.inventory_applied:
                apply_order_inventory(db, order.type, order.items)
                order.inventory_applied = True
            if order.status in pending_statuses:
                order.status = completed_status
                order.payment_auto_delivered = True
                auto_delivered_now = True
        elif summary.payment_status != "Paid" and order.payment_auto_delivered:
            if order.inventory_applied:
                reverse_order_inventory(db, order)
                order.inventory_applied = False
            order.status = "Draft"
            order.payment_auto_delivered = False
    return auto_delivered_now


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
