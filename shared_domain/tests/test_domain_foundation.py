from decimal import Decimal

from shared_domain.documents import DocumentFamily, document_prefix
from shared_domain.inventory import InventoryDisposition, return_disposition
from shared_domain.money import money, split_gst
from shared_domain.services import InventoryMovementService


def test_money_rounds_half_up():
    assert money("10.125") == Decimal("10.13")
    assert money("10.124") == Decimal("10.12")


def test_split_gst_intrastate_balances_odd_paise():
    assert split_gst("99.99", "5") == {
        "cgst": Decimal("2.50"),
        "sgst": Decimal("2.50"),
        "igst": Decimal("0.00"),
    }


def test_split_gst_interstate_uses_igst():
    assert split_gst("100", "18", inter_state=True) == {
        "cgst": Decimal("0.00"),
        "sgst": Decimal("0.00"),
        "igst": Decimal("18.00"),
    }


def test_return_reason_disposition_mapping():
    assert return_disposition("wrong_product") == InventoryDisposition.AVAILABLE
    assert return_disposition("Customer Changed Mind") == InventoryDisposition.AVAILABLE
    assert return_disposition("expired") == InventoryDisposition.EXPIRED
    assert return_disposition("manufacturing-defect") == InventoryDisposition.QUARANTINE
    assert return_disposition("quality issue") == InventoryDisposition.QUARANTINE
    assert return_disposition("unknown") == InventoryDisposition.DAMAGED


def test_document_prefix_defaults_and_overrides():
    assert document_prefix(DocumentFamily.RETURN) == "RET"
    assert document_prefix(DocumentFamily.RETURN, {"return": "RMA"}) == "RMA"
    assert document_prefix(DocumentFamily.INVOICE, {DocumentFamily.INVOICE: "BILL"}) == "BILL"


def test_backward_compatible_service_imports_still_work():
    assert InventoryMovementService.__name__ == "InventoryMovementService"
