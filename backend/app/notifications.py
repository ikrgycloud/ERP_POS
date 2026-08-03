import logging
import smtplib
import ssl
import base64
from html import escape
from dataclasses import dataclass
from decimal import Decimal
from email.message import EmailMessage
from urllib.error import HTTPError
from urllib import parse, request

from sqlalchemy.orm import Session
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.document_service import document_service
from app.models import (
    BusinessProfile,
    Customer,
    Invoice,
    Order,
    Outlet,
    Supplier,
    SupplierReturn,
    SupplierReturnShipment,
)
from app.public_invoice_links import public_invoice_pdf_url
from app.services import invoice_total, order_totals

logger = logging.getLogger("erp-backend")


@dataclass
class InvoiceRecipient:
    name: str
    email: str | None = None
    phone: str | None = None


def _money(value: Decimal) -> str:
    return f"Rs. {value:.2f}"


def _normalize_india_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    cleaned = "".join(character for character in phone if character.isdigit() or character == "+")
    if cleaned.startswith("+"):
        return cleaned
    digits = "".join(character for character in cleaned if character.isdigit())
    if len(digits) == 10:
        settings = get_settings()
        country_code = settings.default_customer_country_code.strip() or "+91"
        normalized_country_code = country_code if country_code.startswith("+") else f"+{country_code}"
        return f"{normalized_country_code}{digits}"
    if len(digits) == 12 and digits.startswith("91"):
        return f"+{digits}"
    return cleaned or None


def _resolve_invoice_recipient(db: Session, invoice: Invoice) -> InvoiceRecipient | None:
    is_purchase = bool(invoice.order and invoice.order.type == "purchase") or str(invoice.invoice_type).lower() == "purchase"

    if is_purchase and invoice.order and invoice.order.supplier_id:
        supplier = db.get(Supplier, invoice.order.supplier_id)
        if supplier:
            return InvoiceRecipient(
                name=supplier.name or invoice.party_name,
                email=supplier.email,
                phone=supplier.phone or supplier.mobile,
            )

    if is_purchase and invoice.order and invoice.order.party_name:
        supplier_query = db.query(Supplier).filter(Supplier.name.ilike(invoice.order.party_name))
        if invoice.business_profile_id is not None:
            supplier_query = supplier_query.filter(Supplier.business_profile_id == invoice.business_profile_id)
        supplier = supplier_query.first()
        if supplier:
            return InvoiceRecipient(
                name=supplier.name or invoice.party_name,
                email=supplier.email,
                phone=supplier.phone or supplier.mobile,
            )

    if not is_purchase and invoice.customer_id:
        customer = db.get(Customer, invoice.customer_id)
        if customer:
            return InvoiceRecipient(
                name=customer.name or invoice.party_name,
                email=customer.email,
                phone=customer.phone,
            )

    if invoice.invoice_direction == "outlet_to_admin" and invoice.business_profile_id:
        business = db.get(BusinessProfile, invoice.business_profile_id)
        if business:
            return InvoiceRecipient(
                name=business.trade_name or business.legal_name,
                email=business.email,
                phone=business.mobile,
            )

    if invoice.outlet_id:
        outlet = db.get(Outlet, invoice.outlet_id)
        if outlet:
            return InvoiceRecipient(
                name=outlet.trade_name or outlet.name or invoice.party_name,
                email=outlet.email,
                phone=outlet.mobile,
            )

    return None


def _resolve_order_recipient(db: Session, order: Order) -> InvoiceRecipient | None:
    if order.supplier_id:
        supplier = db.get(Supplier, order.supplier_id)
        if supplier:
            return InvoiceRecipient(
                name=supplier.name or order.party_name,
                email=supplier.email,
                phone=supplier.mobile,
            )

    if order.customer_id:
        customer = db.get(Customer, order.customer_id)
        if customer:
            return InvoiceRecipient(
                name=customer.name or order.party_name,
                email=customer.email,
                phone=customer.phone,
            )

    if order.outlet_id:
        outlet = db.get(Outlet, order.outlet_id)
        if outlet:
            return InvoiceRecipient(
                name=outlet.trade_name or outlet.name or order.party_name,
                email=outlet.email,
                phone=outlet.mobile,
            )

    if order.business_profile_id:
        business = db.get(BusinessProfile, order.business_profile_id)
        if business:
            return InvoiceRecipient(
                name=business.trade_name or business.legal_name,
                email=business.email,
                phone=business.mobile,
            )

    return None


