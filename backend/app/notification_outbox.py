import logging
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import inspect, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal
from app.models import Invoice, NotificationHistory, NotificationOutbox, Order, SupplierReturn
from app.notifications import (
    send_invoice_notification_channel,
    send_order_notification_channel,
    send_supplier_return_notification_channel,
)

logger = logging.getLogger("erp-backend")

STATUS_QUEUED = "queued"
STATUS_PROCESSING = "processing"
STATUS_SENT = "sent"
STATUS_FAILED = "failed"
STATUS_SKIPPED = "skipped"
STATUS_RETRY_SCHEDULED = "retry_scheduled"
STATUS_DEAD_LETTER = "dead_letter"
STATUS_DISABLED = "disabled"
STATUS_READY = "ready"
STATUS_NOT_READY = "not_ready"
STATUS_RUNNING = "running"
STATUS_STOPPED = "stopped"

EVENT_RTV_CREATED = "supplier_return.created"
EVENT_RTV_DISPATCHED = "supplier_return.dispatched"
EVENT_INVOICE_GENERATED = "invoice.generated"
EVENT_ORDER_RECEIVED = "order.received"

CHANNEL_EVENT = "event"
CHANNEL_EMAIL = "email"
CHANNEL_SMS = "sms"
CHANNEL_WHATSAPP = "whatsapp"
CHANNEL_PUSH = "push"

ERP_EVENT_TYPES = {
    EVENT_RTV_CREATED,
    EVENT_RTV_DISPATCHED,
    EVENT_INVOICE_GENERATED,
    EVENT_ORDER_RECEIVED,
}

REQUIRED_OUTBOX_COLUMNS = {
    "parent_outbox_id",
    "channel",
    "provider_response",
    "dead_lettered_at",
    "locked_at",
    "lock_owner",
    "sent_at",
}
REQUIRED_HISTORY_COLUMNS = {
    "channel",
    "attempt",
    "provider",
    "duration_ms",
    "correlation_id",
    "message_id",
    "request_payload",
    "provider_response",
    "completed_at",
}


def enqueue_notification(
    db: Session,
    *,
    event_type: str,
    aggregate_type: str,
    aggregate_id: str | int,
    business_profile_id: int | None,
    payload: dict[str, Any] | None = None,
    idempotency_key: str | None = None,
    channel: str = CHANNEL_EVENT,
    parent_outbox_id: int | None = None,
) -> NotificationOutbox:
    key = idempotency_key or f"{event_type}:{aggregate_type}:{aggregate_id}:{channel}"
    existing = db.execute(
        select(NotificationOutbox).where(NotificationOutbox.idempotency_key == key)
    ).scalar_one_or_none()
    if existing:
        logger.info(
            "event=notification_outbox_existing outbox_id=%s event_type=%s aggregate_type=%s aggregate_id=%s",
            existing.id,
            event_type,
            aggregate_type,
            aggregate_id,
        )
        return existing
    outbox = NotificationOutbox(
        parent_outbox_id=parent_outbox_id,
        idempotency_key=key,
        event_type=event_type,
        aggregate_type=aggregate_type,
        aggregate_id=str(aggregate_id),
        business_profile_id=business_profile_id,
        channel=channel,
        payload=payload or {},
        status=STATUS_QUEUED,
        next_attempt_at=datetime.now(timezone.utc),
    )
    try:
        with db.begin_nested():
            db.add(outbox)
            db.flush()
    except IntegrityError:
        outbox = db.execute(
            select(NotificationOutbox).where(NotificationOutbox.idempotency_key == key)
        ).scalar_one()
    logger.info(
        "event=notification_outbox_queued outbox_id=%s event_type=%s aggregate_type=%s aggregate_id=%s",
        outbox.id,
        event_type,
        aggregate_type,
        aggregate_id,
    )
    return outbox


