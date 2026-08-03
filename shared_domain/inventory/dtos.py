"""Inventory domain DTOs."""

from dataclasses import dataclass
from decimal import Decimal

from shared_domain.inventory.constants import InventoryDisposition, InventoryMovementType


@dataclass(frozen=True, slots=True)
class InventoryMovement:
    movement_type: InventoryMovementType
    product_id: int
    quantity: Decimal
    business_profile_id: int | None = None
    outlet_id: int | None = None
    reason: str | None = None
    reference_type: str | None = None
    reference_id: str | None = None
    idempotency_key: str | None = None
    user_id: str | None = None
    source: str | None = None

    def __post_init__(self) -> None:
        if self.product_id <= 0:
            raise ValueError("product_id must be positive")
        if self.quantity == 0:
            raise ValueError("quantity cannot be zero")


@dataclass(frozen=True, slots=True)
class InventoryLedgerEntry:
    product_id: int
    movement_type: InventoryMovementType
    ledger_type: str
    quantity_delta: Decimal
    old_stock: Decimal
    new_stock: Decimal
    business_profile_id: int | None = None
    outlet_id: int | None = None
    reason: str | None = None
    reference_type: str | None = None
    reference_id: str | None = None
    idempotency_key: str | None = None
    user_id: str | None = None
    source: str | None = None


@dataclass(frozen=True, slots=True)
class InventoryMovementResult:
    movement: InventoryMovement
    disposition: InventoryDisposition
    old_stock: Decimal
    new_stock: Decimal
    stock_delta: Decimal
    ledger_entry: InventoryLedgerEntry
    statistic_deltas: dict[str, Decimal]
