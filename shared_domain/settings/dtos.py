"""Business settings DTOs."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class BusinessSettings:
    company_name: str = ""
    business_name: str = ""
    logo_url: str | None = None
    company_seal_url: str | None = None
    invoice_watermark: str | None = None
    invoice_footer: str = ""
    terms_conditions: str = ""
    refund_policy: str = ""
    gst_number: str = ""
    pan_number: str = ""
    phone: str = ""
    email: str = ""
    website: str = ""
    address: str = ""
    currency: str = "INR"
    timezone: str = "Asia/Kolkata"
    theme_color: str = "#111827"
    invoice_prefix: str = "INV"
    return_prefix: str = "RET"
    order_prefix: str = "ORD"
    credit_note_prefix: str = "CN"
    receipt_prefix: str = "RCT"
    qr_enabled: bool = True
    authorized_signature_url: str | None = None
    store_opening_hours: str = ""
    tax_configuration: dict | None = None
