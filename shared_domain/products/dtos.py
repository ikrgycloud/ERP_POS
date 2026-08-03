"""Product domain DTOs."""

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True, slots=True)
class ProductStatistics:
    product_id: int
    available: Decimal = Decimal("0")
    reserved: Decimal = Decimal("0")
    sold: Decimal = Decimal("0")
    returned: Decimal = Decimal("0")
    damaged: Decimal = Decimal("0")
    expired: Decimal = Decimal("0")
    quarantine: Decimal = Decimal("0")
    transferred: Decimal = Decimal("0")
    lost: Decimal = Decimal("0")

    @property
    def current_stock(self) -> Decimal:
        return self.available
