"""Pure reverse logistics engines.

The engines validate workflow, approval, inspection, and supplier response
rules. They do not import FastAPI, SQLAlchemy, or persistence concerns.
"""

from decimal import Decimal

from shared_domain.reverse_logistics.constants import (
    ApprovalDecision,
    DispositionDecision,
    InspectionOutcome,
    SupplierResponseType,
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


class WorkflowEngine:
    def assert_transition(
        self,
        transition: WorkflowTransition,
        statuses: dict[str, WorkflowStatus],
    ) -> None:
        current = statuses.get(transition.from_status)
        target = statuses.get(transition.to_status)
        if current is None:
            raise ValueError(f"Unknown workflow status: {transition.from_status}")
        if target is None:
            raise ValueError(f"Unknown workflow status: {transition.to_status}")
        if current.module != transition.module or target.module != transition.module:
            raise ValueError("Workflow transition module mismatch")
        if current.is_terminal:
            raise ValueError("Terminal workflow status cannot transition")
        if transition.to_status not in current.allowed_next:
            raise ValueError(
                f"Cannot move {transition.module.value} from "
                f"{transition.from_status} to {transition.to_status}"
            )


class ApprovalEngine:
    def next_level(
        self,
        levels: list[ApprovalLevel],
        actions: list[ApprovalAction],
    ) -> ApprovalLevel | None:
        ordered = sorted(levels, key=lambda item: item.level_order)
        for level in ordered:
            approvals = [
                action
                for action in actions
                if action.level_order == level.level_order
                and action.decision == ApprovalDecision.APPROVED
            ]
            rejections = [
                action
                for action in actions
                if action.level_order == level.level_order
                and action.decision == ApprovalDecision.REJECTED
            ]
            if rejections:
                return None
            if len(approvals) < level.required_approvals:
                return level
        return None

    def assert_action(
        self,
        action: ApprovalAction,
        levels: list[ApprovalLevel],
        previous_actions: list[ApprovalAction],
    ) -> None:
        expected = self.next_level(levels, previous_actions)
        if expected is None:
            raise ValueError("Approval workflow is already complete or rejected")
        if action.level_order != expected.level_order:
            raise ValueError("Approval action is not for the current level")
        if action.role_code != expected.role_code:
            raise ValueError("Approver role does not match required approval level")


class QualityInspectionEngine:
    DEFAULT_DECISION_BY_OUTCOME = {
        InspectionOutcome.GOOD_CONDITION: DispositionDecision.RETURN_TO_SHELF,
        InspectionOutcome.DAMAGED: DispositionDecision.RETURN_TO_SUPPLIER,
        InspectionOutcome.MANUFACTURING_DEFECT: DispositionDecision.RETURN_TO_SUPPLIER,
        InspectionOutcome.EXPIRED: DispositionDecision.RETURN_TO_SUPPLIER,
        InspectionOutcome.PACKAGING_DAMAGE: DispositionDecision.RETURN_TO_SUPPLIER,
        InspectionOutcome.BROKEN: DispositionDecision.SCRAP,
        InspectionOutcome.CUSTOMER_MISUSE: DispositionDecision.SCRAP,
        InspectionOutcome.REPAIRABLE: DispositionDecision.REPAIR,
        InspectionOutcome.NON_REPAIRABLE: DispositionDecision.SCRAP,
    }

    def recommended_decision(self, outcome: InspectionOutcome) -> DispositionDecision:
        return self.DEFAULT_DECISION_BY_OUTCOME[outcome]

    def validate_report(self, report: InspectionReport) -> None:
        expected = self.recommended_decision(report.outcome)
        if report.decision == DispositionDecision.RETURN_TO_SHELF and expected != report.decision:
            raise ValueError("Only good condition items can return directly to shelf")


class DecisionEngine:
    def decide(self, request: DecisionInput) -> DispositionDecision:
        default = QualityInspectionEngine().recommended_decision(request.outcome)
        decision = request.preferred_decision or default
        if request.outcome != InspectionOutcome.GOOD_CONDITION and decision == DispositionDecision.RETURN_TO_SHELF:
            raise ValueError("Only good condition items can return to shelf")
        return decision

    def assert_supplier_return_item(self, item: SupplierReturnItemDraft, available_quantity: Decimal) -> None:
        if item.quantity > Decimal(str(available_quantity)):
            raise ValueError("Supplier return quantity cannot exceed available damaged quantity")


class SupplierResponseEngine:
    def apply_response(
        self,
        state: ItemQuantityState,
        response: SupplierResponseLine,
    ) -> ItemQuantityState:
        if response.quantity <= 0:
            raise ValueError("Supplier response quantity must be positive")
        if response.response_type == SupplierResponseType.ACCEPT:
            accepted = state.accepted + response.quantity
            rejected = state.rejected
            replaced = state.replaced
            credited = state.credited
            refunded = state.refunded
        elif response.response_type == SupplierResponseType.REJECT:
            accepted = state.accepted
            rejected = state.rejected + response.quantity
            replaced = state.replaced
            credited = state.credited
            refunded = state.refunded
        elif response.response_type == SupplierResponseType.REPLACE:
            accepted = state.accepted + response.quantity
            rejected = state.rejected
            replaced = state.replaced + response.quantity
            credited = state.credited
            refunded = state.refunded
        elif response.response_type == SupplierResponseType.CREDIT_NOTE:
            accepted = state.accepted + response.quantity
            rejected = state.rejected
            replaced = state.replaced
            credited = state.credited + response.quantity
            refunded = state.refunded
        elif response.response_type == SupplierResponseType.REFUND:
            accepted = state.accepted + response.quantity
            rejected = state.rejected
            replaced = state.replaced
            credited = state.credited
            refunded = state.refunded + response.quantity
        elif response.response_type == SupplierResponseType.PARTIAL_REPLACE:
            accepted = state.accepted + response.quantity
            rejected = state.rejected
            replaced = state.replaced + response.quantity
            credited = state.credited
            refunded = state.refunded
        elif response.response_type == SupplierResponseType.PARTIAL_REJECT:
            accepted = state.accepted
            rejected = state.rejected + response.quantity
            replaced = state.replaced
            credited = state.credited
            refunded = state.refunded
        else:
            raise ValueError(f"Unsupported supplier response: {response.response_type}")
        return ItemQuantityState(
            requested=state.requested,
            shipped=state.shipped,
            accepted=accepted,
            rejected=rejected,
            replaced=replaced,
            credited=credited,
            refunded=refunded,
            metadata=dict(state.metadata),
        )
