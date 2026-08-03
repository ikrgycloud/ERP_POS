"""Reverse logistics application service.

SupplierReturn is the aggregate root. API routes are intentionally absent from
this module; callers pass commands and commit/rollback the surrounding session.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from app.models import (
    DamagedInventory,
    InspectionReport,
    InventoryLedger,
    Product,
    Supplier,
    SupplierReturn,
    SupplierReturnApprovalHistory,
    SupplierReturnCreditNote,
    SupplierReturnItem,
    SupplierReturnReplacement,
    SupplierReturnResponse,
    SupplierReturnShipment,
    SupplierReturnStatusHistory,
    WorkflowStatus,
)
from app.repositories.reverse_logistics import ReverseLogisticsRepository
from shared_domain.events import (
    InventoryChanged,
    SupplierReturnApproved,
    SupplierReturnCreated,
    SupplierReturnInspectionRecorded,
    SupplierReturnResponseRecorded,
    SupplierReturnStatusChanged,
)
from shared_domain.inventory import InventoryMovement, InventoryMovementService, InventoryMovementType
from shared_domain.reverse_logistics import (
    ApprovalAction,
    ApprovalDecision,
    ApprovalEngine,
    ApprovalLevel as DomainApprovalLevel,
    DecisionEngine,
    DispositionDecision,
    InspectionOutcome,
    InspectionReport as DomainInspectionReport,
    ItemQuantityState,
    QualityInspectionEngine,
    ReverseLogisticsModule,
    SupplierResponseEngine,
    SupplierResponseLine,
    SupplierResponseType,
    SupplierReturnItemDraft,
    WorkflowEngine,
    WorkflowStatus as DomainWorkflowStatus,
    WorkflowTransition,
)


class ReverseLogisticsError(ValueError):
    """Base business exception for reverse logistics services."""


class ReverseLogisticsNotFound(ReverseLogisticsError):
    """Raised when a required aggregate/entity does not exist."""


class ReverseLogisticsConcurrencyError(ReverseLogisticsError):
    """Raised when optimistic concurrency version checks fail."""


@dataclass(frozen=True, slots=True)
class SupplierReturnLineCommand:
    damaged_inventory_id: int
    product_id: int
    quantity: Decimal
    reason: str | None = None
    inspection_report_id: int | None = None


@dataclass(frozen=True, slots=True)
class CreateSupplierReturnCommand:
    business_profile_id: int
    supplier_id: int
    rtv_number: str
    created_by_staff_id: int | None
    outlet_id: int | None = None
    purchase_order_id: int | None = None
    purchase_invoice_id: int | None = None
    reason: str | None = None
    remarks: str | None = None
    lines: tuple[SupplierReturnLineCommand, ...] = ()


@dataclass(frozen=True, slots=True)
class InspectionCommand:
    business_profile_id: int
    damaged_inventory_id: int
    product_id: int
    inspected_by_staff_id: int
    inspected_quantity: Decimal
    outcome: InspectionOutcome
    decision: DispositionDecision | None = None
    reason: str | None = None
    remarks: str | None = None
    photo_urls: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class TransitionCommand:
    supplier_return_id: int
    to_status: str
    actor_staff_id: int | None
    expected_version: int
    remarks: str | None = None


@dataclass(frozen=True, slots=True)
class ApprovalCommand:
    supplier_return_id: int
    approver_staff_id: int
    role_code: str
    decision: ApprovalDecision
    expected_version: int
    remarks: str | None = None


@dataclass(frozen=True, slots=True)
class ShipmentCommand:
    supplier_return_id: int
    actor_staff_id: int | None
    expected_version: int
    carrier_name: str | None = None
    transport_mode: str | None = None
    tracking_number: str | None = None
    vehicle_number: str | None = None
    driver_name: str | None = None
    driver_phone: str | None = None
    shipment_date: datetime | None = None
    expected_delivery_at: datetime | None = None
    remarks: str | None = None


@dataclass(frozen=True, slots=True)
class SupplierResponseCommand:
    supplier_return_id: int
    supplier_return_item_id: int
    recorded_by_staff_id: int
    response_type: SupplierResponseType
    quantity: Decimal
    expected_item_version: int
    amount: Decimal = Decimal("0")
    supplier_reference: str | None = None
    remarks: str | None = None
    replacement_product_id: int | None = None
    credit_note_number: str | None = None


class ReverseLogisticsService:
    def __init__(self, repository: ReverseLogisticsRepository):
        self.repository = repository

    def create_supplier_return(self, command: CreateSupplierReturnCommand) -> SupplierReturn:
        if not command.lines:
            raise ReverseLogisticsError("Supplier return must contain at least one item")
        supplier = self.repository.get_supplier(command.supplier_id)
        if supplier is None:
            raise ReverseLogisticsNotFound("Supplier not found")
        draft_status = self._status(command.business_profile_id, ReverseLogisticsModule.SUPPLIER_RETURN, "draft")
        item_status = self._status(
            command.business_profile_id,
            ReverseLogisticsModule.SUPPLIER_RETURN_ITEM,
            "pending_inspection",
        )

        supplier_return = SupplierReturn(
            business_profile_id=command.business_profile_id,
            supplier_id=command.supplier_id,
            outlet_id=command.outlet_id,
            rtv_number=command.rtv_number,
            purchase_order_id=command.purchase_order_id,
            purchase_invoice_id=command.purchase_invoice_id,
            current_status_id=draft_status.id,
            created_by_staff_id=command.created_by_staff_id,
            reason=command.reason,
            remarks=command.remarks,
            supplier_snapshot=self._supplier_snapshot(supplier),
            document_snapshot={"rtv_number": command.rtv_number},
        )
        self.repository.add_supplier_return(supplier_return)

        for line in command.lines:
            damaged = self._damaged(line.damaged_inventory_id, lock=True)
            product = self._product(line.product_id)
            if damaged.product_id != line.product_id:
                raise ReverseLogisticsError("Damaged inventory product mismatch")
            DecisionEngine().assert_supplier_return_item(
                SupplierReturnItemDraft(
                    damaged_inventory_id=line.damaged_inventory_id,
                    product_id=line.product_id,
                    quantity=line.quantity,
                    reason=line.reason,
                    inspection_report_id=line.inspection_report_id,
                ),
                Decimal(damaged.available_quantity or 0),
            )
            damaged.available_quantity = Decimal(damaged.available_quantity or 0) - Decimal(line.quantity)
            damaged.returned_to_supplier_quantity = Decimal(damaged.returned_to_supplier_quantity or 0) + Decimal(line.quantity)
            damaged.version = int(damaged.version or 1) + 1
            supplier_return.items.append(
                SupplierReturnItem(
                    business_profile_id=command.business_profile_id,
                    damaged_inventory_id=line.damaged_inventory_id,
                    inspection_report_id=line.inspection_report_id,
                    product_id=line.product_id,
                    return_id=damaged.return_id,
                    return_item_id=damaged.return_item_id,
                    current_status_id=item_status.id,
                    quantity_requested=line.quantity,
                    unit_cost=product.buy_price,
                    reason=line.reason,
                    product_snapshot=self._product_snapshot(product),
                    source_snapshot=self._damaged_snapshot(damaged),
                )
            )

        self.repository.flush()
        self._add_status_history(
            supplier_return,
            None,
            draft_status,
            action="created",
            actor_id=command.created_by_staff_id,
            remarks=command.remarks,
        )
        self.repository.add_domain_event(
            SupplierReturnCreated(
                business_profile_id=command.business_profile_id,
                outlet_id=command.outlet_id,
                supplier_return_id=supplier_return.id,
                rtv_number=supplier_return.rtv_number,
            ),
            "supplier_return",
            str(supplier_return.id),
        )
        self.repository.flush()
        return supplier_return

    def record_inspection(self, command: InspectionCommand) -> InspectionReport:
        damaged = self._damaged(command.damaged_inventory_id, lock=True)
        if damaged.product_id != command.product_id:
            raise ReverseLogisticsError("Inspection product does not match damaged inventory")
        decision = command.decision or QualityInspectionEngine().recommended_decision(command.outcome)
        domain_report = DomainInspectionReport(
            damaged_inventory_id=command.damaged_inventory_id,
            product_id=command.product_id,
            inspected_by=command.inspected_by_staff_id,
            inspected_quantity=command.inspected_quantity,
            outcome=command.outcome,
            decision=decision,
            reason=command.reason,
            remarks=command.remarks,
            photo_urls=command.photo_urls,
        )
        QualityInspectionEngine().validate_report(domain_report)
        available_for_inspection = Decimal(damaged.quantity or 0) - Decimal(damaged.inspected_quantity or 0)
        if command.inspected_quantity > available_for_inspection:
            raise ReverseLogisticsError("Inspection quantity exceeds remaining damaged quantity")

        damaged.inspected_quantity = Decimal(damaged.inspected_quantity or 0) + command.inspected_quantity
        damaged.inspection_status = "completed" if damaged.inspected_quantity >= damaged.quantity else "partial"
        damaged.version = int(damaged.version or 1) + 1
        report = InspectionReport(
            business_profile_id=command.business_profile_id,
            damaged_inventory_id=command.damaged_inventory_id,
            product_id=command.product_id,
            return_id=damaged.return_id,
            return_item_id=damaged.return_item_id,
            inspected_by_staff_id=command.inspected_by_staff_id,
            inspected_quantity=command.inspected_quantity,
            outcome=command.outcome.value,
            decision=decision.value,
            reason=command.reason,
            remarks=command.remarks,
            photos=list(command.photo_urls),
        )
        self.repository.add_inspection_report(report)
        self.repository.flush()
        self.repository.add_domain_event(
            SupplierReturnInspectionRecorded(
                business_profile_id=command.business_profile_id,
                outlet_id=damaged.outlet_id,
                inspection_report_id=report.id,
                damaged_inventory_id=damaged.id,
                decision=decision.value,
            ),
            "inspection_report",
            str(report.id),
        )
        return report

    def transition_supplier_return(self, command: TransitionCommand) -> SupplierReturn:
        supplier_return = self._supplier_return(command.supplier_return_id, lock=True)
        self._assert_version(supplier_return.version, command.expected_version, "supplier return")
        statuses = self._workflow_statuses(
            supplier_return.business_profile_id,
            ReverseLogisticsModule.SUPPLIER_RETURN,
        )
        current = supplier_return.current_status
        if current is None:
            raise ReverseLogisticsError("Supplier return has no current status")
        target = statuses.get(command.to_status)
        if target is None:
            raise ReverseLogisticsError(f"Unknown supplier return status: {command.to_status}")
        WorkflowEngine().assert_transition(
            WorkflowTransition(
                module=ReverseLogisticsModule.SUPPLIER_RETURN,
                entity_id=supplier_return.id,
                from_status=current.code,
                to_status=target.code,
                actor_id=command.actor_staff_id,
                remarks=command.remarks,
            ),
            statuses,
        )
        supplier_return.current_status_id = target.id
        supplier_return.version += 1
        if target.code == "closed":
            supplier_return.closed_at = datetime.now(timezone.utc)
        self._add_status_history(supplier_return, current, target, "transition", command.actor_staff_id, command.remarks)
        self.repository.add_domain_event(
            SupplierReturnStatusChanged(
                business_profile_id=supplier_return.business_profile_id,
                outlet_id=supplier_return.outlet_id,
                supplier_return_id=supplier_return.id,
                from_status=current.code,
                to_status=target.code,
            ),
            "supplier_return",
            str(supplier_return.id),
        )
        return supplier_return

    def approve_supplier_return(self, command: ApprovalCommand) -> SupplierReturn:
        supplier_return = self._supplier_return(command.supplier_return_id, lock=True)
        self._assert_version(supplier_return.version, command.expected_version, "supplier return")
        levels = self.repository.list_approval_levels(
            supplier_return.business_profile_id,
            ReverseLogisticsModule.SUPPLIER_RETURN.value,
        )
        if not levels:
            raise ReverseLogisticsError("No approval hierarchy is configured")
        actions = self.repository.list_approval_actions(supplier_return.id)
        domain_levels = [
            DomainApprovalLevel(
                level_order=level.level_order,
                role_code=level.role_code,
                required_approvals=level.required_approvals,
                module=ReverseLogisticsModule.SUPPLIER_RETURN,
            )
            for level in levels
        ]
        domain_actions = [
            ApprovalAction(
                level_order=self._approval_level_order(action, levels),
                approver_id=action.approver_staff_id or 0,
                role_code=self._approval_role(action, levels),
                decision=ApprovalDecision(action.decision),
                remarks=action.remarks,
            )
            for action in actions
        ]
        next_level = ApprovalEngine().next_level(domain_levels, domain_actions)
        if next_level is None:
            raise ReverseLogisticsError("Approval workflow is already complete")
        action = ApprovalAction(
            level_order=next_level.level_order,
            approver_id=command.approver_staff_id,
            role_code=command.role_code,
            decision=command.decision,
            remarks=command.remarks,
        )
        ApprovalEngine().assert_action(action, domain_levels, domain_actions)
        level_model = next(level for level in levels if level.level_order == next_level.level_order)
        history = SupplierReturnApprovalHistory(
            supplier_return_id=supplier_return.id,
            approval_level_id=level_model.id,
            approver_staff_id=command.approver_staff_id,
            decision=command.decision.value,
            remarks=command.remarks,
        )
        self.repository.add_approval_history(history)
        supplier_return.version += 1
        if command.decision == ApprovalDecision.REJECTED:
            supplier_return.approval_status = "rejected"
        else:
            complete_after_action = ApprovalEngine().next_level(domain_levels, [*domain_actions, action]) is None
            supplier_return.approval_status = "approved" if complete_after_action else "pending"
        if supplier_return.approval_status == "approved":
            self.repository.add_domain_event(
                SupplierReturnApproved(
                    business_profile_id=supplier_return.business_profile_id,
                    outlet_id=supplier_return.outlet_id,
                    supplier_return_id=supplier_return.id,
                    approved_by=command.approver_staff_id,
                ),
                "supplier_return",
                str(supplier_return.id),
            )
        return supplier_return

    def create_shipment(self, command: ShipmentCommand) -> SupplierReturnShipment:
        supplier_return = self._supplier_return(command.supplier_return_id, lock=True)
        self._assert_version(supplier_return.version, command.expected_version, "supplier return")
        shipment = SupplierReturnShipment(
            supplier_return_id=supplier_return.id,
            carrier_name=command.carrier_name,
            transport_mode=command.transport_mode,
            tracking_number=command.tracking_number,
            vehicle_number=command.vehicle_number,
            driver_name=command.driver_name,
            driver_phone=command.driver_phone,
            shipment_date=command.shipment_date,
            expected_delivery_at=command.expected_delivery_at,
            status="created",
            remarks=command.remarks,
        )
        supplier_return.shipment_status = "created"
        supplier_return.version += 1
        self.repository.add_shipment(shipment)
        return shipment

    def record_supplier_response(self, command: SupplierResponseCommand) -> SupplierReturnItem:
        supplier_return = self._supplier_return(command.supplier_return_id, lock=True)
        item = self._supplier_return_item(command.supplier_return_item_id, lock=True)
        if item.supplier_return_id != supplier_return.id:
            raise ReverseLogisticsError("Supplier response item does not belong to the supplier return")
        self._assert_version(item.version, command.expected_item_version, "supplier return item")
        current_state = ItemQuantityState(
            requested=Decimal(item.quantity_requested or 0),
            shipped=Decimal(item.quantity_shipped or 0),
            accepted=Decimal(item.quantity_supplier_accepted or 0),
            rejected=Decimal(item.quantity_supplier_rejected or 0),
            replaced=Decimal(item.quantity_replaced or 0),
            credited=Decimal(item.quantity_credited or 0),
            refunded=Decimal(item.quantity_refunded or 0),
        )
        new_state = SupplierResponseEngine().apply_response(
            current_state,
            SupplierResponseLine(
                supplier_return_item_id=item.id,
                response_type=command.response_type,
                quantity=command.quantity,
                amount=command.amount,
                reference_number=command.supplier_reference,
                remarks=command.remarks,
            ),
        )
        item.quantity_supplier_accepted = new_state.accepted
        item.quantity_supplier_rejected = new_state.rejected
        item.quantity_replaced = new_state.replaced
        item.quantity_credited = new_state.credited
        item.quantity_refunded = new_state.refunded
        item.version += 1
        supplier_return.version += 1
        response = SupplierReturnResponse(
            supplier_return_id=supplier_return.id,
            supplier_return_item_id=item.id,
            response_type=command.response_type.value,
            quantity=command.quantity,
            amount=command.amount,
            supplier_reference=command.supplier_reference,
            recorded_by_staff_id=command.recorded_by_staff_id,
            remarks=command.remarks,
        )
        self.repository.add_supplier_response(response)
        if command.response_type in {SupplierResponseType.REPLACE, SupplierResponseType.PARTIAL_REPLACE}:
            self._record_replacement(supplier_return, item, command)
        if command.response_type == SupplierResponseType.CREDIT_NOTE and command.credit_note_number:
            self.repository.add_credit_note(
                SupplierReturnCreditNote(
                    supplier_return_id=supplier_return.id,
                    supplier_return_item_id=item.id,
                    supplier_id=supplier_return.supplier_id,
                    credit_note_number=command.credit_note_number,
                    amount=command.amount,
                    status="issued",
                    remarks=command.remarks,
                )
            )
        self.repository.add_domain_event(
            SupplierReturnResponseRecorded(
                business_profile_id=supplier_return.business_profile_id,
                outlet_id=supplier_return.outlet_id,
                supplier_return_id=supplier_return.id,
                supplier_return_item_id=item.id,
                response_type=command.response_type.value,
                quantity=command.quantity,
            ),
            "supplier_return_item",
            str(item.id),
        )
        return item

    def _record_replacement(
        self,
        supplier_return: SupplierReturn,
        item: SupplierReturnItem,
        command: SupplierResponseCommand,
    ) -> None:
        product = self._product(command.replacement_product_id or item.product_id, lock=True)
        result = InventoryMovementService().apply(
            InventoryMovement(
                movement_type=InventoryMovementType.SUPPLIER_REPLACEMENT,
                product_id=product.id,
                quantity=command.quantity,
                business_profile_id=supplier_return.business_profile_id,
                outlet_id=supplier_return.outlet_id,
                reason="supplier_replacement",
                reference_type="supplier_return_item",
                reference_id=str(item.id),
                idempotency_key=f"supplier-replacement:{item.id}:{item.version + 1}",
                user_id=str(command.recorded_by_staff_id),
                source="ERP",
            ),
            current_stock=Decimal(product.stock_cached or 0),
        )
        product.stock_cached = result.new_stock
        self.repository.add_inventory_ledger(
            InventoryLedger(
                product_id=product.id,
                business_profile_id=supplier_return.business_profile_id,
                outlet_id=supplier_return.outlet_id,
                type=result.ledger_entry.ledger_type,
                quantity=result.ledger_entry.quantity_delta,
                idempotency_key=result.ledger_entry.idempotency_key,
                user_id=result.ledger_entry.user_id,
                source=result.ledger_entry.source,
                reference_type=result.ledger_entry.reference_type,
                reference_id=result.ledger_entry.reference_id,
            )
        )
        self.repository.add_replacement(
            SupplierReturnReplacement(
                supplier_return_id=supplier_return.id,
                supplier_return_item_id=item.id,
                product_id=item.product_id,
                replacement_product_id=command.replacement_product_id,
                quantity=command.quantity,
                received_at=datetime.now(timezone.utc),
                remarks=command.remarks,
            )
        )
        self.repository.add_domain_event(
            InventoryChanged(
                business_profile_id=supplier_return.business_profile_id,
                outlet_id=supplier_return.outlet_id,
                product_id=product.id,
                movement_type=InventoryMovementType.SUPPLIER_REPLACEMENT.value,
                quantity=command.quantity,
            ),
            "product",
            str(product.id),
        )

    def _supplier_return(self, supplier_return_id: int, *, lock: bool) -> SupplierReturn:
        supplier_return = self.repository.get_supplier_return(supplier_return_id, lock=lock)
        if supplier_return is None:
            raise ReverseLogisticsNotFound("Supplier return not found")
        return supplier_return

    def _supplier_return_item(self, item_id: int, *, lock: bool) -> SupplierReturnItem:
        item = self.repository.get_supplier_return_item(item_id, lock=lock)
        if item is None:
            raise ReverseLogisticsNotFound("Supplier return item not found")
        return item

    def _damaged(self, damaged_inventory_id: int, *, lock: bool) -> DamagedInventory:
        damaged = self.repository.get_damaged_inventory(damaged_inventory_id, lock=lock)
        if damaged is None:
            raise ReverseLogisticsNotFound("Damaged inventory not found")
        return damaged

    def _product(self, product_id: int, *, lock: bool = False) -> Product:
        product = self.repository.get_product(product_id, lock=lock)
        if product is None:
            raise ReverseLogisticsNotFound("Product not found")
        return product

    def _status(
        self,
        business_profile_id: int,
        module: ReverseLogisticsModule,
        code: str,
    ) -> WorkflowStatus:
        status = self.repository.get_workflow_status(business_profile_id, module.value, code)
        if status is None:
            raise ReverseLogisticsNotFound(f"Workflow status not configured: {module.value}.{code}")
        return status

    def _workflow_statuses(
        self,
        business_profile_id: int,
        module: ReverseLogisticsModule,
    ) -> dict[str, DomainWorkflowStatus]:
        statuses = self.repository.list_workflow_statuses(business_profile_id, module.value)
        return {
            status.code: DomainWorkflowStatus(
                code=status.code,
                label=status.label,
                module=module,
                sequence=status.sequence,
                is_initial=status.is_initial,
                is_terminal=status.is_terminal,
                allowed_next=tuple(status.allowed_next or ()),
            )
            for status in statuses
        }

    def _add_status_history(
        self,
        supplier_return: SupplierReturn,
        old_status: WorkflowStatus | None,
        new_status: WorkflowStatus,
        action: str,
        actor_id: int,
        remarks: str | None,
    ) -> None:
        self.repository.add_status_history(
            SupplierReturnStatusHistory(
                supplier_return_id=supplier_return.id,
                old_status_id=old_status.id if old_status else None,
                new_status_id=new_status.id,
                action=action,
                changed_by_staff_id=actor_id,
                remarks=remarks,
            )
        )

    def _assert_version(self, current: int, expected: int, label: str) -> None:
        if int(current or 1) != int(expected):
            raise ReverseLogisticsConcurrencyError(f"Stale {label}; reload before retrying")

    def _approval_level_order(self, action: SupplierReturnApprovalHistory, levels) -> int:
        return next((level.level_order for level in levels if level.id == action.approval_level_id), 0)

    def _approval_role(self, action: SupplierReturnApprovalHistory, levels) -> str:
        return next((level.role_code for level in levels if level.id == action.approval_level_id), "")

    def _supplier_snapshot(self, supplier: Supplier) -> dict:
        return {
            "id": supplier.id,
            "name": supplier.name,
            "mobile": supplier.mobile,
            "email": supplier.email,
            "address": supplier.address,
            "gstin": supplier.gstin,
        }

    def _product_snapshot(self, product: Product) -> dict:
        return {
            "id": product.id,
            "sku": product.sku,
            "name": product.name,
            "barcode": product.barcode,
            "supplier_id": product.supplier_id,
            "supplier": product.supplier,
            "unit_type": product.unit_type,
            "unit_label": product.unit_label,
            "buy_price": str(product.buy_price),
            "mrp": str(product.mrp),
            "gst_rate": str(product.gst_rate),
        }

    def _damaged_snapshot(self, damaged: DamagedInventory) -> dict:
        return {
            "id": damaged.id,
            "return_id": damaged.return_id,
            "return_item_id": damaged.return_item_id,
            "damage_type": damaged.damage_type,
            "disposition": damaged.disposition,
            "lot_number": damaged.lot_number,
            "expiry_date": damaged.expiry_date.isoformat() if damaged.expiry_date else None,
        }
