"""Customer domain DTOs."""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal


@dataclass(frozen=True, slots=True)
class CustomerStatistics:
    customer_id: int
    total_spent: Decimal = Decimal("0")
    purchase_count: int = 0
    refund_total: Decimal = Decimal("0")
    last_purchase_at: date | None = None
