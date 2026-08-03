import os
from pathlib import Path
import sys
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.api.invoices import queue_invoice_notification  # noqa: E402
from app.models import Invoice, NotificationHistory, NotificationOutbox, SupplierReturn  # noqa: E402
from app.notification_outbox import (  # noqa: E402
    CHANNEL_EMAIL,
    CHANNEL_EVENT,
    CHANNEL_SMS,
    EVENT_RTV_DISPATCHED,
    EVENT_INVOICE_GENERATED,
    EVENT_RTV_CREATED,
    STATUS_DEAD_LETTER,
    STATUS_PROCESSING,
    STATUS_QUEUED,
    STATUS_RETRY_SCHEDULED,
    STATUS_SENT,
    STATUS_SKIPPED,
    NotificationOutboxProcessor,
    enqueue_invoice_notification,
    enqueue_supplier_return_notification,
)


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    with SessionLocal() as db:
        yield db


def _supplier_return() -> SupplierReturn:
    return SupplierReturn(
        id=10,
        business_profile_id=1,
        supplier_id=20,
        rtv_number="RTV-1-00001",
        reason="Damaged product",
    )


def test_enqueue_supplier_return_notification_is_idempotent(db_session):
    supplier_return = _supplier_return()
    db_session.add(supplier_return)
    db_session.flush()

    first = enqueue_supplier_return_notification(db_session, supplier_return)
    second = enqueue_supplier_return_notification(db_session, supplier_return)
    db_session.commit()

    rows = db_session.execute(select(NotificationOutbox)).scalars().all()
    assert len(rows) == 1
    assert first.id == second.id
    assert rows[0].event_type == EVENT_RTV_CREATED
    assert rows[0].channel == CHANNEL_EVENT
    assert rows[0].aggregate_id == str(supplier_return.id)
    assert rows[0].payload["rtvNumber"] == supplier_return.rtv_number


def test_notification_processor_fans_out_rtv_channels_and_records_history(db_session, monkeypatch):
    supplier_return = _supplier_return()
    db_session.add(supplier_return)
    db_session.flush()
    outbox = enqueue_supplier_return_notification(db_session, supplier_return)
    db_session.commit()

    calls = []

    def fake_send(db, supplier_return_id: int, *, channel: str, dispatched: bool = False) -> dict[str, object]:
        calls.append((supplier_return_id, channel, dispatched))
        return {"status": STATUS_SENT, "channel": channel}

    monkeypatch.setattr("app.notification_outbox.send_supplier_return_notification_channel", fake_send)
    processor = NotificationOutboxProcessor(db_session)

    claimed = processor.claim_due()
    assert claimed == [outbox.id]
    assert db_session.get(NotificationOutbox, outbox.id).status == STATUS_PROCESSING

    assert processor.process(outbox.id) is True

    parent = db_session.get(NotificationOutbox, outbox.id)
    children = (
        db_session.execute(
            select(NotificationOutbox)
            .where(NotificationOutbox.parent_outbox_id == parent.id)
            .order_by(NotificationOutbox.channel)
        )
        .scalars()
        .all()
    )
    assert parent.status == STATUS_SENT
    assert parent.attempts == 1
    assert [child.channel for child in children] == [CHANNEL_EMAIL, CHANNEL_SMS]

    child_ids = processor.claim_due()
    assert child_ids == [child.id for child in children]
    for child_id in child_ids:
        assert processor.process(child_id) is True

    histories = db_session.execute(select(NotificationHistory).order_by(NotificationHistory.id)).scalars().all()
    assert calls == [
        (supplier_return.id, CHANNEL_EMAIL, False),
        (supplier_return.id, CHANNEL_SMS, False),
    ]
    assert [row.status for row in histories] == [STATUS_SENT, STATUS_SENT, STATUS_SENT]
    assert [row.channel for row in histories] == [CHANNEL_EVENT, CHANNEL_EMAIL, CHANNEL_SMS]
    assert histories[-1].aggregate_id == str(supplier_return.id)


