"""Pure report summary service."""

from decimal import Decimal

from shared_domain.finance.dtos import FinancialLedgerSummary
from shared_domain.finance.money import money
from shared_domain.reports.dtos import ReportSummary


class ReportService:
    def revenue(self, financials: FinancialLedgerSummary) -> ReportSummary:
        return ReportSummary("revenue", total=money(financials.net_revenue))

    def refunds(self, financials: FinancialLedgerSummary, *, count: int = 0) -> ReportSummary:
        return ReportSummary("refunds", total=money(financials.refunds), count=count)

    def inventory(self, *, inventory_value: Decimal, count: int = 0) -> ReportSummary:
        return ReportSummary("inventory", total=money(inventory_value), count=count)

    def generic(self, name: str, *, total: Decimal = Decimal("0"), count: int = 0) -> ReportSummary:
        return ReportSummary(name=name, total=money(total), count=count)
