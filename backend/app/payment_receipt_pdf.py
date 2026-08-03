from __future__ import annotations

from datetime import timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.invoice_pdf import PdfBuilder
from app.models import BusinessProfile, Customer, InvoicePayment, Outlet


def _money(value: Decimal) -> str:
    return f"INR {Decimal(value):,.2f}"


def _label(pdf: PdfBuilder, y: float, label: str, value: object, bold: bool = False) -> float:
    pdf.fill_color(0.39, 0.45, 0.55)
    pdf.text(12, y, label.upper(), size=6, bold=True)
    pdf.fill_color(0.06, 0.10, 0.18)
    pdf.text(92, y, value or "-", size=7, bold=bold)
    return y - 14


def build_payment_receipt_pdf(db: Session, payment: InvoicePayment) -> bytes:
    invoice = payment.invoice
    business = db.get(BusinessProfile, payment.business_profile_id) if payment.business_profile_id else None
    outlet = db.get(Outlet, payment.outlet_id) if payment.outlet_id else None
    customer = db.get(Customer, payment.customer_id) if payment.customer_id else None
    seller = outlet or business
    seller_name = getattr(seller, "trade_name", None) or getattr(seller, "legal_name", None) or "ERP"
    outlet_name = getattr(outlet, "name", None) or getattr(outlet, "trade_name", None) or "Head Office"
    customer_name = getattr(customer, "name", None) or invoice.party_name
    customer_phone = getattr(customer, "phone", None) or "-"
    timestamp = payment.paid_at
    if timestamp.tzinfo is not None:
        timestamp = timestamp.astimezone(timezone.utc)

    width, height = 226.77, 455.0  # 80 mm thermal receipt
    pdf = PdfBuilder(page_width=width, page_height=height)
    pdf.fill_color(1, 1, 1)
    pdf.rect(5, 5, width - 10, height - 10, stroke=False, fill=True)
    pdf.stroke_color(0.82, 0.86, 0.92)
    pdf.rect(7, 7, width - 14, height - 14, stroke=True)
    pdf.fill_color(0.10, 0.33, 0.78)
    pdf.text(12, 430, seller_name, size=13, bold=True)
    pdf.fill_color(0.06, 0.10, 0.18)
    receipt_title = "PAYMENT REVERSAL RECEIPT" if payment.transaction_type == "reversal" else "PAYMENT RECEIPT"
    pdf.text(12, 410, receipt_title, size=11, bold=True)
    pdf.fill_color(0.10, 0.33, 0.78)
    pdf.text(12, 394, payment.receipt_number, size=8, bold=True)
    pdf.stroke_color(0.86, 0.89, 0.94)
    pdf.line(12, 382, width - 12, 382)

    y = 365
    for label, value, bold in (
        ("Invoice", invoice.invoice_number, True),
        ("Customer", customer_name, True),
        ("Phone", customer_phone, False),
        ("Date & time", timestamp.strftime("%d %b %Y, %I:%M %p UTC"), False),
        ("Invoice total", _money(payment.invoice_total_snapshot), False),
        ("Previous paid", _money(payment.previous_paid_amount), False),
        ("Amount reversed" if payment.transaction_type == "reversal" else "Paid now", _money(payment.amount), True),
        ("Total paid", _money(payment.total_paid_after), True),
        ("Remaining", _money(payment.remaining_after), True),
        ("Method", payment.payment_method.replace("_", " ").title(), False),
        ("Reference", payment.transaction_reference or "-", False),
        ("Received by", payment.received_by or "ERP User", False),
        ("Outlet", outlet_name, False),
        ("Status", payment.status.title(), True),
    ):
        y = _label(pdf, y, label, value, bold)

    pdf.fill_color(0.94, 0.97, 1)
    pdf.rect(12, 63, width - 24, 34, stroke=False, fill=True)
    pdf.fill_color(0.10, 0.33, 0.78)
    pdf.text(69, 82, "THANK YOU", size=9, bold=True)
    pdf.fill_color(0.39, 0.45, 0.55)
    pdf.text(34, 70, "This is a computer-generated receipt.", size=6)
    pdf.text(59, 35, "No signature required", size=6)
    return pdf.write_pdf()
