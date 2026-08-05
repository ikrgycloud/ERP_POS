"""Invoice notification queueing, composition, and processing."""
import logging
import re
import smtplib
import ssl
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from email.message import EmailMessage
from html import escape
from io import BytesIO

from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.exceptions import BusinessRuleError, NotFoundError
from app.models.org import BusinessProfile, Outlet
from app.models.sales import (
    Customer,
    Invoice,
    InvoiceNotification,
    NotificationHistory,
    NotificationOutbox,
    Payment,
)
from app.services.invoice_links import InvoiceLinkService
from app.services.twilio_provider import SendResult, TwilioSmsProvider, TwilioWhatsAppProvider

logger = logging.getLogger("pos_api.notifications")


CHANNEL_EMAIL = "email"
CHANNEL_SMS = "sms"
CHANNEL_WHATSAPP = "whatsapp"
EVENT_INVOICE_NOTIFICATION = "invoice_notification"
STATUS_QUEUED = "queued"
STATUS_PROCESSING = "processing"
STATUS_SENT = "sent"
STATUS_FAILED = "failed"
STATUS_SKIPPED = "skipped"


def _pos_outbox_filters():
    return (
        NotificationOutbox.event_type == EVENT_INVOICE_NOTIFICATION,
        NotificationOutbox.notification_id.is_not(None),
    )


def normalize_phone(phone: str | None) -> str | None:
    if not phone:
        logger.info("event=notification_phone_normalized input_present=false normalized=false reason=missing")
        return None
    raw = phone.strip()
    if raw.startswith("+") and re.fullmatch(r"\+\d{8,15}", raw):
        logger.info(
            "event=notification_phone_normalized input=%s normalized=%s reason=already_valid",
            _mask_phone(raw),
            _mask_phone(raw),
        )
        return raw
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) == 10:
        country = settings.DEFAULT_CUSTOMER_COUNTRY_CODE.strip() or "+91"
        normalized = f"{country if country.startswith('+') else f'+{country}'}{digits}"
        logger.info(
            "event=notification_phone_normalized input=%s normalized=%s reason=local_10_digit",
            _mask_phone(raw),
            _mask_phone(normalized),
        )
        return normalized
    if 8 <= len(digits) <= 15:
        normalized = f"+{digits}"
        logger.info(
            "event=notification_phone_normalized input=%s normalized=%s reason=digits_with_country",
            _mask_phone(raw),
            _mask_phone(normalized),
        )
        return normalized
    logger.info(
        "event=notification_phone_normalized input=%s normalized=false reason=invalid_length digit_count=%s",
        _mask_phone(raw),
        len(digits),
    )
    return None


def _mask_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    text = str(phone)
    digits = "".join(ch for ch in text if ch.isdigit())
    if len(digits) <= 4:
        return "*" * len(digits)
    suffix = digits[-4:]
    prefix = "+" if text.strip().startswith("+") else ""
    return f"{prefix}{'*' * max(len(digits) - 4, 0)}{suffix}"


def invoice_total(invoice: Invoice) -> Decimal:
    return (
        Decimal(str(invoice.taxable_value or 0))
        + Decimal(str(invoice.cgst or 0))
        + Decimal(str(invoice.sgst or 0))
        + Decimal(str(invoice.igst or 0))
    )


def money(value: Decimal | int | float | None) -> str:
    return f"₹{Decimal(str(value or 0)):,.2f}"


def clean(value: object | None) -> str:
    return str(value or "").strip()


def escape_pdf_text(value: object | None) -> str:
    text = clean(value).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return text.encode("latin-1", "replace").decode("latin-1")


def short(value: object | None, limit: int) -> str:
    text = clean(value)
    return text if len(text) <= limit else f"{text[: max(0, limit - 3)]}..."


