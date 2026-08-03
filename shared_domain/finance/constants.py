"""Finance constants and enums."""

from enum import StrEnum


class PaymentStatus(StrEnum):
    UNPAID = "unpaid"
    PARTIAL = "partial"
    PAID = "paid"
    REFUNDED = "refunded"
    FAILED = "failed"


class RefundStatus(StrEnum):
    PENDING = "pending"
    INITIATED = "initiated"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class FinancialLedgerType(StrEnum):
    SALE = "sale"
    RETURN = "return"
    REFUND = "refund"
    CREDIT_NOTE = "credit_note"
    DEBIT_NOTE = "debit_note"
    DISCOUNT = "discount"
    GST = "gst"
    COGS = "cogs"
    EXPENSE = "expense"
    INVENTORY_VALUE = "inventory_value"
    PROFIT = "profit"
    MARGIN = "margin"
    ADJUSTMENT = "adjustment"
