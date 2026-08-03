"""Reverse logistics domain foundation."""

from shared_domain.reverse_logistics.constants import (
    ApprovalDecision,
    DispositionDecision,
    InspectionOutcome,
    ReverseLogisticsModule,
    SupplierResponseType,
    TERMINAL_STATUSES,
    WorkflowStatusCode,
)
from shared_domain.reverse_logistics.dtos import (
    ApprovalAction,
    ApprovalLevel,
    DecisionInput,
    InspectionReport,
    ItemQuantityState,
    SupplierResponseLine,
    SupplierReturnItemDraft,
    WorkflowStatus,
    WorkflowTransition,
)
from shared_domain.reverse_logistics.service import (
    ApprovalEngine,
    DecisionEngine,
    QualityInspectionEngine,
    SupplierResponseEngine,
    WorkflowEngine,
)

__all__ = [
    "ApprovalAction",
    "ApprovalDecision",
    "ApprovalEngine",
    "ApprovalLevel",
    "DecisionEngine",
    "DecisionInput",
    "DispositionDecision",
    "InspectionOutcome",
    "InspectionReport",
    "ItemQuantityState",
    "QualityInspectionEngine",
    "ReverseLogisticsModule",
    "SupplierResponseEngine",
    "SupplierResponseLine",
    "SupplierResponseType",
    "SupplierReturnItemDraft",
    "TERMINAL_STATUSES",
    "WorkflowEngine",
    "WorkflowStatus",
    "WorkflowStatusCode",
    "WorkflowTransition",
]
