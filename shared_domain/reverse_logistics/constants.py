"""Reverse logistics domain constants."""

from enum import StrEnum


class ReverseLogisticsModule(StrEnum):
    DAMAGED_INVENTORY = "damaged_inventory"
    SUPPLIER_RETURN = "supplier_return"
    SUPPLIER_RETURN_ITEM = "supplier_return_item"


class WorkflowStatusCode(StrEnum):
    DRAFT = "draft"
    PENDING_INSPECTION = "pending_inspection"
    INSPECTION_COMPLETED = "inspection_completed"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    READY_FOR_SHIPMENT = "ready_for_shipment"
    SHIPPED = "shipped"
    SUPPLIER_RECEIVED = "supplier_received"
    SUPPLIER_INSPECTION = "supplier_inspection"
    REPLACEMENT_PENDING = "replacement_pending"
    REPLACEMENT_RECEIVED = "replacement_received"
    CREDIT_PENDING = "credit_pending"
    CREDIT_ISSUED = "credit_issued"
    REFUND_ISSUED = "refund_issued"
    SCRAPPED = "scrapped"
    REPAIRED = "repaired"
    RETURNED_TO_SHELF = "returned_to_shelf"
    CANCELLED = "cancelled"
    CLOSED = "closed"


class ApprovalDecision(StrEnum):
    APPROVED = "approved"
    REJECTED = "rejected"
    RETURNED_FOR_CHANGES = "returned_for_changes"


class InspectionOutcome(StrEnum):
    GOOD_CONDITION = "good_condition"
    DAMAGED = "damaged"
    MANUFACTURING_DEFECT = "manufacturing_defect"
    EXPIRED = "expired"
    PACKAGING_DAMAGE = "packaging_damage"
    BROKEN = "broken"
    CUSTOMER_MISUSE = "customer_misuse"
    REPAIRABLE = "repairable"
    NON_REPAIRABLE = "non_repairable"


class DispositionDecision(StrEnum):
    RETURN_TO_SHELF = "return_to_shelf"
    REPAIR = "repair"
    SCRAP = "scrap"
    RETURN_TO_SUPPLIER = "return_to_supplier"


class SupplierResponseType(StrEnum):
    ACCEPT = "accept"
    REJECT = "reject"
    REPLACE = "replace"
    REFUND = "refund"
    CREDIT_NOTE = "credit_note"
    PARTIAL_REPLACE = "partial_replace"
    PARTIAL_REJECT = "partial_reject"


TERMINAL_STATUSES = frozenset(
    {
        WorkflowStatusCode.REJECTED,
        WorkflowStatusCode.CANCELLED,
        WorkflowStatusCode.CLOSED,
        WorkflowStatusCode.RETURNED_TO_SHELF,
        WorkflowStatusCode.SCRAPPED,
        WorkflowStatusCode.REPAIRED,
    }
)
