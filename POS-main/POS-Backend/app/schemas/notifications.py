"""Schemas for invoice links and notification history."""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class NotificationStatus(BaseModel):
    sms: str = "skipped"
    whatsapp: str = "skipped"


class InvoiceNotificationOut(BaseModel):
    id: int
    invoice_id: int
    customer_id: Optional[int] = None
    channel: str
    phone: Optional[str] = None
    status: str
    twilio_sid: Optional[str] = None
    error_message: Optional[str] = None
    attempts: int = 0
    sent_at: Optional[datetime] = None
    failed_at: Optional[datetime] = None
    created_at: datetime


class NotificationResendRequest(BaseModel):
    channel: str


class NotificationAnalytics(BaseModel):
    email_sent: int = 0
    email_failed: int = 0
    sms_sent: int = 0
    sms_failed: int = 0
    whatsapp_sent: int = 0
    whatsapp_failed: int = 0
    queued_messages: int = 0
    retry_queue: int = 0
    delivery_rate: Decimal = Decimal("0")
    failure_rate: Decimal = Decimal("0")


class NotificationHealth(BaseModel):
    worker_running: bool
    email_enabled: bool = False
    sms_enabled: bool
    whatsapp_enabled: bool
    twilio_configured: bool
    twilio_sms_configured: bool = False
    twilio_whatsapp_configured: bool = False
    smtp_configured: bool = False
    pending_outbox: int = 0
    failed_outbox: int = 0
    last_processed_at: Optional[datetime] = None
    configuration_errors: list[str] = Field(default_factory=list)


class NotificationTestRequest(BaseModel):
    phone: str
    channel: str = "sms"
    message: str = "POS notification test"


class NotificationTestResponse(BaseModel):
    ok: bool
    channel: str
    phone: str
    sid: Optional[str] = None
    error: Optional[str] = None
    http_status: Optional[int] = None
    twilio_code: Optional[str | int] = None
    response_body: Optional[str] = None
    elapsed_ms: Decimal


class PublicInvoiceItem(BaseModel):
    product_name: str
    barcode: Optional[str] = None
    sku: Optional[str] = None
    category: Optional[str] = None
    quantity: Decimal
    unit_price: Decimal
    discount_pct: Decimal
    discount_amount: Decimal
    tax_rate: Decimal
    tax_amount: Decimal
    total: Decimal


class PublicInvoiceBusiness(BaseModel):
    name: str
    gstin: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None


class PublicInvoiceOut(BaseModel):
    business: PublicInvoiceBusiness
    invoice_number: str
    invoice_date: date
    customer_name: str
    items: list[PublicInvoiceItem]
    taxable_value: Decimal
    cgst: Decimal
    sgst: Decimal
    igst: Decimal
    grand_total: Decimal
    payment_method: Optional[str] = None
    paid_status: str
    barcode_value: str
    qr_value: str
    expires_at: Optional[datetime] = None
    return_policy: str
    footer: str
