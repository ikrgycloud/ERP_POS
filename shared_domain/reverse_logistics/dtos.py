"""Framework-neutral reverse logistics DTOs."""

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal

from shared_domain.reverse_logistics.constants import (
    ApprovalDecision,
    DispositionDecision,
    InspectionOutcome,
    ReverseLogisticsModule,
    SupplierResponseType,
)


def _positive_decimal(value: Decimal, field_name: str) -> Decimal:
    amount = Decimal(str(value))
    if amount <= 0:
        raise ValueError(f"{field_name} must be positive")
    return amount


def _non_negative_decimal(value: Decimal, field_name: str) -> Decimal:
    amount = Decimal(str(value))
    if amount < 0:
        raise ValueError(f"{field_name} cannot be negative")
    return amount


@dataclass(frozen=True, slots=True)
class WorkflowStatus:
    code: str
    label: str
    module: ReverseLogisticsModule
    sequence: int = 0
    is_initial: bool = False
    is_terminal: bool = False
    allowed_next: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.code.strip():
            raise ValueError("Workflow status code is required")
        if not self.label.strip():
            raise ValueError("Workflow status label is required")


@dataclass(frozen=True, slots=True)
class WorkflowTransition:
    module: ReverseLogisticsModule
    entity_id: int
    from_status: str
    to_status: str
    actor_id: int
    remarks: str | None = None

    def __post_init__(self) -> None:
        if self.entity_id <= 0:
            raise ValueError("entity_id must be positive")
        if self.actor_id <= 0:
            raise ValueError("actor_id must be positive")


@dataclass(frozen=True, slots=True)
class ApprovalLevel:
    level_order: int
    role_code: str
    required_approvals: int = 1
    module: ReverseLogisticsModule = ReverseLogisticsModule.SUPPLIER_RETURN

    def __post_init__(self) -> None:
        if self.level_order <= 0:
            raise ValueError("level_order must be positive")
        if self.required_approvals <= 0:
            raise ValueError("required_approvals must be positive")
        if not self.role_code.strip():
            raise ValueError("role_code is required")


@dataclass(frozen=True, slots=True)
class ApprovalAction:
    level_order: int
    approver_id: int
    role_code: str
    decision: ApprovalDecision
    remarks: str | None = None

    def __post_init__(self) -> None:
        if self.level_order <= 0:
            raise ValueError("level_order must be positive")
        if self.approver_id <= 0:
            raise ValueError("approver_id must be positive")


@dataclass(frozen=True, slots=True)
class InspectionReport:
    damaged_inventory_id: int
    product_id: int
    inspected_by: int
    inspected_quantity: Decimal
    outcome: InspectionOutcome
    decision: DispositionDecision
    inspected_at: datetime | None = None
    reason: str | None = None
    remarks: str | None = None
    photo_urls: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.damaged_inventory_id <= 0:
            raise ValueError("damaged_inventory_id must be positive")
        if self.product_id <= 0:
            raise ValueError("product_id must be positive")
        if self.inspected_by <= 0:
            raise ValueError("inspected_by must be positive")
        object.__setattr__(
            self,
            "inspected_quantity",
            _positive_decimal(self.inspected_quantity, "inspected_quantity"),
        )


@dataclass(frozen=True, slots=True)
class DecisionInput:
    outcome: InspectionOutcome
    available_quantity: Decimal
    requested_quantity: Decimal
    preferred_decision: DispositionDecision | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "available_quantity",
            _non_negative_decimal(self.available_quantity, "available_quantity"),
        )
        object.__setattr__(
            self,
            "requested_quantity",
            _positive_decimal(self.requested_quantity, "requested_quantity"),
        )
        if self.requested_quantity > self.available_quantity:
            raise ValueError("requested_quantity cannot exceed available_quantity")


@dataclass(frozen=True, slots=True)
class SupplierReturnItemDraft:
    damaged_inventory_id: int
    product_id: int
    quantity: Decimal
    reason: str | None = None
    inspection_report_id: int | None = None

    def __post_init__(self) -> None:
        if self.damaged_inventory_id <= 0:
            raise ValueError("damaged_inventory_id must be positive")
        if self.product_id <= 0:
            raise ValueError("product_id must be positive")
        object.__setattr__(self, "quantity", _positive_decimal(self.quantity, "quantity"))


@dataclass(frozen=True, slots=True)
class SupplierResponseLine:
    supplier_return_item_id: int
    response_type: SupplierResponseType
    quantity: Decimal
    amount: Decimal = Decimal("0")
    response_date: date | None = None
    reference_number: str | None = None
    remarks: str | None = None

    def __post_init__(self) -> None:
        if self.supplier_return_item_id <= 0:
            raise ValueError("supplier_return_item_id must be positive")
        object.__setattr__(self, "quantity", _positive_decimal(self.quantity, "quantity"))
        object.__setattr__(self, "amount", _non_negative_decimal(self.amount, "amount"))


@dataclass(frozen=True, slots=True)
class ItemQuantityState:
    requested: Decimal
    shipped: Decimal = Decimal("0")
    accepted: Decimal = Decimal("0")
    rejected: Decimal = Decimal("0")
    replaced: Decimal = Decimal("0")
    credited: Decimal = Decimal("0")
    refunded: Decimal = Decimal("0")
    metadata: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for name in ("requested", "shipped", "accepted", "rejected", "replaced", "credited", "refunded"):
            object.__setattr__(self, name, _non_negative_decimal(getattr(self, name), name))
        if self.requested == 0:
            raise ValueError("requested must be positive")
        if self.shipped > self.requested:
            raise ValueError("shipped cannot exceed requested")
        if self.accepted + self.rejected > self.shipped:
            raise ValueError("accepted + rejected cannot exceed shipped")
        if self.replaced + self.credited + self.refunded > self.accepted:
            raise ValueError("supplier outcomes cannot exceed accepted quantity")