def _invoice_text(invoice: Invoice, recipient: InvoiceRecipient) -> tuple[str, str]:
    total = invoice_total(invoice)
    subject = f"Tax Invoice {invoice.invoice_number}"
    body = "\n".join(
        [
            f"Dear {recipient.name},",
            "",
            f"Your tax invoice {invoice.invoice_number} has been generated.",
            f"Party: {invoice.party_name}",
            f"Invoice date: {invoice.date}",
            f"Due date: {invoice.due_date}",
            f"Taxable value: {_money(invoice.taxable_value)}",
            f"CGST: {_money(invoice.cgst)}",
            f"SGST: {_money(invoice.sgst)}",
            f"IGST: {_money(invoice.igst)}",
            f"Grand total: {_money(total)}",
            "",
            "Please contact the business team for invoice copy, returns, or reverse invoice approvals.",
        ]
    )
    return subject, body


def _invoice_html(
    invoice: Invoice,
    recipient: InvoiceRecipient,
    *,
    business_name: str,
    public_url: str,
) -> str:
    rows = [
        ("Invoice number", invoice.invoice_number or str(invoice.id)),
        ("Invoice date", invoice.date),
        ("Due date", invoice.due_date),
        ("Taxable value", _money(invoice.taxable_value)),
        ("Tax", _money(Decimal(invoice.cgst or 0) + Decimal(invoice.sgst or 0) + Decimal(invoice.igst or 0))),
        ("Grand total", _money(invoice_total(invoice))),
    ]
    detail_rows = "".join(
        f'<tr><td style="padding:8px;border-bottom:1px solid #E2E8F0;color:#64748B;">{escape(str(label))}</td>'
        f'<td align="right" style="padding:8px;border-bottom:1px solid #E2E8F0;font-weight:600;">{escape(str(value))}</td></tr>'
        for label, value in rows
    )
    return f"""
    <html>
      <body style="margin:0;background:#F8FAFC;font-family:Arial,sans-serif;color:#0F172A;">
        <div style="max-width:620px;margin:0 auto;padding:28px 18px;">
          <div style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:14px;overflow:hidden;">
            <div style="background:#1D4ED8;color:#FFFFFF;padding:22px 26px;">
              <div style="font-size:13px;opacity:.86;">{escape(business_name)}</div>
              <h1 style="font-size:22px;margin:6px 0 0;">Invoice generated</h1>
            </div>
            <div style="padding:24px 26px;">
              <p>Dear {escape(recipient.name)},</p>
              <p>Your invoice is ready. A PDF copy is attached for your records.</p>
              <table style="border-collapse:collapse;width:100%;margin:18px 0;">{detail_rows}</table>
              <p style="margin:22px 0;">
                <a href="{escape(public_url, quote=True)}" style="background:#1D4ED8;border-radius:8px;color:#FFFFFF;display:inline-block;padding:11px 18px;text-decoration:none;">View invoice PDF</a>
              </p>
              <p style="color:#64748B;font-size:13px;">Please contact {escape(business_name)} if you have any questions about this invoice.</p>
            </div>
          </div>
        </div>
      </body>
    </html>
    """


def _order_received_text(order: Order, recipient: InvoiceRecipient) -> tuple[str, str]:
    totals = order_totals(order)
    subject = f"Order confirmation: {order.order_number}"
    body = "\n".join(
        [
            f"Dear {recipient.name},",
            "",
            f"Your order {order.order_number} has been confirmed and is marked as {order.status}.",
            f"Party: {order.party_name}",
            f"Order type: {order.type}",
            f"Order date: {order.date}",
            f"Payment status: {order.payment_status}",
            f"Taxable value: {_money(totals['taxable_value'])}",
            f"Tax value: {_money(totals['tax_value'])}",
            f"Grand total: {_money(totals['grand_total'])}",
            "",
            "Inventory has been updated for this order.",
        ]
    )
    return subject, body


