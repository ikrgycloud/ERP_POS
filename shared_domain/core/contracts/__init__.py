"""Service contracts owned by the shared domain layer."""

from shared_domain.core.contracts.services import (
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
