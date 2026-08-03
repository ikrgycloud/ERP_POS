"""Shared document-numbering vocabulary."""

from enum import StrEnum


class DocumentFamily(StrEnum):
    ORDER = "order"
    INVOICE = "invoice"
    RETURN = "return"
    CREDIT_NOTE = "credit_note"
    RECEIPT = "receipt"
    PAYMENT = "payment"


DEFAULT_PREFIXES: dict[DocumentFamily, str] = {
    DocumentFamily.ORDER: "ORD",
    DocumentFamily.INVOICE: "INV",
    DocumentFamily.RETURN: "RET",
    DocumentFamily.CREDIT_NOTE: "CN",
    DocumentFamily.RECEIPT: "RCT",
    DocumentFamily.PAYMENT: "PAY",
}
