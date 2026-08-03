"""Finance domain DTOs."""

from dataclasses import dataclass
from decimal import Decimal

from shared_domain.finance.constants import FinancialLedgerType


@dataclass(frozen=True, slots=True)
class FinancialEntry:
    entry_type: FinancialLedgerType
    amount: Decimal
    business_profile_id: int | None = None
    outlet_id: int | None = None
    reference_type: str | None = None
    reference_id: str | None = None
    currency: str = "INR"

    def __post_init__(self) -> None:
        if self.amount < 0:
            raise ValueError("Financial entry amount cannot be negative")


@dataclass(frozen=True, slots=True)
class InvoiceFinancialSnapshot:
    taxable_value: Decimal
    cgst: Decimal = Decimal("0")
    sgst: Decimal = Decimal("0")
    igst: Decimal = Decimal("0")
    discount: Decimal = Decimal("0")
    cogs: Decimal = Decimal("0")
    is_reverse: bool = False


@dataclass(frozen=True, slots=True)
class FinancialLedgerSummary:
    gross_revenue: Decimal = Decimal("0")
    refunds: Decimal = Decimal("0")
    discounts: Decimal = Decimal("0")
    gst: Decimal = Decimal("0")
    cogs: Decimal = Decimal("0")
    inventory_value: Decimal = Decimal("0")
    expenses: Decimal = Decimal("0")

    @property
    def net_revenue(self) -> Decimal:
        return max(Decimal("0"), self.gross_revenue - self.refunds - self.discounts)

    @property
    def profit(self) -> Decimal:
        return self.net_revenue - self.cogs - self.expenses

    @property
    def margin(self) -> Decimal:
        if self.net_revenue == 0:
            return Decimal("0")
        return (self.profit / self.net_revenue) * Decimal("100")
