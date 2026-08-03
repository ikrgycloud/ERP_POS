"""Framework-neutral service contracts for ERP/POS business rules."""

from decimal import Decimal
from typing import Protocol

from shared_domain.customers.dtos import CustomerStatistics
from shared_domain.dashboard.dtos import DashboardSummary
from shared_domain.documents.constants import DocumentFamily
from shared_domain.finance.dtos import FinancialEntry
from shared_domain.inventory.dtos import InventoryMovement
from shared_domain.products.dtos import ProductStatistics
from shared_domain.reports.dtos import ReportSummary
from shared_domain.returns.dtos import ReturnApproval


class InventoryMovementService(Protocol):
    """Every stock mutation in ERP/POS must eventually pass through this."""

    def apply(self, movement: InventoryMovement):
        ...


class InvoiceService(Protocol):
    def create_invoice(self, payload):
        ...

    def link_document(self, *, invoice_id: int, linked_document_id: int):
        ...


class ReturnService(Protocol):
    def submit(self, payload):
        ...

    def approve(self, approval: ReturnApproval):
        ...


class PaymentService(Protocol):
    def record_payment(self, payload):
        ...

    def record_refund(self, payload):
        ...


class FinancialLedgerService(Protocol):
    def record(self, entry: FinancialEntry):
        ...

    def record_sale(self, *, invoice_id: int, amount: Decimal):
        ...

    def record_refund(self, *, return_id: int, amount: Decimal):
        ...


class DashboardAggregationService(Protocol):
    def dashboard(self, *, business_profile_id: int, outlet_id: int | None = None) -> DashboardSummary:
        ...


class ReportService(Protocol):
    def revenue(self, *, business_profile_id: int, start_date, end_date) -> ReportSummary:
        ...

    def inventory(self, *, business_profile_id: int) -> ReportSummary:
        ...


class AuditService(Protocol):
    def log(self, *, action: str, entity_type: str, entity_id: str, details: dict):
        ...


class ProductStatisticsService(Protocol):
    def calculate(self, *, product_id: int) -> ProductStatistics:
        ...


class CustomerStatisticsService(Protocol):
    def calculate(self, *, customer_id: int) -> CustomerStatistics:
        ...


class DocumentNumberService(Protocol):
    def next_number(self, family: DocumentFamily) -> str:
        ...
