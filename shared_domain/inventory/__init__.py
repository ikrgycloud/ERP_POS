"""Inventory domain."""

from shared_domain.inventory.constants import (
    DAMAGED_RETURN_REASONS,
    EXPIRED_RETURN_REASONS,
    LEDGER_TYPE_BY_MOVEMENT,
    QUARANTINE_RETURN_REASONS,
    SELLABLE_RETURN_REASONS,
    InventoryDisposition,
    InventoryMovementType,
)
from shared_domain.inventory.dtos import (
    InventoryLedgerEntry,
    InventoryMovement,
    InventoryMovementResult,
)
from shared_domain.inventory.rules import normalize_reason, return_disposition
from shared_domain.inventory.service import InventoryMovementService

InventoryMovementRequest = InventoryMovement

__all__ = [
    "DAMAGED_RETURN_REASONS",
    "EXPIRED_RETURN_REASONS",
    "InventoryDisposition",
    "InventoryLedgerEntry",
    "InventoryMovement",
    "InventoryMovementRequest",
    "InventoryMovementResult",
    "InventoryMovementService",
    "InventoryMovementType",
    "LEDGER_TYPE_BY_MOVEMENT",
    "QUARANTINE_RETURN_REASONS",
    "SELLABLE_RETURN_REASONS",
    "normalize_reason",
    "return_disposition",
]