def test_dispatched_rtv_is_email_only(db_session, monkeypatch):
    supplier_return = _supplier_return()
    supplier_return.shipment_status = "shipped"
    db_session.add(supplier_return)
    db_session.flush()
    outbox = enqueue_supplier_return_notification(db_session, supplier_return, dispatched=True)
    db_session.commit()

    calls = []

    def fake_send(db, supplier_return_id: int, *, channel: str, dispatched: bool = False) -> dict[str, object]:
        calls.append((supplier_return_id, channel, dispatched))
        return {"status": STATUS_SENT, "channel": channel}

    monkeypatch.setattr("app.notification_outbox.send_supplier_return_notification_channel", fake_send)
    processor = NotificationOutboxProcessor(db_session)
    assert processor.process(processor.claim_due()[0]) is True

    children = db_session.execute(
        select(NotificationOutbox).where(NotificationOutbox.parent_outbox_id == outbox.id)
    ).scalars().all()
    assert outbox.event_type == EVENT_RTV_DISPATCHED
    assert [child.channel for child in children] == [CHANNEL_EMAIL]

    assert processor.process(processor.claim_due()[0]) is True
    assert calls == [(supplier_return.id, CHANNEL_EMAIL, True)]


def test_generated_invoice_fans_out_to_email_and_sms(db_session, monkeypatch):
    invoice = Invoice(
        id=30,
        business_profile_id=1,
        invoice_number="INV-30",
        invoice_type="Sale",
        invoice_direction="outlet_to_customer",
        party_type="B2C",
        party_name="Customer",
        date=date(2026, 7, 21),
        due_date=date(2026, 7, 28),
        taxable_value=Decimal("100"),
        cgst=Decimal("9"),
        sgst=Decimal("9"),
        igst=Decimal("0"),
    )
    db_session.add(invoice)
    db_session.flush()
    parent = enqueue_invoice_notification(db_session, invoice)
    db_session.commit()

    calls = []

    def fake_send(db, invoice_id: int, *, channel: str) -> dict[str, object]:
        calls.append((invoice_id, channel))
        return {"status": STATUS_SENT, "channel": channel}

    monkeypatch.setattr("app.notification_outbox.send_invoice_notification_channel", fake_send)
    processor = NotificationOutboxProcessor(db_session)
    assert processor.process(processor.claim_due()[0]) is True
    assert parent.event_type == EVENT_INVOICE_GENERATED

    child_ids = processor.claim_due()
    assert len(child_ids) == 2
    for child_id in child_ids:
        assert processor.process(child_id) is True
    assert calls == [(invoice.id, CHANNEL_EMAIL), (invoice.id, CHANNEL_SMS)]


def test_regenerated_invoice_queues_fresh_notification_attempt(db_session):
    invoice = Invoice(
        id=32,
        business_profile_id=1,
        invoice_number="INV-32",
        invoice_type="Sale",
        invoice_direction="outlet_to_customer",
        party_type="B2C",
        party_name="Customer",
        date=date(2026, 7, 21),
        due_date=date(2026, 7, 28),
        taxable_value=Decimal("100"),
        cgst=Decimal("9"),
        sgst=Decimal("9"),
        igst=Decimal("0"),
    )
    db_session.add(invoice)
    db_session.flush()

    queue_invoice_notification(db_session, invoice)
    queue_invoice_notification(db_session, invoice, force_new=True)
    db_session.commit()

    rows = db_session.execute(
        select(NotificationOutbox)
        .where(
            NotificationOutbox.event_type == EVENT_INVOICE_GENERATED,
            NotificationOutbox.aggregate_type == "invoice",
            NotificationOutbox.aggregate_id == str(invoice.id),
        )
        .order_by(NotificationOutbox.id)
    ).scalars().all()

    assert len(rows) == 2
    assert rows[0].idempotency_key == f"{EVENT_INVOICE_GENERATED}:invoice:{invoice.id}"
    assert rows[1].idempotency_key.startswith(f"{EVENT_INVOICE_GENERATED}:invoice:{invoice.id}:regenerate:")
    assert rows[1].payload["channels"] == [CHANNEL_EMAIL, CHANNEL_SMS]


def test_erp_worker_does_not_claim_pos_invoice_notification_rows(db_session):
    invoice = Invoice(
        id=31,
        business_profile_id=1,
        invoice_number="INV-31",
        invoice_type="Sale",
        invoice_direction="outlet_to_customer",
        party_type="B2C",
        party_name="Customer",
        date=date(2026, 7, 21),
        due_date=date(2026, 7, 28),
        taxable_value=Decimal("100"),
        cgst=Decimal("9"),
        sgst=Decimal("9"),
        igst=Decimal("0"),
    )
    db_session.add(invoice)
    db_session.flush()
    erp_row = enqueue_invoice_notification(db_session, invoice)
    pos_row = NotificationOutbox(
        idempotency_key="pos:invoice:31:sms",
        event_type="invoice_notification",
        aggregate_type="invoice",
        aggregate_id=str(invoice.id),
        business_profile_id=invoice.business_profile_id,
        channel=CHANNEL_SMS,
        payload={"invoice_id": invoice.id, "channel": CHANNEL_SMS},
        status=STATUS_QUEUED,
    )
    db_session.add(pos_row)
    db_session.commit()

    processor = NotificationOutboxProcessor(db_session)

    assert processor.claim_due(limit=10) == [erp_row.id]
    assert db_session.get(NotificationOutbox, erp_row.id).status == STATUS_PROCESSING
    assert db_session.get(NotificationOutbox, pos_row.id).status == STATUS_QUEUED