def enqueue_supplier_return_notification(
    db: Session,
    supplier_return: SupplierReturn,
    *,
    dispatched: bool = False,
) -> NotificationOutbox:
    event_type = EVENT_RTV_DISPATCHED if dispatched else EVENT_RTV_CREATED
    # Creation is an acknowledgement over both channels. Dispatch is a
    # supplier-facing document event and intentionally remains email-only.
    channels = [CHANNEL_EMAIL] if dispatched else [CHANNEL_EMAIL, CHANNEL_SMS]
    return enqueue_notification(
        db,
        event_type=event_type,
        aggregate_type="supplier_return",
        aggregate_id=supplier_return.id,
        business_profile_id=supplier_return.business_profile_id,
        payload={
            "supplierReturnId": supplier_return.id,
            "rtvNumber": supplier_return.rtv_number,
            "dispatched": dispatched,
            "channels": channels,
        },
        idempotency_key=f"{event_type}:supplier_return:{supplier_return.id}",
    )


def enqueue_invoice_notification(db: Session, invoice: Invoice) -> NotificationOutbox:
    channels = [CHANNEL_EMAIL, CHANNEL_SMS] if str(invoice.party_type or "").upper() == "B2B" else [CHANNEL_EMAIL]
    return enqueue_notification(
        db,
        event_type=EVENT_INVOICE_GENERATED,
        aggregate_type="invoice",
        aggregate_id=invoice.id,
        business_profile_id=invoice.business_profile_id,
        payload={
            "invoiceId": invoice.id,
            "invoiceNumber": invoice.invoice_number,
            # Customer invoices are email-only; B2B recipients receive both
            # email and SMS for their document workflow.
            "channels": channels,
        },
        idempotency_key=f"{EVENT_INVOICE_GENERATED}:invoice:{invoice.id}",
    )


def enqueue_order_notification(db: Session, order: Order) -> NotificationOutbox:
    return enqueue_notification(
        db,
        event_type=EVENT_ORDER_RECEIVED,
        aggregate_type="order",
        aggregate_id=order.id,
        business_profile_id=order.business_profile_id,
        payload={
            "orderId": order.id,
            "orderNumber": order.order_number,
            "channels": [CHANNEL_EMAIL],
        },
        idempotency_key=f"{EVENT_ORDER_RECEIVED}:order:{order.id}",
    )