class PdfBuilder:
    def __init__(self) -> None:
        self.commands: list[str] = []

    def text(self, x: float, y: float, value: object | None, size: int = 9, bold: bool = False) -> None:
        font = "F2" if bold else "F1"
        self.commands.append(f"BT /{font} {size} Tf {x:.2f} {y:.2f} Td ({escape_pdf_text(value)}) Tj ET")

    def line(self, x1: float, y1: float, x2: float, y2: float, width: float = 0.6) -> None:
        self.commands.append(f"{width:.2f} w {x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S")

    def rect(self, x: float, y: float, width: float, height: float, stroke: bool = True, fill: bool = False) -> None:
        operator = "B" if stroke and fill else "S" if stroke else "f"
        self.commands.append(f"{x:.2f} {y:.2f} {width:.2f} {height:.2f} re {operator}")

    def fill_color(self, r: float, g: float, b: float) -> None:
        self.commands.append(f"{r:.3f} {g:.3f} {b:.3f} rg")

    def black(self) -> None:
        self.fill_color(0, 0, 0)

    def write_pdf(self) -> bytes:
        stream = "\n".join(self.commands).encode("latin-1", "replace")
        objects = [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            (
                b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
                b"/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>"
            ),
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        ]
        output = BytesIO()
        output.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = [0]
        for index, pdf_object in enumerate(objects, start=1):
            offsets.append(output.tell())
            output.write(f"{index} 0 obj\n".encode())
            output.write(pdf_object)
            output.write(b"\nendobj\n")
        xref_start = output.tell()
        output.write(f"xref\n0 {len(objects) + 1}\n".encode())
        output.write(b"0000000000 65535 f \n")
        for offset in offsets[1:]:
            output.write(f"{offset:010d} 00000 n \n".encode())
        output.write(
            f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_start}\n%%EOF".encode()
        )
        return output.getvalue()


def build_invoice_pdf(invoice: Invoice, business: BusinessProfile | None, outlet: Outlet | None) -> bytes:
    pdf = PdfBuilder()
    pdf.black()
    business_name = business.invoice_company_name or business.trade_name or business.legal_name if business else "Store"
    pdf.text(255, 810, "Tax Invoice", size=15, bold=True)
    pdf.text(40, 785, business_name, size=12, bold=True)
    pdf.text(40, 770, outlet.trade_name or outlet.name if outlet else "", size=8)
    pdf.text(40, 756, short(business.gstin if business else "", 30), size=8)
    pdf.text(350, 785, f"Invoice: {invoice.invoice_number}", size=9, bold=True)
    pdf.text(350, 770, f"Date: {invoice.date}", size=8)
    pdf.text(350, 756, f"Payment: {invoice.payment_method or '-'}", size=8)
    pdf.rect(36, 690, 523, 45)
    pdf.text(45, 716, "Customer", size=8, bold=True)
    pdf.text(45, 700, short(invoice.party_name, 55), size=8)
    table_top = 660
    pdf.rect(36, 235, 523, 425)
    pdf.fill_color(0.93, 0.95, 1)
    pdf.rect(36, table_top - 24, 523, 24, stroke=True, fill=True)
    pdf.black()
    for label, x in [("Item", 45), ("Qty", 300), ("Rate", 360), ("GST", 430), ("Total", 495)]:
        pdf.text(x, table_top - 16, label, size=8, bold=True)
    y = table_top - 42
    for item in (invoice.items or [])[:14]:
        pdf.text(45, y, short(item.product_name, 38), size=8)
        pdf.text(300, y, f"{Decimal(item.quantity):.3f}", size=8)
        pdf.text(360, y, money(item.unit_price), size=8)
        pdf.text(430, y, f"{Decimal(item.tax_rate):.2f}%", size=8)
        pdf.text(495, y, money(item.total), size=8)
        pdf.line(36, y - 8, 559, y - 8, width=0.25)
        y -= 26
    totals_y = 205
    pdf.rect(330, 120, 229, 98)
    for label, value in [
        ("Taxable", invoice.taxable_value),
        ("CGST", invoice.cgst),
        ("SGST", invoice.sgst),
        ("IGST", invoice.igst),
        ("Grand Total", invoice_total(invoice)),
    ]:
        pdf.text(345, totals_y, label, size=8, bold=label == "Grand Total")
        pdf.text(470, totals_y, money(value), size=8, bold=label == "Grand Total")
        totals_y -= 18
    pdf.rect(36, 120, 270, 98)
    pdf.text(45, 196, "Payment Summary", size=8, bold=True)
    pdf.text(45, 178, f"Method: {invoice.payment_method or '-'}", size=8)
    pdf.text(45, 160, f"Status: {invoice.status}", size=8)
    pdf.text(45, 142, f"QR Ref: {invoice.invoice_number}", size=8)
    pdf.text(45, 70, "Computer Generated Invoice", size=8)
    return pdf.write_pdf()