def test_notification_processor_marks_skipped_channel_without_retry(db_session, monkeypatch):
    supplier_return = _supplier_return()
    db_session.add(supplier_return)
    db_session.flush()
    outbox = enqueue_supplier_return_notification(db_session, supplier_return)
    db_session.commit()

    def fake_send(db, supplier_return_id: int, *, channel: str, dispatched: bool = False) -> dict[str, object]:
        return {"status": STATUS_SKIPPED, "reason": "No destination"}

    monkeypatch.setattr("app.notification_outbox.send_supplier_return_notification_channel", fake_send)
    processor = NotificationOutboxProcessor(db_session)
    assert processor.process(processor.claim_due()[0]) is True
    child_id = processor.claim_due()[0]
    assert processor.process(child_id) is True

    child = db_session.get(NotificationOutbox, child_id)
    assert child.status == STATUS_SKIPPED
    assert child.attempts == 1
    history = (
        db_session.execute(
            select(NotificationHistory)
            .where(NotificationHistory.outbox_id == child_id)
            .order_by(NotificationHistory.id.desc())
        )
        .scalars()
        .first()
    )
    assert history.status == STATUS_SKIPPED


def test_notification_processor_retries_failed_channel_with_backoff(db_session, monkeypatch):
    supplier_return = _supplier_return()
    db_session.add(supplier_return)
    db_session.flush()
    parent = enqueue_supplier_return_notification(db_session, supplier_return)
    db_session.commit()

    def fake_send(db, supplier_return_id: int, *, channel: str, dispatched: bool = False) -> dict[str, object]:
        return {"status": "failed", "error": "temporary provider outage", "provider": "fake"}

    monkeypatch.setattr("app.notification_outbox.send_supplier_return_notification_channel", fake_send)
    processor = NotificationOutboxProcessor(db_session)
    assert processor.process(processor.claim_due()[0]) is True
    child_id = processor.claim_due()[0]
    assert processor.process(child_id) is True

    child = db_session.get(NotificationOutbox, child_id)
    assert child.status == "queued"
    assert child.attempts == 1
    assert child.next_attempt_at is not None
    assert child.locked_at is None
    assert child.lock_owner is None
    history = (
        db_session.execute(
            select(NotificationHistory)
            .where(NotificationHistory.outbox_id == child_id)
            .order_by(NotificationHistory.id.desc())
        )
        .scalars()
        .first()
    )
    assert history.status == STATUS_RETRY_SCHEDULED
    assert history.provider == child.channel
    assert history.correlation_id
    assert history.duration_ms is not None
    assert history.request_payload["parentOutboxId"] == parent.id


def test_notification_processor_dead_letters_after_max_retries(db_session, monkeypatch):
    supplier_return = _supplier_return()
    db_session.add(supplier_return)
    db_session.flush()
    enqueue_supplier_return_notification(db_session, supplier_return)
    db_session.commit()

    def fake_send(db, supplier_return_id: int, *, channel: str, dispatched: bool = False) -> dict[str, object]:
        return {"status": "failed", "error": "permanent provider failure", "provider": "fake"}

    monkeypatch.setattr("app.notification_outbox.send_supplier_return_notification_channel", fake_send)
    processor = NotificationOutboxProcessor(db_session)
    assert processor.process(processor.claim_due()[0]) is True
    child_id = processor.claim_due()[0]
    child = db_session.get(NotificationOutbox, child_id)
    child.max_attempts = 1
    db_session.commit()

    assert processor.process(child_id) is True

    child = db_session.get(NotificationOutbox, child_id)
    assert child.status == STATUS_DEAD_LETTER
    assert child.dead_lettered_at is not None
    assert child.next_attempt_at is None
    history = (
        db_session.execute(
            select(NotificationHistory)
            .where(NotificationHistory.outbox_id == child_id)
            .order_by(NotificationHistory.id.desc())
        )
        .scalars()
        .first()
    )
    assert history.status == STATUS_DEAD_LETTER
    assert history.error_message == "permanent provider failure"