def _send_email(
    to_email: str,
    subject: str,
    body: str,
    attachment: tuple[str, bytes, str] | None = None,
    html_body: str | None = None,
) -> bool:
    settings = get_settings()
    from_email = settings.smtp_from_email or settings.smtp_username
    if not settings.smtp_username or not settings.smtp_password or not from_email:
        logger.info("Email skipped because SMTP settings are incomplete")
        return False

    message = EmailMessage()
    message["From"] = from_email
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(body)
    if html_body:
        message.add_alternative(html_body, subtype="html")
    if attachment:
        filename, content, mime_type = attachment
        maintype, subtype = mime_type.split("/", 1)
        message.add_attachment(content, maintype=maintype, subtype=subtype, filename=filename)

    context = ssl.create_default_context()
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        smtp.starttls(context=context)
        smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(message)
    return True


def _send_sms(to_phone: str, body: str) -> bool:
    settings = get_settings()
    if not settings.sms_enabled:
        logger.info("SMS skipped because SMS_ENABLED/TWILIO_ENABLED is false")
        return False
    if not settings.twilio_account_sid or not settings.twilio_auth_token or not settings.twilio_from_number:
        logger.info("SMS skipped because Twilio settings are incomplete")
        return False

    data = parse.urlencode(
        {
            "To": to_phone,
            "From": settings.twilio_from_number,
            "Body": body,
        }
    ).encode()
    url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.twilio_account_sid}/Messages.json"
    twilio_request = request.Request(url, data=data)
    encoded_auth = base64.b64encode(
        f"{settings.twilio_account_sid}:{settings.twilio_auth_token}".encode()
    ).decode()
    twilio_request.add_header("Authorization", f"Basic {encoded_auth}")
    try:
        request.urlopen(twilio_request, timeout=20).close()
    except HTTPError as exc:
        provider_response = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"Twilio HTTP {exc.code}: {provider_response}") from exc
    return True