class EmailInvoiceProvider:
    @property
    def configured(self) -> bool:
        return bool(settings.SMTP_HOST and settings.SMTP_USERNAME and settings.SMTP_PASSWORD and settings.SMTP_FROM)

    async def send(
        self,
        *,
        invoice: Invoice,
        customer: Customer,
        business: BusinessProfile | None,
        outlet: Outlet | None,
        public_url: str,
    ) -> SendResult:
        if not self.configured:
            return SendResult(error="SMTP provider is not configured")
        if not customer.email:
            return SendResult(error="Customer email is missing")
        return await __import__("asyncio").to_thread(
            self._send_sync,
            invoice,
            customer,
            business,
            outlet,
            public_url,
        )

    def _send_sync(
        self,
        invoice: Invoice,
        customer: Customer,
        business: BusinessProfile | None,
        outlet: Outlet | None,
        public_url: str,
    ) -> SendResult:
        business_name = business.invoice_company_name or business.trade_name or business.legal_name if business else "Store"
        subject = f"Invoice {invoice.invoice_number} from {business_name}"
        rows = "".join(
            f"<tr><td>{escape(item.product_name)}</td><td align='right'>{Decimal(item.quantity):.3f}</td>"
            f"<td align='right'>{money(item.unit_price)}</td><td align='right'>{money(item.total)}</td></tr>"
            for item in invoice.items or []
        )
        html = f"""
        <html><body style="font-family:Calibri,Arial,sans-serif;color:#1f2933;line-height:1.45">
          <h2 style="margin:0 0 6px">{escape(business_name)}</h2>
          <p>Dear {escape(customer.name or invoice.party_name or 'Customer')},</p>
          <p>Your invoice <strong>{escape(invoice.invoice_number)}</strong> is attached.</p>
          <table style="border-collapse:collapse;width:100%;margin:16px 0">
            <thead><tr style="background:#f2efe7">
              <th align="left" style="padding:8px;border:1px solid #ddd6c8">Product</th>
              <th align="right" style="padding:8px;border:1px solid #ddd6c8">Qty</th>
              <th align="right" style="padding:8px;border:1px solid #ddd6c8">Rate</th>
              <th align="right" style="padding:8px;border:1px solid #ddd6c8">Total</th>
            </tr></thead>
            <tbody>{rows}</tbody>
          </table>
          <p><strong>Taxable:</strong> {money(invoice.taxable_value)}<br/>
          <strong>GST:</strong> {money(Decimal(invoice.cgst) + Decimal(invoice.sgst) + Decimal(invoice.igst))}<br/>
          <strong>Grand Total:</strong> {money(invoice_total(invoice))}<br/>
          <strong>Payment:</strong> {escape(invoice.payment_method or '-')}</p>
          <p><a href="{escape(public_url)}" style="display:inline-block;background:#1f6f5b;color:white;padding:10px 14px;border-radius:8px;text-decoration:none">View invoice</a></p>
        </body></html>
        """
        text = (
            f"Dear {customer.name or invoice.party_name or 'Customer'},\n\n"
            f"Your invoice {invoice.invoice_number} from {business_name} is attached.\n"
            f"Grand total: {money(invoice_total(invoice))}\n"
            f"View invoice: {public_url}\n"
        )
        message = EmailMessage()
        message["From"] = settings.SMTP_FROM
        message["To"] = customer.email
        message["Subject"] = subject
        message.set_content(text)
        message.add_alternative(html, subtype="html")
        message.add_attachment(
            build_invoice_pdf(invoice, business, outlet),
            maintype="application",
            subtype="pdf",
            filename=f"{invoice.invoice_number}.pdf",
        )
        try:
            context = ssl.create_default_context()
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as smtp:
                smtp.starttls(context=context)
                smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                smtp.send_message(message)
            return SendResult()
        except Exception as exc:
            return SendResult(error=str(exc))


