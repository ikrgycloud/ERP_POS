"""Pure business settings service."""

from dataclasses import asdict
from typing import Any, Mapping

from shared_domain.documents import DocumentFamily, document_prefix
from shared_domain.settings.dtos import BusinessSettings


DEFAULT_INVOICE_TERMS: tuple[str, ...] = (
    "Goods once sold are governed by the seller's published return policy.",
    "Shortage, breakdown, leakage, or damage after delivery must be reported immediately.",
    "Returns and reverse invoices require approval from the issuing business.",
    "This is a computer generated tax invoice.",
)


class BusinessSettingsService:
    def merge(self, base: BusinessSettings | None = None, **overrides) -> BusinessSettings:
        data = {
            **asdict(base or BusinessSettings()),
            **{key: value for key, value in overrides.items() if value is not None},
        }
        return BusinessSettings(**data)

    def from_mapping(self, source: Mapping[str, Any] | object | None) -> BusinessSettings:
        if source is None:
            return BusinessSettings()

        def read(*names: str) -> Any:
            for name in names:
                if isinstance(source, Mapping):
                    value = source.get(name)
                else:
                    value = getattr(source, name, None)
                if value not in (None, ""):
                    return value
            return None

        address_parts = [
            read("billing_address", "address"),
            read("city"),
            read("state"),
            read("pincode"),
        ]
        address = ", ".join(str(part).strip() for part in address_parts if part)
        return self.merge(
            BusinessSettings(),
            company_name=read("legal_name", "company_name"),
            business_name=read("trade_name", "business_name", "name"),
            logo_url=read("logo_url"),
            gst_number=read("gstin", "gst_number"),
            pan_number=read("pan", "pan_number"),
            phone=read("mobile", "phone"),
            email=read("email"),
            address=address,
            currency=read("currency"),
        )

    def document_prefix(self, settings: BusinessSettings, family: DocumentFamily) -> str:
        overrides = {
            DocumentFamily.INVOICE: settings.invoice_prefix,
            DocumentFamily.RETURN: settings.return_prefix,
            DocumentFamily.ORDER: settings.order_prefix,
            DocumentFamily.CREDIT_NOTE: settings.credit_note_prefix,
            DocumentFamily.RECEIPT: settings.receipt_prefix,
        }
        return document_prefix(family, overrides)

    def invoice_terms(self, settings: BusinessSettings) -> tuple[str, ...]:
        configured_terms = [
            line.strip()
            for line in (settings.terms_conditions or "").splitlines()
            if line.strip()
        ]
        if configured_terms:
            return tuple(configured_terms)
        if settings.refund_policy:
            return (settings.refund_policy.strip(), *DEFAULT_INVOICE_TERMS[1:])
        return DEFAULT_INVOICE_TERMS
