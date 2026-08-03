"""Inventory constants and enums."""

from enum import StrEnum


class InventoryMovementType(StrEnum):
    SALE = "sale"
    PURCHASE = "purchase"
    RETURN = "return"
    DAMAGE = "damage"
    EXPIRY = "expiry"
    TRANSFER = "transfer"
    ADJUSTMENT = "adjustment"
    RESERVATION = "reservation"
    RELEASE_RESERVATION = "release_reservation"
    LOST = "lost"
    STOCK_COUNT = "stock_count"
    QUARANTINE = "quarantine"
    SUPPLIER_RETURN = "supplier_return"
    SUPPLIER_REPLACEMENT = "supplier_replacement"
    SUPPLIER_REJECT = "supplier_reject"
    SUPPLIER_CREDIT = "supplier_credit"
    SCRAP = "scrap"
    REPAIR = "repair"


LEDGER_TYPE_BY_MOVEMENT: dict[InventoryMovementType, str] = {
    InventoryMovementType.SALE: "SALE",
    InventoryMovementType.PURCHASE: "PURCHASE",
    InventoryMovementType.RETURN: "RETURN",
    InventoryMovementType.DAMAGE: "DAMAGE",
    InventoryMovementType.EXPIRY: "EXPIRED",
    InventoryMovementType.TRANSFER: "TRANSFER",
    InventoryMovementType.ADJUSTMENT: "ADJUSTMENT",
    InventoryMovementType.RESERVATION: "RESERVATION",
    InventoryMovementType.RELEASE_RESERVATION: "RESERVATION",
    InventoryMovementType.LOST: "LOST",
    InventoryMovementType.STOCK_COUNT: "STOCK_COUNT",
    InventoryMovementType.QUARANTINE: "QUARANTINE",
    InventoryMovementType.SUPPLIER_RETURN: "SUPPLIER_RETURN",
    InventoryMovementType.SUPPLIER_REPLACEMENT: "SUPPLIER_REPLACEMENT",
    InventoryMovementType.SUPPLIER_REJECT: "SUPPLIER_REJECT",
    InventoryMovementType.SUPPLIER_CREDIT: "SUPPLIER_CREDIT",
    InventoryMovementType.SCRAP: "SCRAP",
    InventoryMovementType.REPAIR: "REPAIR",
}


class InventoryDisposition(StrEnum):
    AVAILABLE = "available"
    RESERVED = "reserved"
    SOLD = "sold"
    RETURNED = "returned"
    DAMAGED = "damaged"
    EXPIRED = "expired"
    QUARANTINE = "quarantine"
    TRANSFERRED = "transferred"
    LOST = "lost"
    SUPPLIER_RETURNED = "supplier_returned"
    SUPPLIER_REPLACED = "supplier_replaced"
    SUPPLIER_REJECTED = "supplier_rejected"
    SUPPLIER_CREDITED = "supplier_credited"
    SCRAPPED = "scrapped"
    REPAIR_PENDING = "repair_pending"


SELLABLE_RETURN_REASONS = frozenset(
    {
        "wrong_product",
        "wrong product",
        "customer_changed_mind",
        "customer changed mind",
        "billing_error",
        "billing error",
    }
)
DAMAGED_RETURN_REASONS = frozenset({"damaged", "damage"})
EXPIRED_RETURN_REASONS = frozenset({"expired", "expiry"})
QUARANTINE_RETURN_REASONS = frozenset(
    {
        "manufacturing_defect",
        "manufacturing defect",
        "quality_issue",
        "quality issue",
    }
)
