"""Domain event contracts only; dispatching comes later."""

from dataclasses import dataclass
from decimal import Decimal

from shared_domain.events.base import DomainEvent


@dataclass(frozen=True, slots=True)
class SaleCompleted(DomainEvent):
    invoice_id: int | None = None
    amount: Decimal | None = None


@dataclass(frozen=True, slots=True)
class ReturnApproved(DomainEvent):
    return_id: int | None = None
    approved_by: int | None = None


@dataclass(frozen=True, slots=True)
class InventoryChanged(DomainEvent):
    product_id: int | None = None
    movement_type: str | None = None
    quantity: Decimal | None = None


@dataclass(frozen=True, slots=True)
class InvoiceCreated(DomainEvent):
    invoice_id: int | None = None
    invoice_number: str | None = None


@dataclass(frozen=True, slots=True)
class PaymentRecorded(DomainEvent):
    payment_id: int | None = None
    amount: Decimal | None = None


@dataclass(frozen=True, slots=True)
class RefundCompleted(DomainEvent):
    return_id: int | None = None
    amount: Decimal | None = None


@dataclass(frozen=True, slots=True)
class CustomerUpdated(DomainEvent):
    customer_id: int | None = None


@dataclass(frozen=True, slots=True)
class ProductUpdated(DomainEvent):
    product_id: int | None = None


@dataclass(frozen=True, slots=True)
class DashboardInvalidated(DomainEvent):
    scope: str = "dashboard"


@dataclass(frozen=True, slots=True)
class ReportInvalidated(DomainEvent):
    report_name: str | None = None


@dataclass(frozen=True, slots=True)
class SupplierReturnCreated(DomainEvent):
    supplier_return_id: int | None = None
    rtv_number: str | None = None


@dataclass(frozen=True, slots=True)
class SupplierReturnStatusChanged(DomainEvent):
    supplier_return_id: int | None = None
    from_status: str | None = None
    to_status: str | None = None


@dataclass(frozen=True, slots=True)
class SupplierReturnApproved(DomainEvent):
    supplier_return_id: int | None = None
    approved_by: int | None = None


@dataclass(frozen=True, slots=True)
class SupplierReturnInspectionRecorded(DomainEvent):
    inspection_report_id: int | None = None
    damaged_inventory_id: int | None = None
    decision: str | None = None


@dataclass(frozen=True, slots=True)
class SupplierReturnResponseRecorded(DomainEvent):
    supplier_return_id: int | None = None
    supplier_return_item_id: int | None = None
    response_type: str | None = None
    quantity: Decimal | None = None
