"""Reverse logistics repository contracts and SQLAlchemy adapters."""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Protocol

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.models import (
    ApprovalLevel,
    DamagedInventory,
    DomainEventRecord,
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
from shared_domain.events import DomainEvent


class ReverseLogisticsRepository(Protocol):
    def get_supplier_return(self, supplier_return_id: int, *, lock: bool = False) -> SupplierReturn | None: ...
    def add_supplier_return(self, supplier_return: SupplierReturn) -> SupplierReturn: ...
    def get_supplier_return_item(self, item_id: int, *, lock: bool = False) -> SupplierReturnItem | None: ...
    def get_damaged_inventory(self, damaged_inventory_id: int, *, lock: bool = False) -> DamagedInventory | None: ...
    def get_product(self, product_id: int, *, lock: bool = False) -> Product | None: ...
    def get_supplier(self, supplier_id: int) -> Supplier | None: ...
    def get_workflow_status(self, business_profile_id: int, module: str, code: str) -> WorkflowStatus | None: ...
    def list_workflow_statuses(self, business_profile_id: int, module: str) -> list[WorkflowStatus]: ...
    def list_approval_levels(self, business_profile_id: int, module: str) -> list[ApprovalLevel]: ...
    def list_approval_actions(self, supplier_return_id: int) -> list[SupplierReturnApprovalHistory]: ...
    def add_inspection_report(self, report: InspectionReport) -> InspectionReport: ...
    def add_status_history(self, history: SupplierReturnStatusHistory) -> SupplierReturnStatusHistory: ...
    def add_approval_history(self, history: SupplierReturnApprovalHistory) -> SupplierReturnApprovalHistory: ...
    def add_supplier_response(self, response: SupplierReturnResponse) -> SupplierReturnResponse: ...
    def add_replacement(self, replacement: SupplierReturnReplacement) -> SupplierReturnReplacement: ...
    def add_credit_note(self, credit_note: SupplierReturnCreditNote) -> SupplierReturnCreditNote: ...
    def add_shipment(self, shipment: SupplierReturnShipment) -> SupplierReturnShipment: ...
    def add_inventory_ledger(self, ledger: InventoryLedger) -> InventoryLedger: ...
    def add_domain_event(self, event: DomainEvent, aggregate_type: str, aggregate_id: str) -> DomainEventRecord: ...
    def flush(self) -> None: ...


def _json_safe(value):
    if is_dataclass(value):
        return _json_safe(asdict(value))
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    return value


class SqlAlchemyReverseLogisticsRepository:
    """Persistence adapter only; business rules stay in services/domain engines."""

    def __init__(self, db: Session):
        self.db = db

    def get_supplier_return(self, supplier_return_id: int, *, lock: bool = False) -> SupplierReturn | None:
        statement = (
            select(SupplierReturn)
            .options(selectinload(SupplierReturn.items), selectinload(SupplierReturn.current_status))
            .where(SupplierReturn.id == supplier_return_id)
        )
        if lock:
            statement = statement.with_for_update()
        return self.db.execute(statement).scalar_one_or_none()

    def add_supplier_return(self, supplier_return: SupplierReturn) -> SupplierReturn:
        self.db.add(supplier_return)
        return supplier_return

    def get_supplier_return_item(self, item_id: int, *, lock: bool = False) -> SupplierReturnItem | None:
        statement = select(SupplierReturnItem).where(SupplierReturnItem.id == item_id)
        if lock:
            statement = statement.with_for_update()
        return self.db.execute(statement).scalar_one_or_none()

    def get_damaged_inventory(self, damaged_inventory_id: int, *, lock: bool = False) -> DamagedInventory | None:
        statement = select(DamagedInventory).where(DamagedInventory.id == damaged_inventory_id)
        if lock:
            statement = statement.with_for_update()
        return self.db.execute(statement).scalar_one_or_none()

    def get_product(self, product_id: int, *, lock: bool = False) -> Product | None:
        statement = select(Product).where(Product.id == product_id)
        if lock:
            statement = statement.with_for_update()
        return self.db.execute(statement).scalar_one_or_none()

    def get_supplier(self, supplier_id: int) -> Supplier | None:
        return self.db.get(Supplier, supplier_id)

    def get_workflow_status(self, business_profile_id: int, module: str, code: str) -> WorkflowStatus | None:
        statement = (
            select(WorkflowStatus)
            .where(
                WorkflowStatus.module == module,
                WorkflowStatus.code == code,
                WorkflowStatus.is_active.is_(True),
                or_(
                    WorkflowStatus.business_profile_id == business_profile_id,
                    WorkflowStatus.business_profile_id.is_(None),
                ),
            )
            .order_by(WorkflowStatus.business_profile_id.desc().nullslast())
            .limit(1)
        )
        return self.db.execute(statement).scalar_one_or_none()

    def list_workflow_statuses(self, business_profile_id: int, module: str) -> list[WorkflowStatus]:
        statement = (
            select(WorkflowStatus)
            .where(
                WorkflowStatus.module == module,
                WorkflowStatus.is_active.is_(True),
                or_(
                    WorkflowStatus.business_profile_id == business_profile_id,
                    WorkflowStatus.business_profile_id.is_(None),
                ),
            )
            .order_by(WorkflowStatus.business_profile_id.desc().nullslast(), WorkflowStatus.sequence)
        )
        rows = self.db.execute(statement).scalars().all()
        by_code: dict[str, WorkflowStatus] = {}
        for row in rows:
            by_code.setdefault(row.code, row)
        return list(by_code.values())

    def list_approval_levels(self, business_profile_id: int, module: str) -> list[ApprovalLevel]:
        statement = (
            select(ApprovalLevel)
            .where(
                ApprovalLevel.module == module,
                ApprovalLevel.is_active.is_(True),
                or_(
                    ApprovalLevel.business_profile_id == business_profile_id,
                    ApprovalLevel.business_profile_id.is_(None),
                ),
            )
            .order_by(ApprovalLevel.business_profile_id.desc().nullslast(), ApprovalLevel.level_order)
        )
        rows = self.db.execute(statement).scalars().all()
        by_order: dict[int, ApprovalLevel] = {}
        for row in rows:
            by_order.setdefault(row.level_order, row)
        return list(by_order.values())

    def list_approval_actions(self, supplier_return_id: int) -> list[SupplierReturnApprovalHistory]:
        statement = (
            select(SupplierReturnApprovalHistory)
            .where(SupplierReturnApprovalHistory.supplier_return_id == supplier_return_id)
            .order_by(SupplierReturnApprovalHistory.decided_at)
        )
        return list(self.db.execute(statement).scalars().all())

    def add_inspection_report(self, report: InspectionReport) -> InspectionReport:
        self.db.add(report)
        return report

    def add_status_history(self, history: SupplierReturnStatusHistory) -> SupplierReturnStatusHistory:
        self.db.add(history)
        return history

    def add_approval_history(self, history: SupplierReturnApprovalHistory) -> SupplierReturnApprovalHistory:
        self.db.add(history)
        return history

    def add_supplier_response(self, response: SupplierReturnResponse) -> SupplierReturnResponse:
        self.db.add(response)
        return response

    def add_replacement(self, replacement: SupplierReturnReplacement) -> SupplierReturnReplacement:
        self.db.add(replacement)
        return replacement

    def add_credit_note(self, credit_note: SupplierReturnCreditNote) -> SupplierReturnCreditNote:
        self.db.add(credit_note)
        return credit_note

    def add_shipment(self, shipment: SupplierReturnShipment) -> SupplierReturnShipment:
        self.db.add(shipment)
        return shipment

    def add_inventory_ledger(self, ledger: InventoryLedger) -> InventoryLedger:
        self.db.add(ledger)
        return ledger

    def add_domain_event(self, event: DomainEvent, aggregate_type: str, aggregate_id: str) -> DomainEventRecord:
        record = DomainEventRecord(
            event_id=event.event_id,
            event_type=event.__class__.__name__,
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            business_profile_id=event.business_profile_id,
            payload=_json_safe(event),
            occurred_at=event.occurred_at,
        )
        self.db.add(record)
        return record

    def flush(self) -> None:
        self.db.flush()