class NotificationOutboxProcessor:
    def __init__(self, db: Session, *, lock_owner: str | None = None):
        self.db = db
        self.lock_owner = lock_owner or f"erp-notification-worker:{uuid.uuid4()}"

    def claim_due(self, limit: int = 20) -> list[int]:
        if not self._schema_ready():
            self.db.rollback()
            return []
        now = datetime.now(timezone.utc)
        stale_before = now - timedelta(minutes=5)
        dialect_name = self.db.get_bind().dialect.name
        query = (
            select(NotificationOutbox)
            .where(
                NotificationOutbox.event_type.in_(ERP_EVENT_TYPES),
                or_(
                    (
                        (NotificationOutbox.status == STATUS_QUEUED)
                        & or_(
                            NotificationOutbox.next_attempt_at.is_(None),
                            NotificationOutbox.next_attempt_at <= now,
                        )
                    ),
                    (
                        (NotificationOutbox.status == STATUS_PROCESSING)
                        & (NotificationOutbox.updated_at <= stale_before)
                    ),
                )
            )
            .order_by(NotificationOutbox.created_at, NotificationOutbox.id)
            .limit(limit)
        )
        if dialect_name != "sqlite":
            query = query.with_for_update(skip_locked=True)
        rows = (
            self.db.execute(
                query
            )
            .scalars()
            .all()
        )
        ids: list[int] = []
        for row in rows:
            row.status = STATUS_PROCESSING
            row.last_error = None
            row.locked_at = now
            row.lock_owner = self.lock_owner
            ids.append(row.id)
        self.db.commit()
        if ids:
            logger.info("event=notification_outbox_claimed count=%s ids=%s", len(ids), ids)
        return ids

    def _schema_ready(self) -> bool:
        inspector = inspect(self.db.get_bind())
        table_names = set(inspector.get_table_names())
        columns_by_table = {
            table_name: {column["name"] for column in inspector.get_columns(table_name)}
            for table_name in ("notification_outbox", "notification_history")
            if table_name in table_names
        }
        missing_outbox = REQUIRED_OUTBOX_COLUMNS - columns_by_table.get("notification_outbox", set())
        missing_history = REQUIRED_HISTORY_COLUMNS - columns_by_table.get("notification_history", set())
        if missing_outbox or missing_history:
            logger.error(
                "event=notification_worker_schema_not_ready missing_outbox_columns=%s missing_history_columns=%s "
                "hint=run_erp_migrations",
                sorted(missing_outbox),
                sorted(missing_history),
            )
            return False
        return True

    def process(self, outbox_id: int) -> bool:
        outbox = self.db.get(NotificationOutbox, outbox_id)
        if not outbox or outbox.status != STATUS_PROCESSING:
            self.db.rollback()
            return False
        correlation_id = str(uuid.uuid4())
        logger.info(
            "event=notification_outbox_processing outbox_id=%s event_type=%s aggregate_type=%s aggregate_id=%s "
            "channel=%s correlation_id=%s",
            outbox.id,
            outbox.event_type,
            outbox.aggregate_type,
            outbox.aggregate_id,
            outbox.channel,
            correlation_id,
        )
        started_at = time.perf_counter()
        try:
            result = self._dispatch(outbox)
            if str(result.get("status") or "").lower() == STATUS_FAILED:
                raise RuntimeError(str(result.get("error") or "Notification channel failed"))
        except Exception as exc:
            self.db.rollback()
            self._mark_failed(outbox_id, exc, correlation_id=correlation_id, duration_ms=self._elapsed_ms(started_at))
            return True
        outbox = self.db.get(NotificationOutbox, outbox_id)
        if not outbox:
            self.db.rollback()
            return False
        outbox.attempts += 1
        result_status = str(result.get("status") or STATUS_SENT)
        outbox.status = STATUS_SKIPPED if result_status == STATUS_SKIPPED else STATUS_SENT
        outbox.processed_at = datetime.now(timezone.utc)
        outbox.sent_at = outbox.processed_at if outbox.status == STATUS_SENT else None
        outbox.provider_response = result
        outbox.locked_at = None
        outbox.lock_owner = None
        outbox.last_error = None
        try:
            self._record_history(
                self.db,
                outbox,
                outbox.status,
                correlation_id=correlation_id,
                duration_ms=self._elapsed_ms(started_at),
            )
            self.db.commit()
        except Exception as exc:
            # A database/audit error must not terminate the worker loop and
            # leave the notification locked in "processing" forever.
            self.db.rollback()
            self._mark_failed(outbox_id, exc, correlation_id=correlation_id, duration_ms=self._elapsed_ms(started_at))
            return True
        logger.info("event=notification_outbox_completed outbox_id=%s", outbox_id)
        return True

    def _dispatch(self, outbox: NotificationOutbox) -> dict[str, object]:
        if outbox.channel == CHANNEL_EVENT:
            return self._enqueue_channel_jobs(outbox)
        if outbox.aggregate_type == "supplier_return" and outbox.event_type in {EVENT_RTV_CREATED, EVENT_RTV_DISPATCHED}:
            return send_supplier_return_notification_channel(
                self.db,
                int(outbox.aggregate_id),
                channel=outbox.channel,
                dispatched=bool((outbox.payload or {}).get("dispatched")),
            )
        if outbox.aggregate_type == "invoice" and outbox.event_type == EVENT_INVOICE_GENERATED:
            return send_invoice_notification_channel(self.db, int(outbox.aggregate_id), channel=outbox.channel)
        if outbox.aggregate_type == "order" and outbox.event_type == EVENT_ORDER_RECEIVED:
            return send_order_notification_channel(self.db, int(outbox.aggregate_id), channel=outbox.channel)
        raise ValueError(f"Unsupported notification event: {outbox.event_type}")

    def _enqueue_channel_jobs(self, outbox: NotificationOutbox) -> dict[str, object]:
        payload = outbox.payload or {}
        channels = payload.get("channels") or []
        if not isinstance(channels, list):
            channels = []
        queued: list[str] = []
        for channel in channels:
            if channel not in {CHANNEL_EMAIL, CHANNEL_SMS, CHANNEL_WHATSAPP, CHANNEL_PUSH}:
                logger.info(
                    "event=notification_channel_skipped outbox_id=%s channel=%s reason=unsupported",
                    outbox.id,
                    channel,
                )
                continue
            child = enqueue_notification(
                self.db,
                event_type=outbox.event_type,
                aggregate_type=outbox.aggregate_type,
                aggregate_id=outbox.aggregate_id,
                business_profile_id=outbox.business_profile_id,
                payload={**payload, "parentOutboxId": outbox.id},
                channel=channel,
                parent_outbox_id=outbox.id,
                idempotency_key=f"{outbox.event_type}:{outbox.aggregate_type}:{outbox.aggregate_id}:{channel}",
            )
            queued.append(f"{channel}:{child.id}")
        logger.info(
            "event=notification_channels_queued outbox_id=%s channels=%s",
            outbox.id,
            queued,
        )
        return {"status": STATUS_SENT, "queuedChannels": queued}

    def _mark_failed(self, outbox_id: int, exc: Exception, *, correlation_id: str, duration_ms: int) -> None:
        outbox = self.db.get(NotificationOutbox, outbox_id)
        if not outbox:
            return
        outbox.attempts += 1
        outbox.last_error = str(exc)
        retry_delay = self._retry_delay_seconds(outbox.attempts)
        if retry_delay is None or outbox.attempts >= outbox.max_attempts:
            outbox.status = STATUS_DEAD_LETTER
            outbox.processed_at = datetime.now(timezone.utc)
            outbox.dead_lettered_at = outbox.processed_at
            outbox.next_attempt_at = None
            history_status = STATUS_DEAD_LETTER
        else:
            outbox.status = STATUS_QUEUED
            outbox.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=retry_delay)
            history_status = STATUS_RETRY_SCHEDULED
        outbox.locked_at = None
        outbox.lock_owner = None
        self._record_history(
            self.db,
            outbox,
            history_status,
            correlation_id=correlation_id,
            duration_ms=duration_ms,
        )
        self.db.commit()
        logger.exception(
            "event=notification_outbox_failed outbox_id=%s status=%s attempts=%s",
            outbox.id,
            outbox.status,
            outbox.attempts,
        )

    @staticmethod
    def _elapsed_ms(started_at: float) -> int:
        return int((time.perf_counter() - started_at) * 1000)

    @staticmethod
    def _retry_delay_seconds(attempt: int) -> int | None:
        schedule = get_settings().notification_retry_schedule
        if attempt <= 0:
            return schedule[0]
        index = attempt - 1
        if index >= len(schedule):
            return None
        return schedule[index]

    @staticmethod
    def _record_history(
        db: Session,
        outbox: NotificationOutbox,
        status: str,
        *,
        correlation_id: str,
        duration_ms: int,
    ) -> None:
        provider_response = outbox.provider_response or {}
        db.add(
            NotificationHistory(
                outbox_id=outbox.id,
                business_profile_id=outbox.business_profile_id,
                event_type=outbox.event_type,
                aggregate_type=outbox.aggregate_type,
                aggregate_id=outbox.aggregate_id,
                channel=outbox.channel,
                provider=str(provider_response.get("provider") or outbox.channel),
                status=status,
                attempt=outbox.attempts,
                duration_ms=duration_ms,
                correlation_id=correlation_id,
                message_id=provider_response.get("messageId") or provider_response.get("sid"),
                request_payload=outbox.payload or {},
                channel_summary=outbox.payload or {},
                provider_response=outbox.provider_response,
                error_message=outbox.last_error,
                completed_at=outbox.processed_at,
            )
        )


