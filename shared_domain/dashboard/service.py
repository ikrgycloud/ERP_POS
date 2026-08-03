"""Pure dashboard aggregation service."""

from decimal import Decimal

from shared_domain.dashboard.dtos import DashboardSummary
from shared_domain.finance.dtos import FinancialLedgerSummary
from shared_domain.finance.money import money


class DashboardAggregationService:
    def summarize(
        self,
        financials: FinancialLedgerSummary,
        *,
        returns_count: int = 0,
        today_sales: Decimal = Decimal("0"),
        monthly_sales: Decimal = Decimal("0"),
        low_stock_count: int = 0,
        damaged_stock: Decimal = Decimal("0"),
        expired_stock: Decimal = Decimal("0"),
        quarantine_stock: Decimal = Decimal("0"),
    ) -> DashboardSummary:
        return DashboardSummary(
            gross_revenue=money(financials.gross_revenue),
            net_revenue=money(financials.net_revenue),
            refunds=money(financials.refunds),
            returns_count=returns_count,
            inventory_value=money(financials.inventory_value),
            today_sales=money(today_sales),
            monthly_sales=money(monthly_sales),
            low_stock_count=low_stock_count,
            damaged_stock=money(damaged_stock),
            expired_stock=money(expired_stock),
            quarantine_stock=money(quarantine_stock),
        )
