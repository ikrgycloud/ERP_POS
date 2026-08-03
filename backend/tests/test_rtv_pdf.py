import os
import unittest
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("REGISTER_PRIVATE_KEY", "rtv-pdf-test-key")

from app.models import BusinessProfile
from app.rtv_pdf import build_rtv_pdf


class FakeDb:
    def get(self, model, _identity):
        if model is BusinessProfile:
            return SimpleNamespace(
                trade_name="Acme ERP",
                legal_name="Acme ERP Pvt Ltd",
                billing_address="1 Business Park",
                city="Bengaluru",
                state="Karnataka",
                pincode="560001",
                gstin="29ABCDE1234F1Z5",
                pan="ABCDE1234F",
                mobile="9999999999",
                email="billing@example.com",
            )
        return None


def supplier_return(item_count=1):
    supplier = SimpleNamespace(
        name="Global Industrial Components Supplier Pvt Ltd",
        address="42 Industrial Estate, Phase Two, Bengaluru, Karnataka 560099",
        gstin="29SUPPLIER1234Z9",
        mobile="9888888888",
        email="returns@supplier.example.com",
    )
    items = [
        SimpleNamespace(
            product_snapshot={
                "name": f"Premium industrial component product {index} with a long description",
                "sku": f"SKU-{index:03d}",
            },
            product_id=index,
            quantity_requested=Decimal("12.500"),
            unit_cost=Decimal("12345.67"),
            reason="Damaged packaging and transit inspection failure requiring supplier review",
        )
        for index in range(1, item_count + 1)
    ]
    return SimpleNamespace(
        business_profile_id=1,
        rtv_number="RTV-1-00001",
        created_at=datetime(2026, 7, 21, 12, 0),
        current_status=SimpleNamespace(code="ready_for_shipment"),
        shipment_status="pending_dispatch",
        purchase_order_id=123,
        purchase_invoice_id=None,
        reason="Damaged goods",
        supplier=supplier,
        supplier_snapshot={},
        items=items,
        remarks=(
            "Packaging damage, inspection findings, handling precautions, supplier coordination, "
            "requested credit, and replacement expectations."
        ),
    )


class RtvPdfTests(unittest.TestCase):
    def test_long_rtv_flows_across_pages_without_dropping_items(self):
        pdf = build_rtv_pdf(FakeDb(), supplier_return(item_count=22))

        self.assertTrue(pdf.startswith(b"%PDF-1.4"))
        self.assertGreaterEqual(pdf.count(b"/Type /Page "), 2)
        self.assertIn(b"RETURN TO VENDOR - ITEM CONTINUATION", pdf)
        for index in range(1, 23):
            self.assertIn(f"SKU-{index:03d}".encode(), pdf)

    def test_summary_and_page_footer_are_rendered(self):
        pdf = build_rtv_pdf(FakeDb(), supplier_return(item_count=2))

        self.assertIn(b"RETURN SUMMARY", pdf)
        self.assertIn(b"Supplier acknowledgement", pdf)
        self.assertIn(b"Page 1 of", pdf)


if __name__ == "__main__":
    unittest.main()
