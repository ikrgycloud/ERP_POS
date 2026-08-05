from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.models.org import BusinessProfile
from app.models.sales import (
    Customer,
    Invoice,
    InvoiceNotification,
    InvoicePublicLink,
    NotificationHistory,
    NotificationOutbox,
)
from app.services.invoice_links import InvoiceLinkService
from app.services.notifications import (
    CHANNEL_EMAIL,
    CHANNEL_SMS,
    CHANNEL_WHATSAPP,
    STATUS_FAILED,
    STATUS_PROCESSING,
    STATUS_QUEUED,
    STATUS_SENT,
    NotificationProcessor,
)
from app.services.twilio_provider import SendResult


class FakeProvider:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    async def send(self, to: str, body: str) -> SendResult:
        self.calls.append({"to": to, "body": body})
        outcome = self.outcomes.pop(0)
        if outcome.startswith("error:"):
            return SendResult(error=outcome.removeprefix("error:"))
        return SendResult(sid=outcome)


class FakeEmailProvider:
    configured = True

    def __init__(self, outcomes=None):
        self.outcomes = list(outcomes or ["sent"])
        self.calls = []

    async def send(self, **kwargs) -> SendResult:
        self.calls.append(kwargs)
        outcome = self.outcomes.pop(0)
        if outcome.startswith("error:"):
            return SendResult(error=outcome.removeprefix("error:"))
        return SendResult(sid=None)


async def seed_notification(session_factory, channel=CHANNEL_SMS):
    async with session_factory() as db:
        business = (await db.execute(select(BusinessProfile))).scalars().first()
        customer = Customer(
            outlet_id=1,
            phone="9876543210",
            name="SMS Customer",
        )
        db.add(customer)
        await db.flush()
        invoice = Invoice(
            business_profile_id=business.id,
            invoice_number=f"INV-NOTIF-{datetime.now(timezone.utc).timestamp()}",
            invoice_type="sale",
            invoice_direction="outlet_to_customer",
            outlet_id=1,
            customer_id=customer.id,
            staff_id=3,
            is_reverse=False,
            party_type="customer",
            party_name=customer.name,
            date=date.today(),
            due_date=date.today(),
            taxable_value=Decimal("100.00"),
            cgst=Decimal("2.50"),
            sgst=Decimal("2.50"),
            igst=Decimal("0.00"),
            status="Paid",
            payment_method="cash",
        )
        db.add(invoice)
        await db.flush()
        notification = InvoiceNotification(
            invoice_id=invoice.id,
            customer_id=customer.id,
            business_profile_id=business.id,
            outlet_id=1,
            channel=channel,
            phone="+919876543210",
            status=STATUS_QUEUED,
        )
        db.add(notification)
        await db.flush()
        outbox = NotificationOutbox(
            notification_id=notification.id,
            invoice_id=invoice.id,
            customer_id=customer.id,
            business_profile_id=business.id,
            outlet_id=1,
            channel=channel,
            phone="+919876543210",
            status=STATUS_QUEUED,
            next_attempt_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        )
        db.add(outbox)
        await db.commit()
        return invoice.id, notification.id, outbox.id


async def seed_email_notification(session_factory):
    async with session_factory() as db:
        business = (await db.execute(select(BusinessProfile))).scalars().first()
        customer = Customer(
            outlet_id=1,
            phone="9876543210",
            email="customer@example.com",
            name="Email Customer",
        )
        db.add(customer)
        await db.flush()
        invoice = Invoice(
            business_profile_id=business.id,
            invoice_number=f"INV-EMAIL-{datetime.now(timezone.utc).timestamp()}",
            invoice_type="sale",
            invoice_direction="outlet_to_customer",
            outlet_id=1,
            customer_id=customer.id,
            staff_id=3,
            is_reverse=False,
            party_type="customer",
            party_name=customer.name,
            date=date.today(),
            due_date=date.today(),
            taxable_value=Decimal("100.00"),
            cgst=Decimal("2.50"),
            sgst=Decimal("2.50"),
            igst=Decimal("0.00"),
            status="Paid",
            payment_method="cash",
        )
        db.add(invoice)
        await db.flush()
        notification = InvoiceNotification(
            invoice_id=invoice.id,
            customer_id=customer.id,
            business_profile_id=business.id,
            outlet_id=1,
            channel=CHANNEL_EMAIL,
            phone=customer.email,
            status=STATUS_QUEUED,
        )
        db.add(notification)
        await db.flush()
        outbox = NotificationOutbox(
            notification_id=notification.id,
            invoice_id=invoice.id,
            customer_id=customer.id,
            business_profile_id=business.id,
            outlet_id=1,
            channel=CHANNEL_EMAIL,
            phone=customer.email,
            status=STATUS_QUEUED,
            next_attempt_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        )
        db.add(outbox)
        await db.commit()
        return invoice.id, notification.id, outbox.id


