"""Domain event contracts."""

from shared_domain.events.base import DomainEvent
from shared_domain.events.events import (
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
    SupplierReturnApproved,
    SupplierReturnCreated,
    SupplierReturnInspectionRecorded,
    SupplierReturnResponseRecorded,
    SupplierReturnStatusChanged,
)

__all__ = [
    "CustomerUpdated",
    "DashboardInvalidated",
    "DomainEvent",
    "InventoryChanged",
    "InvoiceCreated",
    "PaymentRecorded",
    "ProductUpdated",
    "RefundCompleted",
    "ReportInvalidated",
    "ReturnApproved",
    "SaleCompleted",
    "SupplierReturnApproved",
    "SupplierReturnCreated",
    "SupplierReturnInspectionRecorded",
    "SupplierReturnResponseRecorded",
    "SupplierReturnStatusChanged",
]
