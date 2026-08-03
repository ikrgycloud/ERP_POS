from dataclasses import FrozenInstanceError
from datetime import date
from decimal import Decimal

import pytest

from shared_domain.common.validation import (
    is_strong_password,
    is_valid_gstin,
    is_valid_phone,
    validate_non_negative_quantity,
    validate_positive_money,
)
from shared_domain.core.contracts import (
    AuditService,
    CustomerStatisticsService,
    DashboardAggregationService,
    DocumentNumberService,
    FinancialLedgerService,
    InventoryMovementService,
    InvoiceService,
    PaymentService,
    ProductStatisticsService,
    ReportService,
    ReturnService,
)
from shared_domain.documents import DocumentFamily
from shared_domain.events import (
    CustomerUpdated,
    DashboardInvalidated,
    InventoryChanged,
    InvoiceCreated,
    PaymentRecorded,
    ProductUpdated,
    RefundCompleted,
    ReportInvalidated,
    ReturnApproved,
    SaleCompleted,
)
from shared_domain.finance import FinancialEntry, FinancialLedgerType
from shared_domain.inventory import InventoryMovement, InventoryMovementType
from shared_domain.returns import ReturnApproval


def test_domain_dtos_are_immutable_and_validate_values():
    movement = InventoryMovement(
        movement_type=InventoryMovementType.SALE,
        product_id=1,
        quantity=Decimal("2"),
    )
    with pytest.raises(FrozenInstanceError):
        movement.quantity = Decimal("3")
    with pytest.raises(ValueError):
        InventoryMovement(InventoryMovementType.SALE, 0, Decimal("1"))
    with pytest.raises(ValueError):
        InventoryMovement(InventoryMovementType.SALE, 1, Decimal("0"))

    approval = ReturnApproval(return_id=1, approved_by=2, approval_date=date.today())
    assert approval.return_id == 1
    with pytest.raises(ValueError):
        ReturnApproval(return_id=0, approved_by=2, approval_date=date.today())

    entry = FinancialEntry(
        entry_type=FinancialLedgerType.SALE,
        amount=Decimal("10.00"),
    )
    assert entry.currency == "INR"
    with pytest.raises(ValueError):
        FinancialEntry(FinancialLedgerType.REFUND, Decimal("-1"))


def test_domain_events_are_contracts_with_identity_and_time():
    events = [
        SaleCompleted(invoice_id=1, amount=Decimal("10")),
        ReturnApproved(return_id=1, approved_by=2),
        InventoryChanged(product_id=1, movement_type="sale", quantity=Decimal("1")),
        InvoiceCreated(invoice_id=1, invoice_number="INV-1"),
        PaymentRecorded(payment_id=1, amount=Decimal("10")),
        RefundCompleted(return_id=1, amount=Decimal("10")),
        CustomerUpdated(customer_id=1),
        ProductUpdated(product_id=1),
        DashboardInvalidated(),
        ReportInvalidated(report_name="revenue"),
    ]
    assert all(event.event_id for event in events)
    assert all(event.occurred_at.tzinfo is not None for event in events)


def test_validation_helpers_are_framework_neutral():
    assert is_valid_phone("+91 9876543210")
    assert not is_valid_phone("abc")
    assert is_strong_password("Strong123")
    assert not is_strong_password("weakpass")
    assert is_valid_gstin("29ABCDE1234F1Z5")
    assert not is_valid_gstin("bad")
    validate_positive_money(Decimal("0.01"))
    validate_non_negative_quantity(Decimal("0"))
    with pytest.raises(ValueError):
        validate_positive_money(Decimal("0"))
    with pytest.raises(ValueError):
        validate_non_negative_quantity(Decimal("-0.001"))


def test_contracts_are_importable_from_new_core_package():
    contracts = [
        AuditService,
        CustomerStatisticsService,
        DashboardAggregationService,
        DocumentNumberService,
        FinancialLedgerService,
        InventoryMovementService,
        InvoiceService,
        PaymentService,
        ProductStatisticsService,
        ReportService,
        ReturnService,
    ]
    assert all(contract.__name__.endswith("Service") for contract in contracts)
    assert DocumentFamily.INVOICE.value == "invoice"