async def link_count(db, invoice_id):
    return (
        await db.execute(
            select(func.count(InvoicePublicLink.id)).where(
                InvoicePublicLink.invoice_id == invoice_id,
                InvoicePublicLink.revoked_at.is_(None),
                InvoicePublicLink.expires_at > datetime.now(timezone.utc),
            )
        )
    ).scalar_one()


async def history_rows(db, outbox_id):
    return (
        await db.execute(
            select(NotificationHistory)
            .where(NotificationHistory.outbox_id == outbox_id)
            .order_by(NotificationHistory.id)
        )
    ).scalars().all()


@pytest.mark.asyncio
async def test_successful_notification_persists_sid_and_reuses_one_link(seeded):
    invoice_id, notification_id, outbox_id = await seed_notification(seeded)
    provider = FakeProvider(["SM-test-success"])

    async with seeded() as db:
        processor = NotificationProcessor(db, sms_provider=provider)
        assert await processor.claim_due_outbox() == [outbox_id]
        assert await processor.process(outbox_id) is True

    async with seeded() as db:
        notification = await db.get(InvoiceNotification, notification_id)
        outbox = await db.get(NotificationOutbox, outbox_id)
        assert notification.status == STATUS_SENT
        assert notification.twilio_sid == "SM-test-success"
        assert notification.attempts == 1
        assert notification.error_message is None
        assert notification.sent_at is not None
        assert outbox.status == STATUS_SENT
        assert outbox.attempts == 1
        assert outbox.processed_at is not None
        histories = await history_rows(db, outbox_id)
        assert len(histories) == 1
        assert histories[0].status == STATUS_SENT
        assert histories[0].channel == CHANNEL_SMS
        assert histories[0].attempt == 1
        assert histories[0].provider_response["sid"] == "SM-test-success"
        assert await link_count(db, invoice_id) == 1
    assert len(provider.calls) == 1


@pytest.mark.asyncio
async def test_pos_worker_does_not_claim_erp_invoice_generated_rows(seeded):
    invoice_id, _, outbox_id = await seed_notification(seeded)

    async with seeded() as db:
        erp_row = NotificationOutbox(
            notification_id=None,
            invoice_id=invoice_id,
            business_profile_id=1,
            channel=CHANNEL_EMAIL,
            status=STATUS_QUEUED,
            event_type="invoice.generated",
            aggregate_type="invoice",
            aggregate_id=str(invoice_id),
            payload={
                "invoiceId": invoice_id,
                "invoiceNumber": "INV-ERP-ROW",
                "channels": [CHANNEL_EMAIL, CHANNEL_SMS],
            },
            next_attempt_at=datetime.now(timezone.utc) - timedelta(seconds=1),
        )
        db.add(erp_row)
        await db.commit()
        erp_outbox_id = erp_row.id

    async with seeded() as db:
        processor = NotificationProcessor(db)
        assert await processor.claim_due_outbox(limit=10) == [outbox_id]

    async with seeded() as db:
        pos_row = await db.get(NotificationOutbox, outbox_id)
        erp_row = await db.get(NotificationOutbox, erp_outbox_id)
        assert pos_row.status == STATUS_PROCESSING
        assert erp_row.status == STATUS_QUEUED


