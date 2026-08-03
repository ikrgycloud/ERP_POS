from datetime import date
from decimal import Decimal

import pytest

from shared_domain.inventory import InventoryMovement, InventoryMovementService, InventoryMovementType
from shared_domain.reverse_logistics import (
    ApprovalAction,
    ApprovalDecision,
    ApprovalEngine,
    ApprovalLevel,
    DecisionEngine,
    DecisionInput,
    DispositionDecision,
    InspectionOutcome,
    InspectionReport,
    ItemQuantityState,
    QualityInspectionEngine,
    ReverseLogisticsModule,
    SupplierResponseEngine,
    SupplierResponseLine,
    SupplierResponseType,
    SupplierReturnItemDraft,
    WorkflowEngine,
    WorkflowStatus,
    WorkflowTransition,
)


def test_workflow_engine_validates_configured_transitions():
    statuses = {
        "draft": WorkflowStatus(
            code="draft",
            label="Draft",
            module=ReverseLogisticsModule.SUPPLIER_RETURN,
            is_initial=True,
            allowed_next=("pending_approval",),
        ),
        "pending_approval": WorkflowStatus(
            code="pending_approval",
            label="Pending Approval",
            module=ReverseLogisticsModule.SUPPLIER_RETURN,
            allowed_next=("approved", "rejected"),
        ),
        "approved": WorkflowStatus(
            code="approved",
            label="Approved",
            module=ReverseLogisticsModule.SUPPLIER_RETURN,
            allowed_next=("ready_for_shipment",),
        ),
    }
    WorkflowEngine().assert_transition(
        WorkflowTransition(
            module=ReverseLogisticsModule.SUPPLIER_RETURN,
            entity_id=1,
            from_status="draft",
            to_status="pending_approval",
            actor_id=10,
        ),
        statuses,
    )
    with pytest.raises(ValueError):
        WorkflowEngine().assert_transition(
            WorkflowTransition(
                module=ReverseLogisticsModule.SUPPLIER_RETURN,
                entity_id=1,
                from_status="draft",
                to_status="approved",
                actor_id=10,
            ),
            statuses,
        )


def test_approval_engine_enforces_ordered_configured_levels():
    levels = [
        ApprovalLevel(level_order=1, role_code="inventory_manager"),
        ApprovalLevel(level_order=2, role_code="purchase_manager"),
    ]
    first = ApprovalAction(
        level_order=1,
        approver_id=11,
        role_code="inventory_manager",
        decision=ApprovalDecision.APPROVED,
    )
    ApprovalEngine().assert_action(first, levels, [])
    second = ApprovalAction(
        level_order=2,
        approver_id=12,
        role_code="purchase_manager",
        decision=ApprovalDecision.APPROVED,
    )
    ApprovalEngine().assert_action(second, levels, [first])
    with pytest.raises(ValueError):
        ApprovalEngine().assert_action(second, levels, [])


def test_inspection_and_decision_engine_block_bad_return_to_shelf():
    report = InspectionReport(
        damaged_inventory_id=1,
        product_id=2,
        inspected_by=3,
        inspected_quantity=Decimal("2"),
        outcome=InspectionOutcome.MANUFACTURING_DEFECT,
        decision=DispositionDecision.RETURN_TO_SUPPLIER,
    )
    QualityInspectionEngine().validate_report(report)
    assert DecisionEngine().decide(
        DecisionInput(
            outcome=InspectionOutcome.MANUFACTURING_DEFECT,
            available_quantity=Decimal("5"),
            requested_quantity=Decimal("2"),
        )
    ) == DispositionDecision.RETURN_TO_SUPPLIER
    with pytest.raises(ValueError):
        DecisionEngine().decide(
            DecisionInput(
                outcome=InspectionOutcome.DAMAGED,
                available_quantity=Decimal("5"),
                requested_quantity=Decimal("1"),
                preferred_decision=DispositionDecision.RETURN_TO_SHELF,
            )
        )


def test_supplier_return_item_quantity_cannot_exceed_damaged_available():
    item = SupplierReturnItemDraft(
        damaged_inventory_id=1,
        product_id=2,
        quantity=Decimal("3"),
    )
    DecisionEngine().assert_supplier_return_item(item, Decimal("3"))
    with pytest.raises(ValueError):
        DecisionEngine().assert_supplier_return_item(item, Decimal("2"))


def test_supplier_response_engine_supports_partial_outcomes():
    state = ItemQuantityState(requested=Decimal("10"), shipped=Decimal("10"))
    engine = SupplierResponseEngine()
    state = engine.apply_response(
        state,
        SupplierResponseLine(
            supplier_return_item_id=1,
            response_type=SupplierResponseType.PARTIAL_REPLACE,
            quantity=Decimal("6"),
            response_date=date.today(),
        ),
    )
    state = engine.apply_response(
        state,
        SupplierResponseLine(
            supplier_return_item_id=1,
            response_type=SupplierResponseType.PARTIAL_REJECT,
            quantity=Decimal("2"),
            response_date=date.today(),
        ),
    )
    state = engine.apply_response(
        state,
        SupplierResponseLine(
            supplier_return_item_id=1,
            response_type=SupplierResponseType.CREDIT_NOTE,
            quantity=Decimal("1"),
            amount=Decimal("100"),
            response_date=date.today(),
        ),
    )
    assert state.accepted == Decimal("7")
    assert state.rejected == Decimal("2")
    assert state.credited == Decimal("1")


def test_inventory_service_accepts_reverse_logistics_movements():
    result = InventoryMovementService().apply(
        InventoryMovement(
            movement_type=InventoryMovementType.SUPPLIER_RETURN,
            product_id=1,
            quantity=Decimal("2"),
            reference_type="supplier_return_item",
            reference_id="1",
        ),
        current_stock=Decimal("10"),
    )
    assert result.new_stock == Decimal("10")
    assert result.ledger_entry.ledger_type == "SUPPLIER_RETURN"

    replacement = InventoryMovementService().apply(
        InventoryMovement(
            movement_type=InventoryMovementType.SUPPLIER_REPLACEMENT,
            product_id=1,
            quantity=Decimal("2"),
            reference_type="supplier_return_item",
            reference_id="1",
        ),
        current_stock=Decimal("10"),
    )
    assert replacement.new_stock == Decimal("12")
    assert replacement.ledger_entry.ledger_type == "SUPPLIER_REPLACEMENT"
