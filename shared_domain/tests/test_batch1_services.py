from decimal import Decimal

import pytest

from shared_domain.finance import PaymentRequest, PaymentService
from shared_domain.inventory import (
    InventoryDisposition,
    InventoryMovement,
    InventoryMovementService,
    InventoryMovementType,
)
from shared_domain.returns import ReturnService
from shared_domain.sales import InvoiceLine, InvoiceService


def test_inventory_service_sale_validates_stock_and_produces_ledger():
    service = InventoryMovementService()
    result = service.apply(
        InventoryMovement(InventoryMovementType.SALE, product_id=1, quantity=Decimal("2")),
        current_stock=Decimal("10"),
    )
    assert result.old_stock == Decimal("10")
    assert result.new_stock == Decimal("8")
    assert result.stock_delta == Decimal("-2")
    assert result.ledger_entry.ledger_type == "SALE"
    assert result.ledger_entry.quantity_delta == Decimal("-2")
    assert result.statistic_deltas == {"qty_sold": Decimal("2")}

    with pytest.raises(ValueError):
        service.apply(
            InventoryMovement(InventoryMovementType.SALE, product_id=1, quantity=Decimal("20")),
            current_stock=Decimal("1"),
        )


def test_inventory_service_return_routes_by_reason():
    service = InventoryMovementService()
    sellable = service.apply(
        InventoryMovement(InventoryMovementType.RETURN, 1, Decimal("1"), reason="billing_error"),
        current_stock=Decimal("5"),
    )
    assert sellable.disposition == InventoryDisposition.AVAILABLE
    assert sellable.new_stock == Decimal("6")

    quarantine = service.apply(
        InventoryMovement(
            InventoryMovementType.RETURN,
            1,
            Decimal("1"),
            reason="quality issue",
        ),
        current_stock=Decimal("5"),
    )
    assert quarantine.disposition == InventoryDisposition.QUARANTINE
    assert quarantine.new_stock == Decimal("5")
    assert quarantine.ledger_entry.quantity_delta == Decimal("0")
    assert quarantine.statistic_deltas["quarantine_qty"] == Decimal("1")

    damaged = service.apply(
        InventoryMovement(
            InventoryMovementType.RETURN,
            1,
            Decimal("1"),
            reason="damaged",
        ),
        current_stock=Decimal("5"),
    )
    assert damaged.disposition == InventoryDisposition.DAMAGED
    assert damaged.new_stock == Decimal("5")
    assert damaged.ledger_entry.quantity_delta == Decimal("0")
    assert damaged.statistic_deltas["returned_damaged_qty"] == Decimal("1")


def test_invoice_service_calculates_snapshots_and_totals():
    invoice = InvoiceService().create_invoice_draft(
        [
            InvoiceLine(
                product_id=1,
                product_name="Milk",
                quantity=Decimal("2"),
                unit_price=Decimal("50"),
                discount_pct=Decimal("10"),
                gst_rate=Decimal("5"),
            )
        ]
    )
    assert invoice.lines[0].discount_amount == Decimal("10.00")
    assert invoice.lines[0].taxable_value == Decimal("90.00")
    assert invoice.totals.grand_total == Decimal("94.50")


def test_return_service_validates_transition_and_line_refund():
    service = ReturnService()
    service.assert_transition("submitted", "verified")
    with pytest.raises(ValueError):
        service.assert_transition("submitted", "completed")

    discount, refund = service.line_refund(
        unit_price=Decimal("50"),
        return_quantity=Decimal("1"),
        sold_quantity=Decimal("2"),
        invoice_line_discount=Decimal("10"),
    )
    assert discount == Decimal("5.00")
    assert refund == Decimal("45.00")


def test_payment_service_validates_payment_and_refund():
    service = PaymentService()
    payment = service.record_payment(PaymentRequest(amount=Decimal("100"), method="cash"))
    assert payment.status == "paid"
    assert payment.direction == "in"

    refund = service.record_refund(
        PaymentRequest(amount=Decimal("50"), method="upi"),
        max_refundable=Decimal("50"),
    )
    assert refund.status == "refunded"
    assert refund.direction == "out"

    with pytest.raises(ValueError):
        service.record_refund(
            PaymentRequest(amount=Decimal("60"), method="upi"),
            max_refundable=Decimal("50"),
        )