@pytest.mark.asyncio
async def test_invoice_link_expiry_uses_configured_hours_and_utc(seeded, monkeypatch):
    monkeypatch.setattr(settings, "INVOICE_LINK_EXPIRY_HOURS", 24)
    invoice_id, _, _ = await seed_notification(seeded)

    async with seeded() as db:
        invoice = await db.get(Invoice, invoice_id)
        before = datetime.now(timezone.utc)
        link, _ = await InvoiceLinkService(db).create_link(invoice)
        after = datetime.now(timezone.utc)

    expires_at = link.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    assert before + timedelta(hours=24) <= expires_at <= after + timedelta(hours=24)
    assert expires_at.tzinfo is not None


@pytest.mark.asyncio
async def test_sms_notification_uses_configured_public_invoice_url(seeded, monkeypatch):
    monkeypatch.setattr(settings, "INVOICE_PUBLIC_BASE_URL", "https://pos.example.com")
    invoice_id, _, outbox_id = await seed_notification(seeded)
    provider = FakeProvider(["SM-test-success"])

    async with seeded() as db:
        processor = NotificationProcessor(db, sms_provider=provider)
        assert await processor.claim_due_outbox() == [outbox_id]
        assert await processor.process(outbox_id) is True

    assert len(provider.calls) == 1
    assert "https://pos.example.com/invoice/view/" in provider.calls[0]["body"]

    async with seeded() as db:
        assert await link_count(db, invoice_id) == 1


@pytest.mark.asyncio
async def test_whatsapp_notification_uses_configured_public_invoice_url(seeded, monkeypatch):
    monkeypatch.setattr(settings, "INVOICE_PUBLIC_BASE_URL", "https://pos.example.com")
    _, _, outbox_id = await seed_notification(seeded, channel=CHANNEL_WHATSAPP)
    provider = FakeProvider(["SM-whatsapp-success"])

    async with seeded() as db:
        processor = NotificationProcessor(db, whatsapp_provider=provider)
        assert await processor.claim_due_outbox() == [outbox_id]
        assert await processor.process(outbox_id) is True

    assert len(provider.calls) == 1
    assert "https://pos.example.com/invoice/view/" in provider.calls[0]["body"]


@pytest.mark.asyncio
async def test_successful_email_notification_marks_sent_and_attaches_invoice_context(seeded):
    invoice_id, notification_id, outbox_id = await seed_email_notification(seeded)
    provider = FakeEmailProvider()

    async with seeded() as db:
        processor = NotificationProcessor(db, email_provider=provider)
        assert await processor.claim_due_outbox() == [outbox_id]
        assert await processor.process(outbox_id) is True

    async with seeded() as db:
        notification = await db.get(InvoiceNotification, notification_id)
        outbox = await db.get(NotificationOutbox, outbox_id)
        assert notification.status == STATUS_SENT
        assert notification.attempts == 1
        assert notification.sent_at is not None
        assert outbox.status == STATUS_SENT
        assert outbox.processed_at is not None
        histories = await history_rows(db, outbox_id)
        assert len(histories) == 1
        assert histories[0].status == STATUS_SENT
        assert histories[0].channel == CHANNEL_EMAIL
        assert histories[0].attempt == 1
        assert await link_count(db, invoice_id) == 1
    assert len(provider.calls) == 1
    assert provider.calls[0]["customer"].email == "customer@example.com"
    assert provider.calls[0]["public_url"]


@pytest.mark.asyncio
async def test_twilio_failure_persists_error_and_terminal_failure(seeded, monkeypatch):
    monkeypatch.setattr(settings, "NOTIFICATION_RETRY_COUNT", 1)
    _, notification_id, outbox_id = await seed_notification(seeded)
    provider = FakeProvider(["error:auth failed"])

    async with seeded() as db:
        processor = NotificationProcessor(db, sms_provider=provider)
        await processor.claim_due_outbox()
        assert await processor.process(outbox_id) is True

    async with seeded() as db:
        notification = await db.get(InvoiceNotification, notification_id)
        outbox = await db.get(NotificationOutbox, outbox_id)
        assert notification.status == STATUS_FAILED
        assert notification.error_message == "auth failed"
        assert notification.attempts == 1
        assert notification.failed_at is not None
        assert outbox.status == STATUS_FAILED
        assert outbox.last_error == "auth failed"
        assert outbox.attempts == 1
        histories = await history_rows(db, outbox_id)
        assert len(histories) == 1
        assert histories[0].status == STATUS_FAILED
        assert histories[0].error_message == "auth failed"
        assert histories[0].attempt == 1


