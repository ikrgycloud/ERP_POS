from decimal import Decimal

from shared_domain.dashboard import DashboardAggregationService
from shared_domain.finance import FinancialLedgerService, InvoiceFinancialSnapshot
from shared_domain.reports import ReportService


def test_financial_ledger_summarizes_gross_refunds_net_profit_and_margin():
    summary = FinancialLedgerService().summarize_invoices(
        [
            InvoiceFinancialSnapshot(
                taxable_value=Decimal("100"),
                cgst=Decimal("2.50"),
                sgst=Decimal("2.50"),
                cogs=Decimal("60"),
            ),
            InvoiceFinancialSnapshot(
                taxable_value=Decimal("20"),
                cgst=Decimal("0.50"),
                sgst=Decimal("0.50"),
                is_reverse=True,
            ),
        ],
        inventory_value=Decimal("500"),
    )
    assert summary.gross_revenue == Decimal("105.00")
    assert summary.refunds == Decimal("21.00")
    assert summary.net_revenue == Decimal("84.00")
    assert summary.profit == Decimal("24.00")
    assert summary.inventory_value == Decimal("500.00")


def test_dashboard_service_uses_financial_summary():
    financials = FinancialLedgerService().summarize_invoices(
        [InvoiceFinancialSnapshot(taxable_value=Decimal("100"), cogs=Decimal("40"))]
    )
    dashboard = DashboardAggregationService().summarize(
        financials,
        returns_count=2,
        low_stock_count=3,
        damaged_stock=Decimal("1"),
    )
    assert dashboard.gross_revenue == Decimal("100.00")
    assert dashboard.net_revenue == Decimal("100.00")
    assert dashboard.returns_count == 2
    assert dashboard.low_stock_count == 3
    assert dashboard.damaged_stock == Decimal("1.00")


def test_report_service_creates_future_ready_export_summaries():
    financials = FinancialLedgerService().summarize_invoices(
        [
            InvoiceFinancialSnapshot(taxable_value=Decimal("100")),
            InvoiceFinancialSnapshot(taxable_value=Decimal("10"), is_reverse=True),
        ]
    )
    revenue = ReportService().revenue(financials)
    refunds = ReportService().refunds(financials, count=1)
    assert revenue.name == "revenue"
    assert revenue.total == Decimal("90.00")
    assert revenue.export_formats == ("csv", "excel", "pdf")
    assert refunds.total == Decimal("10.00")
    assert refunds.count == 1