def _supplier_return_text(
    supplier_return: SupplierReturn,
    recipient: InvoiceRecipient,
    *,
    dispatched: bool,
    business_name: str,
    shipment: SupplierReturnShipment | None = None,
) -> tuple[str, str, str]:
    action = "dispatched" if dispatched else "created"
    subject = f"{business_name} | RTV {supplier_return.rtv_number} {action}"
    item_lines = []
    for item in supplier_return.items or []:
        snapshot = item.product_snapshot or {}
        item_lines.append(
            f"- {snapshot.get('name') or f'Product {item.product_id}'} "
            f"({snapshot.get('sku') or '-'}) qty {Decimal(item.quantity_requested or 0):.3f}: "
            f"{item.reason or supplier_return.reason or 'Damaged return'}"
        )
    shipment_lines = []
    if dispatched and shipment:
        shipment_lines = [
            f"Carrier: {shipment.carrier_name or '-'}",
            f"Tracking / LR: {shipment.tracking_number or '-'}",
            f"Vehicle: {shipment.vehicle_number or '-'}",
            f"Dispatch date: {shipment.shipment_date or '-'}",
            "",
        ]
    action_request = (
        "Please confirm receipt after delivery and coordinate the replacement, credit note, or resolution with our team."
        if dispatched
        else "Please coordinate pickup, replacement, or a credit note with our team."
    )
    body = "\n".join(
        [
            f"Dear {recipient.name},",
            "",
            f"Return To Vendor request {supplier_return.rtv_number} has been {action}.",
            f"Reason: {supplier_return.reason or '-'}",
            f"Shipment status: {supplier_return.shipment_status}",
            "",
            *shipment_lines,
            "Items:",
            *(item_lines or ["- No items listed"]),
            "",
            action_request,
            f"Remarks: {supplier_return.remarks or '-'}",
            "",
            f"Regards,\n{business_name}",
        ]
    )
    rows = "".join(
        f"<tr><td>{escape(str(snapshot.get('name') or f'Product {item.product_id}'))}</td>"
        f"<td>{escape(str(snapshot.get('sku') or '-'))}</td>"
        f"<td>{Decimal(item.quantity_requested or 0):.3f}</td>"
        f"<td>{escape(str(item.reason or supplier_return.reason or 'Damaged return'))}</td></tr>"
        for item in supplier_return.items or []
        for snapshot in [item.product_snapshot or {}]
    )
    safe_name = escape(str(recipient.name))
    safe_rtv_number = escape(str(supplier_return.rtv_number))
    safe_action = escape(action)
    safe_remarks = escape(str(supplier_return.remarks or "-"))
    safe_business_name = escape(business_name)
    shipment_html = ""
    if dispatched and shipment:
        shipment_html = (
            '<div style="background:#F8FAFC;border-radius:8px;padding:12px 14px;margin:14px 0;">'
            f"<strong>Shipment details</strong><br>Carrier: {escape(str(shipment.carrier_name or '-'))}<br>"
            f"Tracking / LR: {escape(str(shipment.tracking_number or '-'))}<br>"
            f"Vehicle: {escape(str(shipment.vehicle_number or '-'))}<br>"
            f"Dispatch date: {escape(str(shipment.shipment_date or '-'))}</div>"
        )
    html = f"""
    <html>
      <body style="font-family: Calibri, Arial, sans-serif; color:#22303A; line-height:1.45;">
        <div style="color:#64748B;font-size:13px;">{safe_business_name}</div>
        <h2 style="margin:4px 0 8px;">RTV {safe_rtv_number}</h2>
        <p>Dear {safe_name},</p>
        <p>Return To Vendor request <strong>{safe_rtv_number}</strong> has been <strong>{safe_action}</strong>.</p>
        {shipment_html}
        <table style="border-collapse:collapse;width:100%;margin:16px 0;">
          <thead>
            <tr style="background:#E8F2ED;">
              <th align="left" style="padding:8px;border:1px solid #E4DCCF;">Product</th>
              <th align="left" style="padding:8px;border:1px solid #E4DCCF;">SKU</th>
              <th align="right" style="padding:8px;border:1px solid #E4DCCF;">Qty</th>
              <th align="left" style="padding:8px;border:1px solid #E4DCCF;">Reason</th>
            </tr>
          </thead>
          <tbody>{rows or '<tr><td colspan="4" style="padding:8px;border:1px solid #E4DCCF;">No items listed</td></tr>'}</tbody>
        </table>
        <p><strong>Next step:</strong> {escape(action_request)}</p>
        <p><strong>Remarks:</strong> {safe_remarks}</p>
        <p>Regards,<br><strong>{safe_business_name}</strong></p>
      </body>
    </html>
    """
    return subject, body, html


def _resolve_supplier_return_recipient(supplier_return: SupplierReturn) -> InvoiceRecipient | None:
    supplier = supplier_return.supplier
    snapshot = supplier_return.supplier_snapshot or {}
    name = supplier.name if supplier else snapshot.get("name")
    if not name:
        return None
    return InvoiceRecipient(
        name=name,
        email=(supplier.email if supplier else snapshot.get("email")),
        phone=(supplier.mobile if supplier else snapshot.get("mobile")),
    )


def _apply_rtv_notification_status(supplier_return: SupplierReturn, **updates: object) -> None:
    current_meta = dict(supplier_return.meta or {})
    notification = dict(current_meta.get("notification") or {})
    notification.update(updates)
    current_meta["notification"] = notification
    supplier_return.meta = current_meta


