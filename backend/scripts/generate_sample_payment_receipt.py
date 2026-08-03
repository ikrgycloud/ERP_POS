"""Generate a deterministic sample receipt for visual QA."""
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
import sys

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base
from app.models import BusinessProfile, Invoice, InvoicePayment
from app.payment_receipt_pdf import build_payment_receipt_pdf


def main() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(BusinessProfile(id=1, role="admin", access_code="SAMPLE", legal_name="ABC Enterprises Pvt. Ltd.", trade_name="ERP Solutions", logo_text="ERP", owner_name="Rahul Sharma", mobile="9876543210", email="info@example.com"))
        invoice = Invoice(id=45, business_profile_id=1, invoice_number="INV-2026-00045", invoice_type="Sale", invoice_direction="outlet_to_customer", party_type="B2C", party_name="John Smith", date=date(2026, 7, 20), due_date=date(2026, 8, 4), taxable_value=Decimal("10000"), cgst=0, sgst=0, igst=0, status="Generated")
        db.add(invoice)
        db.flush()
        payment = InvoicePayment(id=101, receipt_number="RCP-2026-0001", invoice_id=45, business_profile_id=1, amount=Decimal("2500"), payment_method="upi", transaction_reference="TXN12345", transaction_type="payment", status="successful", received_by="Rahul Sharma", paid_at=datetime(2026, 7, 20, 11, 30, tzinfo=timezone.utc), invoice_total_snapshot=Decimal("10000"), previous_paid_amount=Decimal("0"), total_paid_after=Decimal("2500"), remaining_after=Decimal("7500"), payment_status_after="Partially Paid")
        db.add(payment)
        db.flush()
        output = Path(__file__).resolve().parents[1] / "generated" / "sample-payment-receipt.pdf"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(build_payment_receipt_pdf(db, payment))
        print(output)


if __name__ == "__main__":
    main()
