"""Pure inventory business rules."""

from shared_domain.inventory.constants import (
    DAMAGED_RETURN_REASONS,
    EXPIRED_RETURN_REASONS,
    QUARANTINE_RETURN_REASONS,
    SELLABLE_RETURN_REASONS,
    InventoryDisposition,
)


def normalize_reason(value: str | None) -> str:
    return (value or "damaged").strip().lower().replace("-", "_")


def return_disposition(reason_value: str | None) -> InventoryDisposition:
    """Map a return reason to the stock bucket it should affect."""

    reason = normalize_reason(reason_value)
    expanded = reason.replace("_", " ")
    if reason in SELLABLE_RETURN_REASONS or expanded in SELLABLE_RETURN_REASONS:
        return InventoryDisposition.AVAILABLE
    if reason in EXPIRED_RETURN_REASONS or expanded in EXPIRED_RETURN_REASONS:
        return InventoryDisposition.EXPIRED
    if reason in QUARANTINE_RETURN_REASONS or expanded in QUARANTINE_RETURN_REASONS:
        return InventoryDisposition.QUARANTINE
    if reason in DAMAGED_RETURN_REASONS or expanded in DAMAGED_RETURN_REASONS:
        return InventoryDisposition.DAMAGED
    return InventoryDisposition.DAMAGED