class NotificationService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def _outbox_metadata(invoice: Invoice, channel: str) -> dict:
        invoice_id = str(invoice.id)
        return {
            "idempotency_key": f"invoice:{invoice_id}:{channel}",
            "event_type": "invoice_notification",
            "aggregate_type": "invoice",
            "aggregate_id": invoice_id,
            "payload": {
                "invoice_id": invoice.id,
                "invoice_number": invoice.invoice_number,
                "channel": channel,
            },
        }

    async def queue_invoice_notifications(
        self,
        invoice: Invoice,
        *,
        public_url: str | None = None,
    ) -> dict[str, str]:
        customer = await self.db.get(Customer, invoice.customer_id) if invoice.customer_id else None
        phone = normalize_phone(customer.phone if customer else None)
        statuses: dict[str, str] = {}
        for channel, enabled in (
            (CHANNEL_SMS, settings.sms_enabled),
            (CHANNEL_WHATSAPP, settings.whatsapp_enabled),
        ):
            if not enabled:
                statuses[channel] = STATUS_SKIPPED
                logger.info(
                    "event=notification_channel_decision invoice_id=%s channel=%s status=%s reason=%s outbox_created=false",
                    invoice.id,
                    channel,
                    STATUS_SKIPPED,
                    "Channel disabled",
                )
                continue
            contact = phone
            status, error = self._initial_status(invoice, customer, contact, enabled, channel)
            notification = InvoiceNotification(
                invoice_id=invoice.id,
                customer_id=invoice.customer_id,
                business_profile_id=invoice.business_profile_id,
                outlet_id=invoice.outlet_id,
                channel=channel,
                phone=contact,
                status=status,
                error_message=error,
                failed_at=datetime.now(timezone.utc) if status == STATUS_SKIPPED else None,
            )
            self.db.add(notification)
            try:
                await self.db.flush()
            except IntegrityError:
                await self.db.rollback()
                raise
            if status == STATUS_QUEUED:
                outbox_metadata = self._outbox_metadata(invoice, channel)
                self.db.add(
                    NotificationOutbox(
                        **outbox_metadata,
                        notification_id=notification.id,
                        invoice_id=invoice.id,
                        customer_id=invoice.customer_id,
                        business_profile_id=invoice.business_profile_id,
                        outlet_id=invoice.outlet_id,
                        channel=channel,
                        phone=contact,
                        public_url=public_url,
                        status=STATUS_QUEUED,
                        next_attempt_at=datetime.now(timezone.utc),
                    )
                )
                logger.info(
                    "event=notification_channel_decision invoice_id=%s channel=%s status=%s reason=Ready outbox_created=true phone=%s",
                    invoice.id,
                    channel,
                    status,
                    _mask_phone(phone),
                )
            else:
                logger.info(
                    "event=notification_channel_decision invoice_id=%s channel=%s status=%s reason=%s outbox_created=false phone=%s",
                    invoice.id,
                    channel,
                    status,
                    error,
                    _mask_phone(phone),
                )
            statuses[channel] = status
        await self.db.flush()
        logger.info(
            "event=invoice_notifications_queued invoice_id=%s business_profile_id=%s sms=%s whatsapp=%s",
            invoice.id,
            invoice.business_profile_id,
            statuses.get(CHANNEL_SMS),
            statuses.get(CHANNEL_WHATSAPP),
        )
        return statuses

    @staticmethod
    def _initial_status(
        invoice: Invoice,
        customer: Customer | None,
        contact: str | None,
        enabled: bool,
        channel: str,
    ) -> tuple[str, str | None]:
        if not enabled:
            return STATUS_SKIPPED, "Channel disabled"
        if invoice.status.lower() != "paid":
            return STATUS_SKIPPED, "Invoice is not paid"
        if not customer:
            return STATUS_SKIPPED, "Customer not attached"
        if not contact:
            if channel == CHANNEL_EMAIL:
                return STATUS_SKIPPED, "Customer email is missing"
            return STATUS_SKIPPED, "Customer phone is missing or invalid"
        return STATUS_QUEUED, None

    async def health(self, business_profile_id: int) -> dict:
        pending = await self.db.scalar(
            select(func.count(NotificationOutbox.id)).where(
                *_pos_outbox_filters(),
                NotificationOutbox.business_profile_id == business_profile_id,
                NotificationOutbox.status == STATUS_QUEUED,
            )
        )
        failed = await self.db.scalar(
            select(func.count(NotificationOutbox.id)).where(
                *_pos_outbox_filters(),
                NotificationOutbox.business_profile_id == business_profile_id,
                NotificationOutbox.status == STATUS_FAILED,
            )
        )
        last_processed = await self.db.scalar(
            select(func.max(NotificationOutbox.processed_at)).where(
                *_pos_outbox_filters(),
                NotificationOutbox.business_profile_id == business_profile_id,
                NotificationOutbox.processed_at.is_not(None),
            )
        )
        return {
            **settings.notification_config_summary(),
            "pending_outbox": int(pending or 0),
            "failed_outbox": int(failed or 0),
            "last_processed_at": last_processed,
        }

    async def list_for_invoice(
        self,
        invoice_id: int,
        business_profile_id: int,
    ) -> list[InvoiceNotification]:
        stmt = (
            select(InvoiceNotification)
            .where(
                InvoiceNotification.invoice_id == invoice_id,
                InvoiceNotification.business_profile_id == business_profile_id,
            )
            .order_by(InvoiceNotification.channel)
        )
        return (await self.db.execute(stmt)).scalars().all()

    async def resend(
        self,
        invoice_id: int,
        business_profile_id: int,
        channel: str,
        *,
        public_url: str | None = None,
    ) -> InvoiceNotification:
        normalized_channel = channel.strip().lower()
        if normalized_channel not in {CHANNEL_SMS, CHANNEL_WHATSAPP}:
            raise BusinessRuleError("Unsupported notification channel")
        invoice = (
            await self.db.execute(
                select(Invoice).where(
                    Invoice.id == invoice_id,
                    Invoice.business_profile_id == business_profile_id,
                )
            )
        ).scalar_one_or_none()
        if not invoice:
            raise NotFoundError("Invoice not found")
        customer = await self.db.get(Customer, invoice.customer_id) if invoice.customer_id else None
        phone = normalize_phone(customer.phone if customer else None)
        enabled = settings.sms_enabled if normalized_channel == CHANNEL_SMS else settings.whatsapp_enabled
        contact = phone
        status, error = self._initial_status(invoice, customer, contact, enabled, normalized_channel)
        notification = (
            await self.db.execute(
                select(InvoiceNotification).where(
                    InvoiceNotification.invoice_id == invoice_id,
                    InvoiceNotification.channel == normalized_channel,
                )
            )
        ).scalar_one_or_none()
        if not notification:
            notification = InvoiceNotification(
                invoice_id=invoice.id,
                customer_id=invoice.customer_id,
                business_profile_id=invoice.business_profile_id,
                outlet_id=invoice.outlet_id,
                channel=normalized_channel,
            )
            self.db.add(notification)
            await self.db.flush()
        notification.phone = contact
        notification.status = status
        notification.error_message = error
        notification.failed_at = datetime.now(timezone.utc) if status == STATUS_SKIPPED else None
        notification.sent_at = None
        notification.twilio_sid = None
        if status == STATUS_QUEUED:
            outbox = (
                await self.db.execute(
                    select(NotificationOutbox).where(
                        NotificationOutbox.invoice_id == invoice.id,
                        NotificationOutbox.channel == normalized_channel,
                    )
                )
            ).scalar_one_or_none()
            if not outbox:
                outbox = NotificationOutbox(
                    invoice_id=invoice.id,
                    channel=normalized_channel,
                    business_profile_id=invoice.business_profile_id,
                )
                self.db.add(outbox)
            outbox_metadata = self._outbox_metadata(invoice, normalized_channel)
            outbox.idempotency_key = outbox_metadata["idempotency_key"]
            outbox.event_type = outbox_metadata["event_type"]
            outbox.aggregate_type = outbox_metadata["aggregate_type"]
            outbox.aggregate_id = outbox_metadata["aggregate_id"]
            outbox.payload = outbox_metadata["payload"]
            outbox.notification_id = notification.id
            outbox.customer_id = invoice.customer_id
            outbox.outlet_id = invoice.outlet_id
            outbox.phone = contact
            outbox.public_url = public_url
            outbox.status = STATUS_QUEUED
            outbox.max_attempts = max(outbox.max_attempts or 0, 6)
            outbox.last_error = None
            outbox.next_attempt_at = datetime.now(timezone.utc)
            outbox.processed_at = None
            logger.info(
                "event=notification_resend_decision invoice_id=%s channel=%s status=%s reason=Ready outbox_created=true phone=%s",
                invoice.id,
                normalized_channel,
                status,
                _mask_phone(phone),
            )
        else:
            logger.info(
                "event=notification_resend_decision invoice_id=%s channel=%s status=%s reason=%s outbox_created=false phone=%s",
                invoice.id,
                normalized_channel,
                status,
                error,
                _mask_phone(phone),
            )
        await self.db.flush()
        await self.db.refresh(notification)
        return notification

    async def analytics(self, business_profile_id: int) -> dict:
        rows = (
            await self.db.execute(
                select(
                    InvoiceNotification.channel,
                    InvoiceNotification.status,
                    func.count(InvoiceNotification.id),
                )
                .where(InvoiceNotification.business_profile_id == business_profile_id)
                .group_by(InvoiceNotification.channel, InvoiceNotification.status)
            )
        ).all()
        counts = {(channel, status): int(count) for channel, status, count in rows}
        sent = (
            counts.get((CHANNEL_EMAIL, STATUS_SENT), 0)
            + counts.get((CHANNEL_SMS, STATUS_SENT), 0)
            + counts.get((CHANNEL_WHATSAPP, STATUS_SENT), 0)
        )
        failed = (
            counts.get((CHANNEL_EMAIL, STATUS_FAILED), 0)
            + counts.get((CHANNEL_SMS, STATUS_FAILED), 0)
            + counts.get((CHANNEL_WHATSAPP, STATUS_FAILED), 0)
        )
        queued = (
            counts.get((CHANNEL_EMAIL, STATUS_QUEUED), 0)
            + counts.get((CHANNEL_SMS, STATUS_QUEUED), 0)
            + counts.get((CHANNEL_WHATSAPP, STATUS_QUEUED), 0)
        )
        total = sent + failed + queued
        return {
            "email_sent": counts.get((CHANNEL_EMAIL, STATUS_SENT), 0),
            "email_failed": counts.get((CHANNEL_EMAIL, STATUS_FAILED), 0),
            "sms_sent": counts.get((CHANNEL_SMS, STATUS_SENT), 0),
            "sms_failed": counts.get((CHANNEL_SMS, STATUS_FAILED), 0),
            "whatsapp_sent": counts.get((CHANNEL_WHATSAPP, STATUS_SENT), 0),
            "whatsapp_failed": counts.get((CHANNEL_WHATSAPP, STATUS_FAILED), 0),
            "queued_messages": queued,
            "retry_queue": await self._retry_queue_count(business_profile_id),
            "delivery_rate": Decimal(sent * 100) / Decimal(total or 1),
            "failure_rate": Decimal(failed * 100) / Decimal(total or 1),
        }

    async def _retry_queue_count(self, business_profile_id: int) -> int:
        stmt = select(func.count(NotificationOutbox.id)).where(
            *_pos_outbox_filters(),
            NotificationOutbox.business_profile_id == business_profile_id,
            NotificationOutbox.status == STATUS_QUEUED,
            NotificationOutbox.attempts > 0,
        )
        return int((await self.db.execute(stmt)).scalar_one())