def send_supplier_return_notification_channel(
    db: Session,
    supplier_return_id: int,
    *,
    channel: str,
    dispatched: bool = False,
) -> dict[str, object]:
    supplier_return = (
        db.query(SupplierReturn)
        .options(
            selectinload(SupplierReturn.items),
            selectinload(SupplierReturn.supplier),
            selectinload(SupplierReturn.current_status),
        )
        .filter(SupplierReturn.id == supplier_return_id)
        .first()
    )
    if not supplier_return:
        return {"status": "failed", "error": "Supplier return not found"}
    recipient = _resolve_supplier_return_recipient(supplier_return)
    if not recipient:
        _apply_rtv_notification_status(
            supplier_return,
            status="failed",
            last_step="recipient",
            last_error="No supplier recipient",
        )
        return {"status": "failed", "error": "No supplier recipient"}

    business = db.get(BusinessProfile, supplier_return.business_profile_id)
    business_name = (business.trade_name or business.legal_name) if business else "Business team"
    shipment = None
    if dispatched:
        shipment = (
            db.query(SupplierReturnShipment)
            .filter(SupplierReturnShipment.supplier_return_id == supplier_return.id)
            .order_by(SupplierReturnShipment.created_at.desc(), SupplierReturnShipment.id.desc())
            .first()
        )
    subject, body, html = _supplier_return_text(
        supplier_return,
        recipient,
        dispatched=dispatched,
        business_name=business_name,
        shipment=shipment,
    )
    logger.info(
        "event=rtv_notification_channel_started supplier_return_id=%s channel=%s dispatched=%s",
        supplier_return.id,
        channel,
        dispatched,
    )
    if channel == "email":
        if not recipient.email:
            _apply_rtv_notification_status(supplier_return, email="skipped", last_step="email")
            return {"status": "skipped", "reason": "Supplier email is missing"}
        try:
            attachment = (
                f"{supplier_return.rtv_number or supplier_return.id}.pdf",
                document_service.supplier_return_pdf(db, supplier_return),
                "application/pdf",
            )
            logger.info("event=rtv_pdf_generated supplier_return_id=%s", supplier_return.id)
            sent = _send_email(recipient.email, subject, body, attachment=attachment, html_body=html)
        except Exception as exc:
            _apply_rtv_notification_status(
                supplier_return,
                status="completed_with_errors",
                email="failed",
                last_step="email",
                last_error=str(exc),
            )
            logger.exception("event=rtv_notification_failed step=email supplier_return_id=%s", supplier_return.id)
            return {"status": "failed", "error": str(exc)}
        status = "sent" if sent else "skipped"
        _apply_rtv_notification_status(supplier_return, email=status, pdf="generated", last_step="email")
        logger.info("event=rtv_email_%s supplier_return_id=%s to=%s", status, supplier_return.id, recipient.email)
        return {"status": status, "to": recipient.email, "attachment": "pdf"}

    if channel == "sms":
        phone = _normalize_india_phone(recipient.phone)
        if not phone:
            _apply_rtv_notification_status(supplier_return, sms="skipped", last_step="sms")
            return {"status": "skipped", "reason": "Supplier phone is missing or invalid"}
        try:
            item_count = len(supplier_return.items or [])
            sms_body = (
                f"RTV {supplier_return.rtv_number}: {item_count} item(s), "
                f"reason {supplier_return.reason or 'damaged return'}. Pickup requested."
            )
            sent = _send_sms(phone, sms_body[:1500])
        except Exception as exc:
            _apply_rtv_notification_status(
                supplier_return,
                status="completed_with_errors",
                sms="failed",
                last_step="sms",
                last_error=str(exc),
            )
            logger.exception("event=rtv_notification_failed step=sms supplier_return_id=%s", supplier_return.id)
            return {"status": "failed", "error": str(exc)}
        status = "sent" if sent else "skipped"
        _apply_rtv_notification_status(supplier_return, sms=status, last_step="sms")
        logger.info("event=rtv_sms_%s supplier_return_id=%s to=%s", status, supplier_return.id, phone)
        return {"status": status, "to": phone}

    return {"status": "failed", "error": f"Unsupported RTV notification channel: {channel}"}


