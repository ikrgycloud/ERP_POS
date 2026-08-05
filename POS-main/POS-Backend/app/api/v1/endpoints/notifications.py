"""Invoice notification history, resend, analytics, and public invoice APIs."""
import time
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, require_roles
from app.core.config import settings
from app.core.exceptions import BusinessRuleError, ForbiddenError, NotFoundError
from app.core.roles import Role
from app.db.session import get_db
from app.models.sales import Invoice
from app.schemas.notifications import (
    InvoiceNotificationOut,
    NotificationAnalytics,
    NotificationHealth,
    NotificationResendRequest,
    NotificationTestRequest,
    NotificationTestResponse,
    PublicInvoiceOut,
)
from app.services.notification_worker import notification_worker
from app.services.invoice_links import InvoiceLinkService
from app.services.notifications import CHANNEL_SMS, CHANNEL_WHATSAPP, NotificationService, normalize_phone
from app.services.twilio_provider import TwilioSmsProvider, TwilioWhatsAppProvider

router = APIRouter(tags=["notifications"])
BM_SM = require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER)


async def _visible_invoice(db: AsyncSession, invoice_id: int, user: CurrentUser) -> Invoice:
    invoice = await db.get(Invoice, invoice_id)
    if not invoice or invoice.business_profile_id != user.business_profile_id:
        raise NotFoundError("Invoice not found")
    if user.role == Role.SALES_PERSON and (
        invoice.staff_id != user.id or invoice.outlet_id != user.outlet_id
    ):
        raise NotFoundError("Invoice not found")
    return invoice


@router.get("/invoices/{invoice_id}/notifications", response_model=list[InvoiceNotificationOut])
async def invoice_notifications(
    invoice_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    invoice = await _visible_invoice(db, invoice_id, user)
    return await NotificationService(db).list_for_invoice(invoice.id, user.business_profile_id)


@router.post("/invoices/{invoice_id}/notifications/resend", response_model=InvoiceNotificationOut)
async def resend_invoice_notification(
    invoice_id: int,
    payload: NotificationResendRequest,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    invoice = await _visible_invoice(db, invoice_id, user)
    _, token = await InvoiceLinkService(db).get_or_create_active_link(invoice)
    public_url = InvoiceLinkService.build_public_invoice_url(token)
    return await NotificationService(db).resend(
        invoice_id,
        user.business_profile_id,
        payload.channel,
        public_url=public_url,
    )


@router.get("/reports/notifications", response_model=NotificationAnalytics)
async def notification_analytics(
    user: CurrentUser = Depends(BM_SM),
    db: AsyncSession = Depends(get_db),
):
    return await NotificationService(db).analytics(user.business_profile_id)


@router.get("/notifications/health", response_model=NotificationHealth)
async def notification_health(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    health = await NotificationService(db).health(user.business_profile_id)
    return {
        "worker_running": notification_worker.is_running,
        "twilio_configured": bool(
            health["twilio_sms_configured"] or health["twilio_whatsapp_configured"]
        ),
        **health,
    }


@router.post("/notifications/test", response_model=NotificationTestResponse)
async def test_notification(
    payload: NotificationTestRequest,
    user: CurrentUser = Depends(get_current_user),
):
    if settings.is_production and user.role != Role.BRANCH_MANAGER:
        raise ForbiddenError("Only branch managers can send notification tests in production")
    channel = payload.channel.strip().lower()
    if channel not in {CHANNEL_SMS, CHANNEL_WHATSAPP}:
        raise BusinessRuleError("Unsupported notification channel")
    phone = normalize_phone(payload.phone)
    if not phone:
        raise BusinessRuleError("Phone number is missing or invalid")
    provider = TwilioSmsProvider() if channel == CHANNEL_SMS else TwilioWhatsAppProvider()
    started_at = time.perf_counter()
    result = await provider.send(phone, payload.message)
    elapsed_ms = Decimal(str(round((time.perf_counter() - started_at) * 1000, 2)))
    return NotificationTestResponse(
        ok=result.ok,
        channel=channel,
        phone=phone,
        sid=result.sid,
        error=result.error,
        http_status=result.http_status,
        twilio_code=result.twilio_code,
        response_body=result.response_body,
        elapsed_ms=elapsed_ms,
    )


@router.get("/public/invoices/{secure_token}", response_model=PublicInvoiceOut)
async def public_invoice(
    secure_token: str,
    db: AsyncSession = Depends(get_db),
):
    return await InvoiceLinkService(db).get_public_invoice(secure_token)