@pytest.mark.asyncio
async def test_retry_reuses_link_and_sends_once_after_success(seeded, monkeypatch):
    monkeypatch.setattr(settings, "NOTIFICATION_RETRY_COUNT", 2)
    invoice_id, notification_id, outbox_id = await seed_notification(seeded)
    provider = FakeProvider(["error:timeout", "SM-after-retry"])

    async with seeded() as db:
        processor = NotificationProcessor(db, sms_provider=provider)
        await processor.claim_due_outbox()
        assert await processor.process(outbox_id) is True

    async with seeded() as db:
        outbox = await db.get(NotificationOutbox, outbox_id)
        outbox.next_attempt_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await db.commit()

    async with seeded() as db:
        processor = NotificationProcessor(db, sms_provider=provider)
        assert await processor.claim_due_outbox() == [outbox_id]
        assert await processor.process(outbox_id) is True

    async with seeded() as db:
        notification = await db.get(InvoiceNotification, notification_id)
        outbox = await db.get(NotificationOutbox, outbox_id)
        assert notification.status == STATUS_SENT
        assert notification.twilio_sid == "SM-after-retry"
        assert notification.attempts == 2
        assert outbox.status == STATUS_SENT
        assert outbox.attempts == 2
        histories = await history_rows(db, outbox_id)
        assert [row.status for row in histories] == ["retry_scheduled", STATUS_SENT]
        assert [row.attempt for row in histories] == [1, 2]
        assert await link_count(db, invoice_id) == 1
    assert len(provider.calls) == 2


@pytest.mark.asyncio
async def test_stale_processing_row_is_claimed_after_worker_restart(seeded, monkeypatch):
    monkeypatch.setattr(settings, "NOTIFICATION_RETRY_DELAY_SECONDS", 1)
    _, _, outbox_id = await seed_notification(seeded)

    async with seeded() as db:
        processor = NotificationProcessor(db)
        assert await processor.claim_due_outbox() == [outbox_id]

    async with seeded() as db:
        outbox = await db.get(NotificationOutbox, outbox_id)
        assert outbox.status == STATUS_PROCESSING
        outbox.updated_at = datetime.now(timezone.utc) - timedelta(seconds=10)
        await db.commit()

    async with seeded() as db:
        processor = NotificationProcessor(db)
        assert await processor.claim_due_outbox() == [outbox_id]


@pytest.mark.asyncio
async def test_duplicate_process_does_not_send_again(seeded):
    _, _, outbox_id = await seed_notification(seeded)
    provider = FakeProvider(["SM-once"])

    async with seeded() as db:
        processor = NotificationProcessor(db, sms_provider=provider)
        await processor.claim_due_outbox()
        assert await processor.process(outbox_id) is True
        assert await processor.process(outbox_id) is False

    assert len(provider.calls) == 1


@pytest.mark.asyncio
async def test_expired_link_regenerates_new_active_link(seeded):
    invoice_id, _, outbox_id = await seed_notification(seeded)

    async with seeded() as db:
        invoice = await db.get(Invoice, invoice_id)
        link, _ = await InvoiceLinkService(db).create_link(invoice)
        link.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await db.commit()

    provider = FakeProvider(["SM-new-link"])
    async with seeded() as db:
        processor = NotificationProcessor(db, sms_provider=provider)
        await processor.claim_due_outbox()
        assert await processor.process(outbox_id) is True

    async with seeded() as db:
        assert await link_count(db, invoice_id) == 1
