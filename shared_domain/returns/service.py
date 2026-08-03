"""Pure return workflow rules."""

from decimal import Decimal

from shared_domain.finance.money import money
from shared_domain.inventory.constants import InventoryDisposition
from shared_domain.inventory.rules import normalize_reason, return_disposition


class ReturnService:
    VALID_TRANSITIONS = {
        "submitted": {"verified", "rejected"},
        "verified": {"approved", "rejected"},
        "approved": {"reversal_generated", "completed", "rejected"},
        "reversal_generated": {"completed"},
        "completed": set(),
        "rejected": set(),
    }

    def assert_transition(self, current_status: str, new_status: str) -> None:
        allowed = self.VALID_TRANSITIONS.get(current_status, set())
        if new_status not in allowed:
            raise ValueError(f"Cannot move return from '{current_status}' to '{new_status}'")

    def inventory_disposition(self, reason: str | None) -> InventoryDisposition:
        return return_disposition(reason)

    def normalize_reason(self, reason: str | None) -> str:
        return normalize_reason(reason)

    def line_refund(
        self,
        *,
        unit_price: Decimal,
        return_quantity: Decimal,
        sold_quantity: Decimal,
        invoice_line_discount: Decimal = Decimal("0"),
    ) -> tuple[Decimal, Decimal]:
        if return_quantity <= 0:
            raise ValueError("Return quantity must be positive")
        if sold_quantity <= 0:
            raise ValueError("Sold quantity must be positive")
        if return_quantity > sold_quantity:
            raise ValueError("Return quantity cannot exceed sold quantity")
        per_unit_discount = Decimal(str(invoice_line_discount or 0)) / sold_quantity
        gross = Decimal(str(unit_price)) * return_quantity
        discount = money(per_unit_discount * return_quantity)
        return discount, money(gross - discount)
