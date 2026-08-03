from datetime import date, timedelta
from decimal import Decimal
import os

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")

from app.api.payments import receive_invoice_payment, reverse_payment
from app.database import Base
from app.invoice_payment_service import calculate_payment_summary
from app.models import BusinessProfile, Invoice, InvoicePayment
from app.payment_receipt_pdf import build_payment_receipt_pdf
from app.schemas import InvoicePaymentCreate


@pytest.fixture()
def payment_db():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    with SessionLocal() as db:
        profile = BusinessProfile(
            id=1,
            role="admin",
            access_code="PAY-ADMIN",
            legal_name="Payment Test Pvt Ltd",
            trade_name="Payment Test",
            logo_text="ERP",
            owner_name="Owner",
            mobile="9999999999",
            email="payments@example.test",
        )
        invoice = Invoice(
            id=1,
            business_profile_id=1,
            invoice_number="INV-2026-00045",
            invoice_type="Sale",
            invoice_direction="outlet_to_customer",
            party_type="B2C",
            party_name="John Smith",
            date=date.today(),
            due_date=date.today() + timedelta(days=15),
            taxable_value=Decimal("10000"),
            cgst=0,
            sgst=0,
            igst=0,
            status="Generated",
        )
        db.add_all([profile, invoice])
        db.commit()
        yield db


def pay(db, amount, key, *, entry_status="successful"):
    return receive_invoice_payment(
        1,
        InvoicePaymentCreate(
            amount=amount,
            paymentMethod="upi",
            transactionReference=f"TXN-{key}",
            receivedBy="Cashier",
            status=entry_status,
        ),
        idempotency_key=key,
        business_profile_id=1,
        db=db,
    )


def test_three_partial_payments_close_invoice_and_keep_history(payment_db):
    first = pay(payment_db, "2500", "payment-1")
    assert first.summary.paid_amount == Decimal("2500.00")
    assert first.summary.remaining_amount == Decimal("7500.00")
    assert first.summary.payment_percentage == Decimal("25.00")
    assert first.summary.payment_status == "Partially Paid"

    second = pay(payment_db, "5000", "payment-2")
    assert second.payment.previous_paid_amount == Decimal("2500.00")
    assert second.summary.paid_amount == Decimal("7500.00")
    assert second.summary.remaining_amount == Decimal("2500.00")

    third = pay(payment_db, "2500", "payment-3")
    assert third.summary.payment_status == "Paid"
    assert third.summary.invoice_status == "Closed"
    assert payment_db.query(InvoicePayment).count() == 3
    assert len({row.receipt_number for row in payment_db.query(InvoicePayment).all()}) == 3


def test_overpayment_zero_duplicate_and_failed_payment_rules(payment_db):
    with pytest.raises(ValueError):
        InvoicePaymentCreate(amount=0, paymentMethod="cash")
    pay(payment_db, "2000", "same-request")
    replay = pay(payment_db, "2000", "same-request")
    assert replay["summary"]["paidAmount"] == "2000.00"
    assert payment_db.query(InvoicePayment).count() == 1
    with pytest.raises(HTTPException) as exc:
        pay(payment_db, "9000", "too-much")
    assert exc.value.status_code == 409
    payment_db.rollback()
    pay(payment_db, "1000", "failed-payment", entry_status="failed")
    assert calculate_payment_summary(payment_db, payment_db.get(Invoice, 1)).paid_amount == Decimal("2000.00")


def test_reversal_is_append_only_and_generates_receipt(payment_db):
    created = pay(payment_db, "2500", "payment-to-reverse")
    reversal = reverse_payment(
        created.payment.id,
        idempotency_key="reverse-once",
        business_profile_id=1,
        db=payment_db,
    )
    assert reversal.payment.transaction_type == "reversal"
    assert reversal.summary.paid_amount == Decimal("0.00")
    original = payment_db.get(InvoicePayment, created.payment.id)
    assert original.status == "reversed"
    assert payment_db.query(InvoicePayment).count() == 2
    receipt = build_payment_receipt_pdf(payment_db, payment_db.get(InvoicePayment, reversal.payment.id))
    assert receipt.startswith(b"%PDF-1.4")
    assert b"PAYMENT REVERSAL RECEIPT" in receipt