class NotificationProcessor:
    def __init__(
        self,
        db: AsyncSession,
        email_provider: EmailInvoiceProvider | None = None,
        sms_provider: TwilioSmsProvider | None = None,
        whatsapp_provider: TwilioWhatsAppProvider | None = None,
    ):
        self.db = db
        self.email_provider = email_provider or EmailInvoiceProvider()
        self.sms_provider = sms_provider or TwilioSmsProvider()
        self.whatsapp_provider = whatsapp_provider or TwilioWhatsAppProvider()

    async def claim_due_outbox(self, limit: int | None = None) -> list[int]:
        now = datetime.now(timezone.utc)
        stale_before = now - timedelta(seconds=settings.NOTIFICATION_RETRY_DELAY_SECONDS)
        stmt = (
            select(NotificationOutbox)
            .where(
                *_pos_outbox_filters(),
                or_(
                    and_(
                        NotificationOutbox.status == STATUS_QUEUED,
                        or_(
                            NotificationOutbox.next_attempt_at.is_(None),
                            NotificationOutbox.next_attempt_at <= now,
                        ),
                    ),
                    and_(
                        NotificationOutbox.status == STATUS_PROCESSING,
                        NotificationOutbox.updated_at <= stale_before,
                    ),
                )
            )
            .order_by(NotificationOutbox.created_at)
            .with_for_update(skip_locked=True)
            .limit(limit or settings.NOTIFICATION_BATCH_SIZE)
        )
        items = (await self.db.execute(stmt)).scalars().all()
        claimed_ids: list[int] = []
        for item in items:
            item.status = STATUS_PROCESSING
            item.last_error = None
            claimed_ids.append(item.id)
        await self.db.commit()
        if claimed_ids:
            logger.info("event=notification_outbox_claimed count=%s ids=%s", len(claimed_ids), claimed_ids)
        else:
            logger.debug("event=notification_outbox_claimed count=0 ids=[]")
        return claimed_ids

    async def due_outbox(self, limit: int | None = None) -> list[NotificationOutbox]:
        ids = await self.claim_due_outbox(limit)
        if not ids:
            return []
        stmt = select(NotificationOutbox).where(NotificationOutbox.id.in_(ids))
        return (await self.db.execute(stmt)).scalars().all()

    async def process(self, outbox_id: int) -> bool:
        item = await self.db.get(NotificationOutbox, outbox_id)
        if not item or item.status != STATUS_PROCESSING:
            await self.db.rollback()
            return False

        invoice = (
            await self.db.execute(
                select(Invoice)
                .options(selectinload(Invoice.items))
                .where(Invoice.id == item.invoice_id)
            )
        ).scalar_one_or_none()
        notification = await self.db.get(InvoiceNotification, item.notification_id)
        if not invoice or not notification:
            item.attempts += 1
            item.status = STATUS_FAILED
            item.last_error = "Invoice or notification not found"
            item.processed_at = datetime.now(timezone.utc)
            self._record_history(
                item,
                status=STATUS_FAILED,
                attempt=item.attempts,
                provider_response={"error": item.last_error},
                completed_at=item.processed_at,
            )
            await self.db.commit()
            logger.warning(
                "event=notification_process_failed outbox_id=%s reason=%s",
                outbox_id,
                item.last_error,
            )
            return True

        link_service = InvoiceLinkService(self.db)
        _, token = await link_service.get_or_create_active_link(invoice)
        public_url = link_service.build_public_invoice_url(token)
        phone = item.phone or ""
        channel = item.channel
        notification_id = notification.id
        customer = await self.db.get(Customer, invoice.customer_id) if invoice.customer_id else None
        business = await self.db.get(BusinessProfile, invoice.business_profile_id) if invoice.business_profile_id else None
        outlet = await self.db.get(Outlet, invoice.outlet_id) if invoice.outlet_id else None
        await self.db.commit()

        provider = (
            self.email_provider
            if channel == CHANNEL_EMAIL
            else self.sms_provider
            if channel == CHANNEL_SMS
            else self.whatsapp_provider
        )
        logger.info(
            "event=notification_send_start outbox_id=%s invoice_id=%s channel=%s destination=%s provider_configured=%s",
            outbox_id,
            invoice.id,
            channel,
            phone if channel == CHANNEL_EMAIL else _mask_phone(phone),
            getattr(provider, "configured", True),
        )
        started_at = time.perf_counter()
        if channel == CHANNEL_EMAIL:
            if not customer:
                result = SendResult(error="Customer not found")
            else:
                result = await self.email_provider.send(
                    invoice=invoice,
                    customer=customer,
                    business=business,
                    outlet=outlet,
                    public_url=public_url,
                )
        else:
            body = await self._message(invoice, public_url)
            result = await provider.send(phone, body)
        elapsed_ms = (time.perf_counter() - started_at) * 1000

        db_item = await self.db.get(NotificationOutbox, outbox_id)
        db_notification = await self.db.get(InvoiceNotification, notification_id)
        if not db_item or not db_notification or db_item.status != STATUS_PROCESSING:
            await self.db.rollback()
            return False
        now = datetime.now(timezone.utc)
        db_item.attempts += 1
        db_notification.attempts += 1
        if result.ok:
            db_item.status = STATUS_SENT
            db_item.processed_at = now
            db_item.last_error = None
            db_notification.status = STATUS_SENT
            db_notification.twilio_sid = result.sid
            db_notification.error_message = None
            db_notification.sent_at = now
            db_notification.failed_at = None
            logger.info(
                "event=notification_send_completed outbox_id=%s invoice_id=%s channel=%s status=sent sid=%s elapsed_ms=%.2f",
                outbox_id,
                invoice.id,
                channel,
                result.sid,
                elapsed_ms,
            )
            self._record_history(
                db_item,
                status=STATUS_SENT,
                attempt=db_item.attempts,
                provider_response={"sid": result.sid, "elapsedMs": round(elapsed_ms, 2)},
                completed_at=now,
            )
        else:
            error = result.error or "Twilio send failed"
            db_item.last_error = error
            db_notification.status = STATUS_FAILED
            db_notification.error_message = error
            db_notification.failed_at = now
            db_notification.sent_at = None
            if db_item.attempts >= settings.NOTIFICATION_RETRY_COUNT:
                db_item.status = STATUS_FAILED
                db_item.processed_at = now
                logger.warning(
                    "event=notification_send_failed outbox_id=%s invoice_id=%s channel=%s status=failed attempts=%s error=%s elapsed_ms=%.2f",
                    outbox_id,
                    invoice.id,
                    channel,
                    db_item.attempts,
                    error,
                    elapsed_ms,
                )
                self._record_history(
                    db_item,
                    status=STATUS_FAILED,
                    attempt=db_item.attempts,
                    provider_response={"error": error, "elapsedMs": round(elapsed_ms, 2)},
                    completed_at=now,
                )
            else:
                db_item.status = STATUS_QUEUED
                db_item.next_attempt_at = now + timedelta(
                    seconds=settings.NOTIFICATION_RETRY_DELAY_SECONDS
                )
                db_item.processed_at = None
                logger.warning(
                    "event=notification_send_failed outbox_id=%s invoice_id=%s channel=%s status=retry_scheduled attempts=%s next_attempt_at=%s error=%s elapsed_ms=%.2f",
                    outbox_id,
                    invoice.id,
                    channel,
                    db_item.attempts,
                    db_item.next_attempt_at,
                    error,
                    elapsed_ms,
                )
                self._record_history(
                    db_item,
                    status="retry_scheduled",
                    attempt=db_item.attempts,
                    provider_response={
                        "error": error,
                        "elapsedMs": round(elapsed_ms, 2),
                        "nextAttemptAt": db_item.next_attempt_at.isoformat(),
                    },
                    completed_at=now,
                )
        await self.db.commit()
        return True

    def _record_history(
        self,
        item: NotificationOutbox,
        *,
        status: str,
        attempt: int,
        provider_response: dict | None,
        completed_at: datetime | None,
    ) -> None:
        self.db.add(
            NotificationHistory(
                notification_id=item.notification_id,
                outbox_id=item.id,
                invoice_id=item.invoice_id,
                customer_id=item.customer_id,
                business_profile_id=item.business_profile_id,
                outlet_id=item.outlet_id,
                event_type=item.event_type or "invoice_notification",
                aggregate_type=item.aggregate_type or "invoice",
                aggregate_id=item.aggregate_id or str(item.invoice_id),
                channel=item.channel,
                status=status,
                attempt=attempt,
                channel_summary={item.channel: status},
                provider_response=provider_response,
                error_message=item.last_error,
                completed_at=completed_at,
            )
        )

    async def _message(self, invoice: Invoice, public_url: str) -> str:
        business = await self.db.get(BusinessProfile, invoice.business_profile_id)
        business_name = business.invoice_company_name or business.trade_name or business.legal_name if business else "Store"
        amount = f"{invoice_total(invoice):,.2f}"
        return (
            f"Hello {invoice.party_name}\n\n"
            f"Thank you for shopping with {business_name}.\n\n"
            f"Invoice:\n{invoice.invoice_number}\n\n"
            f"Amount:\n₹{amount}\n\n"
            f"View Invoice:\n{public_url}\n\n"
            "Thank you."
        )