class NotificationWorker:
    def __init__(self) -> None:
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._status = STATUS_STOPPED
        self._schema_error_logged = False
        self._last_error: str | None = None
        self._last_processed_at: datetime | None = None
        self._worker_id = f"erp-notification-worker:{uuid.uuid4()}"

    def start(self) -> None:
        settings = get_settings()
        if not settings.notification_worker_enabled:
            self._status = STATUS_DISABLED
            logger.info("event=notification_worker_disabled worker_version=%s", settings.notification_worker_version)
            return
        readiness = self.readiness()
        logger.info(
            "event=notification_worker_startup worker_version=%s schema_version=%s migration_version=%s "
            "database_version=%s status=%s",
            readiness["workerVersion"],
            readiness["schemaVersion"],
            readiness["migrationVersion"],
            readiness["databaseVersion"],
            readiness["status"],
        )
        if readiness["status"] != STATUS_READY:
            self._status = STATUS_NOT_READY
            self._last_error = readiness.get("lastError")
            if not self._schema_error_logged:
                logger.error(
                    "event=notification_worker_not_ready status=%s missing=%s hint=run_erp_migrations",
                    readiness["status"],
                    readiness.get("missing"),
                )
                self._schema_error_logged = True
            return
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="erp-notification-worker", daemon=True)
        self._thread.start()
        self._status = STATUS_RUNNING
        logger.info("event=notification_worker_started")

    def stop(self) -> None:
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5)
        if self._status != STATUS_DISABLED:
            self._status = STATUS_STOPPED
        logger.info("event=notification_worker_stopped")

    def run_once(self) -> int:
        settings = get_settings()
        readiness = self.readiness()
        if readiness["status"] != STATUS_READY:
            self._status = STATUS_NOT_READY
            self._last_error = readiness.get("lastError")
            if not self._schema_error_logged:
                logger.error(
                    "event=notification_worker_schema_not_ready missing=%s hint=run_erp_migrations",
                    readiness.get("missing"),
                )
                self._schema_error_logged = True
            return 0
        processed = 0
        with SessionLocal() as db:
            processor = NotificationOutboxProcessor(db, lock_owner=self._worker_id)
            for outbox_id in processor.claim_due(limit=settings.notification_batch_size):
                with SessionLocal() as item_db:
                    if NotificationOutboxProcessor(item_db, lock_owner=self._worker_id).process(outbox_id):
                        processed += 1
        if processed:
            self._last_processed_at = datetime.now(timezone.utc)
            logger.info("event=notification_worker_cycle_completed processed=%s", processed)
        return processed

    def readiness(self) -> dict[str, object]:
        settings = get_settings()
        info: dict[str, object] = {
            "status": STATUS_DISABLED if not settings.notification_worker_enabled else STATUS_READY,
            "workerStatus": self._status,
            "workerVersion": settings.notification_worker_version,
            "schemaVersion": "017_notification_outbox_production_hardening",
            "migrationVersion": None,
            "databaseVersion": None,
            "lastError": self._last_error,
            "lastProcessedAt": self._last_processed_at.isoformat() if self._last_processed_at else None,
            "missing": {},
        }
        if not settings.notification_worker_enabled:
            return info
        try:
            with SessionLocal() as db:
                bind = db.get_bind()
                inspector = inspect(bind)
                table_names = set(inspector.get_table_names())
                try:
                    info["databaseVersion"] = db.execute(text("SELECT version()")).scalar()
                except Exception:
                    db.rollback()
                    info["databaseVersion"] = bind.dialect.name
                try:
                    info["migrationVersion"] = db.execute(
                        text("SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1")
                    ).scalar()
                except Exception:
                    db.rollback()
                    info["migrationVersion"] = None
                columns_by_table = {
                    table_name: {column["name"] for column in inspector.get_columns(table_name)}
                    for table_name in ("notification_outbox", "notification_history")
                    if table_name in table_names
                }
                missing_outbox = sorted(REQUIRED_OUTBOX_COLUMNS - columns_by_table.get("notification_outbox", set()))
                missing_history = sorted(REQUIRED_HISTORY_COLUMNS - columns_by_table.get("notification_history", set()))
                if missing_outbox or missing_history:
                    info["status"] = STATUS_NOT_READY
                    info["missing"] = {
                        "notification_outbox": missing_outbox,
                        "notification_history": missing_history,
                    }
                    info["lastError"] = "Notification schema is not migrated"
        except Exception as exc:
            info["status"] = STATUS_NOT_READY
            info["lastError"] = str(exc)
        return info

    def _run(self) -> None:
        settings = get_settings()
        interval = max(1, int(settings.background_worker_interval or 10))
        while not self._stop.is_set():
            try:
                self.run_once()
            except Exception:
                logger.exception("event=notification_worker_cycle_failed")
            self._stop.wait(interval)


notification_worker = NotificationWorker()
