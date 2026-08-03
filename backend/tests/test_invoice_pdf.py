import os
import unittest
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("REGISTER_PRIVATE_KEY", "invoice-pdf-test-key")

from app.invoice_pdf import _amount_in_words, build_invoice_pdf
from app.models import BusinessProfile, Customer, Outlet, Supplier


def product(index: int, *, long_name: bool = False):
    name = f"Product {index}"
    if long_name:
        name = f"Premium enterprise product {index} with a deliberately long descriptive name for wrapping"
    return SimpleNamespace(name=name, sku=f"SKU-{index:03d}")


def item(index: int, *, long_name: bool = False):
    return SimpleNamespace(
        quantity=Decimal("1"),
        rate=Decimal("1000") + index,
        gst_rate=Decimal("18"),
        unit_label="Nos",
        unit_type="pieces",
        product=product(index, long_name=long_name),
        product_id=index,
    )


def invoice_for(items, **overrides):
    order = SimpleNamespace(
        order_number="SO-2026-001",
        date=date(2026, 7, 20),
        items=list(items),
        supplier_id=None,
    )
    values = {
        "business_profile_id": 1,
        "outlet_id": None,
        "customer_id": 1,
        "invoice_direction": "outlet_to_customer",
        "party_name": "John Smith",
        "party_type": "B2C",
        "invoice_number": "INV-2026-001",
        "id": 1,
        "date": date(2026, 7, 20),
        "due_date": date(2026, 8, 4),
        "invoice_type": "Sale",
        "status": "Unpaid",
        "is_reverse": False,
        "order": order,
        "order_id": 1,
        "taxable_value": Decimal("1000"),
        "cgst": Decimal("90"),
        "sgst": Decimal("90"),
        "igst": Decimal("0"),
        "created_at": datetime(2026, 7, 20, 11, 30),
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class FakeDb:
    def __init__(self, seller=None, buyer=None):
        self.seller = seller
        self.buyer = buyer

    def get(self, model, _identity):
        if model is BusinessProfile:
            return self.seller
        if model is Customer:
            return self.buyer
        if model in {Outlet, Supplier}:
            return None
        return None


class InvoicePdfTests(unittest.TestCase):
    def setUp(self):
        self.seller = SimpleNamespace(
            logo_text="ERP",
            trade_name="Acme ERP",
            legal_name="Acme ERP Pvt Ltd",
            billing_address="1 Business Park",
            city="Bengaluru",
            state="Karnataka",
            pincode="560001",
            mobile="9999999999",
            email="billing@example.com",
            gstin="29ABCDE1234F1Z5",
            pan="ABCDE1234F",
            currency="INR",
            bank_name="HDFC Bank",
            account_number="1234567890",
            ifsc="HDFC0001234",
            upi_id="acme@upi",
            terms_conditions="Configured return policy.\nConfigured jurisdiction term.",
        )
        self.buyer = SimpleNamespace(
            name="John Smith",
            address="456 MG Road",
            city="Bengaluru",
            state="Karnataka",
            pincode="560001",
            phone="9876543210",
            email=None,
        )

    def render(self, invoice, seller=None, buyer=None):
        return build_invoice_pdf(
            FakeDb(self.seller if seller is None else seller, self.buyer if buyer is None else buyer),
            invoice,
        )

    def test_sparse_fields_and_fake_payment_values_are_omitted(self):
        sparse_seller = SimpleNamespace(trade_name="Acme", currency="INR")
        pdf = self.render(invoice_for([item(1)], status="Partially Paid"), seller=sparse_seller, buyer=SimpleNamespace(name="Buyer"))
        self.assertTrue(pdf.startswith(b"%PDF-1.4"))
        self.assertNotIn(b"Not provided", pdf)
        self.assertNotIn(b"PAID AMOUNT", pdf)
        self.assertNotIn(b"SHIPPED TO", pdf)
        self.assertNotIn(b"BANK DETAILS", pdf)
        self.assertNotIn(b"TERMS & CONDITIONS", pdf)

    def test_tax_columns_and_reverse_title_are_dynamic(self):
        pdf = self.render(
            invoice_for([item(1)], is_reverse=True, cgst=Decimal("0"), sgst=Decimal("0"), igst=Decimal("180"))
        )
        self.assertIn(b"CREDIT NOTE", pdf)
        self.assertIn(b"IGST", pdf)
        self.assertNotIn(b"CGST", pdf)
        self.assertNotIn(b"SGST", pdf)
        self.assertNotIn(b"DISCOUNT", pdf)

    def test_actual_zero_balance_displays_fully_paid(self):
        invoice = invoice_for([item(1)], status="Paid", paid_amount=Decimal("1180"), remaining_amount=Decimal("0"))
        pdf = self.render(invoice)
        self.assertIn(b"Fully Paid", pdf)
        self.assertIn(b"Rs. 1,180.00", pdf)

    def test_upi_details_include_a_clearly_marked_demo_qr(self):
        pdf = self.render(invoice_for([item(1)]))
        self.assertIn(b"DEMO UPI QR", pdf)
        self.assertIn(b"NOT FOR PAYMENT", pdf)

    def test_demo_qr_is_omitted_without_a_upi_id(self):
        seller = SimpleNamespace(trade_name="Acme", currency="INR", bank_name="HDFC Bank")
        pdf = self.render(invoice_for([item(1)]), seller=seller, buyer=SimpleNamespace(name="Buyer"))
        self.assertNotIn(b"DEMO UPI QR", pdf)

    def test_all_items_render_across_multiple_pages_with_dynamic_footer(self):
        invoice = invoice_for(
            [item(index, long_name=True) for index in range(1, 21)],
            taxable_value=Decimal("20210"),
            cgst=Decimal("1818.90"),
            sgst=Decimal("1818.90"),
        )
        pdf = self.render(invoice)
        self.assertIn(b"/Count 3", pdf)
        for page in range(1, 4):
            self.assertIn(f"Page {page} of 3".encode(), pdf)
        for index in range(1, 21):
            self.assertIn(f"SKU-{index:03d}".encode(), pdf)
        self.assertNotIn(b"additional item", pdf)

    def test_terms_and_authorized_signatory_render_when_present(self):
        seller = SimpleNamespace(
            trade_name="Acme",
            currency="INR",
            terms_conditions="Standard return policy.",
            authorized_person="Jane Doe",
            designation="Accounts Manager",
            company_name="Acme ERP Pvt Ltd",
        )
        pdf = self.render(invoice_for([item(1)]), seller=seller, buyer=SimpleNamespace(name="Buyer"))
        self.assertIn(b"TERMS & CONDITIONS", pdf)
        self.assertIn(b"AUTHORIZED SIGNATORY", pdf)

    def test_amount_in_words_uses_indian_numbering(self):
        self.assertEqual(
            _amount_in_words(Decimal("66611")),
            "Sixty Six Thousand Six Hundred Eleven Rupees Only",
        )


if __name__ == "__main__":
    unittest.main()