def send_invoice_notification_channel(db: Session, invoice_id: int, *, channel: str) -> dict[str, object]:
    invoice = (
        db.query(Invoice)
        .options(selectinload(Invoice.order))
        .filter(Invoice.id == invoice_id)
        .first()
    )
    if not invoice:
        return {"status": "failed", "error": "Invoice not found"}
    recipient = _resolve_invoice_recipient(db, invoice)
    if not recipient:
        return {"status": "skipped", "reason": "No invoice recipient"}

    subject, body = _invoice_text(invoice, recipient)
    public_url = public_invoice_pdf_url(invoice.id, invoice.business_profile_id)
    if channel == "email":
        if not recipient.email:
            return {"status": "skipped", "reason": "Recipient email is missing"}
        try:
            attachment = (
                f"{invoice.invoice_number or invoice.id}.pdf",
                document_service.invoice_pdf(db, invoice),
                "application/pdf",
            )
            business = db.get(BusinessProfile, invoice.business_profile_id) if invoice.business_profile_id else None
            business_name = (business.trade_name or business.legal_name) if business else "ERP"
            html_body = _invoice_html(
                invoice,
                recipient,
                business_name=business_name,
                public_url=public_url,
            )
            sent = _send_email(recipient.email, subject, body, attachment=attachment, html_body=html_body)
        except Exception as exc:
            logger.exception("event=invoice_notification_failed step=email invoice_id=%s", invoice.id)
            return {"status": "failed", "error": str(exc)}
        status = "sent" if sent else "skipped"
        logger.info("event=invoice_email_%s invoice_id=%s to=%s", status, invoice.id, recipient.email)
        return {"status": status, "to": recipient.email, "attachment": "pdf"}

    if channel == "sms":
        phone = _normalize_india_phone(recipient.phone)
        if not phone:
            return {"status": "skipped", "reason": "Recipient phone is missing or invalid"}
        try:
            business = db.get(BusinessProfile, invoice.business_profile_id) if invoice.business_profile_id else None
            business_name = (business.trade_name or business.legal_name) if business else "ERP"
            sms_body = (
                f"Hello {recipient.name},\n\n"
                f"Thank you for choosing {business_name}.\n\n"
                f"Invoice: {invoice.invoice_number or invoice.id}\n"
                f"Amount: {_money(invoice_total(invoice))}\n"
                f"Due date: {invoice.due_date}\n\n"
                f"View invoice PDF:\n{public_url}\n\n"
                "Thank you."
            )
            sent = _send_sms(phone, sms_body)
        except Exception as exc:
            logger.exception("event=invoice_notification_failed step=sms invoice_id=%s", invoice.id)
            return {"status": "failed", "error": str(exc)}
        status = "sent" if sent else "skipped"
        logger.info("event=invoice_sms_%s invoice_id=%s to=%s", status, invoice.id, phone)
        return {"status": status, "to": phone}

    return {"status": "failed", "error": f"Unsupported invoice notification channel: {channel}"}


def send_order_notification_channel(db: Session, order_id: int, *, channel: str) -> dict[str, object]:
    order = db.get(Order, order_id)
    if not order:
        return {"status": "failed", "error": "Order not found"}
    recipient = _resolve_order_recipient(db, order)
    if not recipient:
        return {"status": "skipped", "reason": "No order recipient"}
    if channel != "email":
        return {"status": "skipped", "reason": "Order notifications are email-only"}
    if not recipient.email:
        return {"status": "skipped", "reason": "Recipient email is missing"}

    subject, body = _order_received_text(order, recipient)
    try:
        sent = _send_email(recipient.email, subject, body)
    except Exception as exc:
        logger.exception("event=order_notification_failed step=email order_id=%s", order.id)
        return {"status": "failed", "error": str(exc)}
    status = "sent" if sent else "skipped"
    logger.info("event=order_email_%s order_id=%s to=%s", status, order.id, recipient.email)
    return {"status": status, "to": recipient.email}
