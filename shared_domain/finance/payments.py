"""Pure payment/refund service."""

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum


class PaymentMethod(StrEnum):
    CASH = "cash"
    UPI = "upi"
    CARD = "card"
    WALLET = "wallet"
    BANK = "bank"
    SPLIT = "split"


@dataclass(frozen=True, slots=True)
class PaymentRequest:
    amount: Decimal
    method: PaymentMethod | str
    reference_no: str | None = None


@dataclass(frozen=True, slots=True)
class PaymentResult:
    amount: Decimal
    method: str
    status: str
    direction: str
    reference_no: str | None = None


class PaymentService:
    def record_payment(self, request: PaymentRequest) -> PaymentResult:
        method = self._normalize_method(request.method)
        self._validate_amount(request.amount)
        return PaymentResult(
            amount=request.amount,
            method=method,
            status="paid",
            direction="in",
            reference_no=request.reference_no,
        )

    def record_refund(
        self,
        request: PaymentRequest,
        *,
        max_refundable: Decimal | None = None,
    ) -> PaymentResult:
        method = self._normalize_method(request.method)
        self._validate_amount(request.amount)
        if max_refundable is not None and request.amount > max_refundable:
            raise ValueError("Refund exceeds refundable amount")
        return PaymentResult(
            amount=request.amount,
            method=method,
            status="refunded",
            direction="out",
            reference_no=request.reference_no,
        )

    def _normalize_method(self, method: PaymentMethod | str) -> str:
        value = str(method.value if isinstance(method, PaymentMethod) else method).lower()
        allowed = {item.value for item in PaymentMethod}
        if value not in allowed:
            raise ValueError(f"Unsupported payment method: {method}")
        return value

    @staticmethod
    def _validate_amount(amount: Decimal) -> None:
        if amount <= 0:
            raise ValueError("Payment amount must be positive")
