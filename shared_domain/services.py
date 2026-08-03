"""Backward-compatible service contract imports.

New code should import from shared_domain.core.contracts.
"""

from shared_domain.core.contracts import (
    AuditService,
    CustomerStatisticsService,
    DashboardAggregationService,
    DocumentNumberService,
    FinancialLedgerService,
    InventoryMovementService,
    InvoiceService,
    PaymentService,
    ProductStatisticsService,
    ReportService,
    ReturnService,
)

__all__ = [
    "AuditService",
    "CustomerStatisticsService",
    "DashboardAggregationService",
    "DocumentNumberService",
    "FinancialLedgerService",
    "InventoryMovementService",
    "InvoiceService",
    "PaymentService",
    "ProductStatisticsService",
    "ReportService",
    "ReturnService",
]
