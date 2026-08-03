"""Dashboard domain DTOs."""

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True, slots=True)
class DashboardSummary:
    gross_revenue: Decimal = Decimal("0")
    net_revenue: Decimal = Decimal("0")
    refunds: Decimal = Decimal("0")
    returns_count: int = 0
    inventory_value: Decimal = Decimal("0")
    today_sales: Decimal = Decimal("0")
    monthly_sales: Decimal = Decimal("0")
    low_stock_count: int = 0
    damaged_stock: Decimal = Decimal("0")
    expired_stock: Decimal = Decimal("0")
    quarantine_stock: Decimal = Decimal("0")
