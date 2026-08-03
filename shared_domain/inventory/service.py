"""Pure inventory movement service.

This service validates and calculates stock effects but never touches a
database. ERP/POS adapters persist the returned ledger/result DTOs.
"""

from decimal import Decimal

from shared_domain.inventory.constants import (
    LEDGER_TYPE_BY_MOVEMENT,
    InventoryDisposition,
    InventoryMovementType,
)
from shared_domain.inventory.dtos import (
    InventoryLedgerEntry,
    InventoryMovement,
    InventoryMovementResult,
)
from shared_domain.inventory.rules import normalize_reason, return_disposition


class InventoryMovementService:
    def apply(
        self,
        movement: InventoryMovement,
        *,
        current_stock: Decimal,
    ) -> InventoryMovementResult:
        old_stock = Decimal(str(current_stock or 0))
        stock_delta, disposition, stat_deltas = self._calculate_effect(movement)
        new_stock = old_stock + stock_delta
        if new_stock < 0:
            raise ValueError("Insufficient stock for this movement")

        ledger_entry = InventoryLedgerEntry(
            product_id=movement.product_id,
            movement_type=movement.movement_type,
            ledger_type=LEDGER_TYPE_BY_MOVEMENT[movement.movement_type],
            quantity_delta=stock_delta,
            old_stock=old_stock,
            new_stock=new_stock,
            business_profile_id=movement.business_profile_id,
            outlet_id=movement.outlet_id,
            reason=normalize_reason(movement.reason),
            reference_type=movement.reference_type,
            reference_id=movement.reference_id,
            idempotency_key=movement.idempotency_key,
            user_id=movement.user_id,
            source=movement.source,
        )
        return InventoryMovementResult(
            movement=movement,
            disposition=disposition,
            old_stock=old_stock,
            new_stock=new_stock,
            stock_delta=stock_delta,
            ledger_entry=ledger_entry,
            statistic_deltas=stat_deltas,
        )

    def _calculate_effect(
        self,
        movement: InventoryMovement,
    ) -> tuple[Decimal, InventoryDisposition, dict[str, Decimal]]:
        qty = movement.quantity
        movement_type = movement.movement_type
        if movement_type != InventoryMovementType.ADJUSTMENT and qty <= 0:
            raise ValueError("Movement quantity must be positive")
        if movement_type == InventoryMovementType.SALE:
            return -qty, InventoryDisposition.SOLD, {"qty_sold": qty}
        if movement_type == InventoryMovementType.PURCHASE:
            return qty, InventoryDisposition.AVAILABLE, {"qty_bought": qty}
        if movement_type == InventoryMovementType.RETURN:
            disposition = return_disposition(movement.reason)
            stat_deltas = {"qty_returned": qty}
            if disposition == InventoryDisposition.AVAILABLE:
                return qty, disposition, stat_deltas
            if disposition == InventoryDisposition.EXPIRED:
                stat_deltas["expired_qty"] = qty
                return Decimal("0"), disposition, stat_deltas
            if disposition == InventoryDisposition.QUARANTINE:
                stat_deltas["quarantine_qty"] = qty
                return Decimal("0"), disposition, stat_deltas
            stat_deltas["damaged_qty"] = qty
            stat_deltas["returned_damaged_qty"] = qty
            return Decimal("0"), InventoryDisposition.DAMAGED, stat_deltas
        if movement_type == InventoryMovementType.DAMAGE:
            return -qty, InventoryDisposition.DAMAGED, {"damaged_qty": qty}
        if movement_type == InventoryMovementType.EXPIRY:
            return -qty, InventoryDisposition.EXPIRED, {"expired_qty": qty}
        if movement_type == InventoryMovementType.QUARANTINE:
            return -qty, InventoryDisposition.QUARANTINE, {"quarantine_qty": qty}
        if movement_type == InventoryMovementType.LOST:
            return -qty, InventoryDisposition.LOST, {"lost_qty": qty}
        if movement_type == InventoryMovementType.RESERVATION:
            return -qty, InventoryDisposition.RESERVED, {"reserved_qty": qty}
        if movement_type == InventoryMovementType.RELEASE_RESERVATION:
            return qty, InventoryDisposition.AVAILABLE, {"reserved_qty": -qty}
        if movement_type == InventoryMovementType.TRANSFER:
            return -qty, InventoryDisposition.TRANSFERRED, {"transferred_qty": qty}
        if movement_type == InventoryMovementType.SUPPLIER_RETURN:
            return Decimal("0"), InventoryDisposition.SUPPLIER_RETURNED, {}
        if movement_type == InventoryMovementType.SUPPLIER_REPLACEMENT:
            return qty, InventoryDisposition.SUPPLIER_REPLACED, {"qty_bought": qty}
        if movement_type == InventoryMovementType.SUPPLIER_REJECT:
            return Decimal("0"), InventoryDisposition.SUPPLIER_REJECTED, {}
        if movement_type == InventoryMovementType.SUPPLIER_CREDIT:
            return Decimal("0"), InventoryDisposition.SUPPLIER_CREDITED, {}
        if movement_type == InventoryMovementType.SCRAP:
            return Decimal("0"), InventoryDisposition.SCRAPPED, {}
        if movement_type == InventoryMovementType.REPAIR:
            return Decimal("0"), InventoryDisposition.REPAIR_PENDING, {}
        if movement_type == InventoryMovementType.ADJUSTMENT:
            # Positive/negative adjustments are represented by the caller's
            # signed quantity in legacy adapters; new callers should prefer
            # PURCHASE/DAMAGE/LOST when semantics are known.
            return qty, InventoryDisposition.AVAILABLE, {}
        if movement_type == InventoryMovementType.STOCK_COUNT:
            return Decimal("0"), InventoryDisposition.AVAILABLE, {}
        raise ValueError(f"Unsupported inventory movement: {movement_type}")
