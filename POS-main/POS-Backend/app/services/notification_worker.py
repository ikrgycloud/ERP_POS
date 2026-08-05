"""Background worker for transactional notification outbox."""
import asyncio
import logging
from contextlib import suppress

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.services.notifications import NotificationProcessor

logger = logging.getLogger("pos_api.notifications")


class NotificationWorker:
    def __init__(self):
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    def start(self) -> None:
        summary = settings.notification_config_summary()
        logger.info(
            "event=notification_configuration sms_enabled=%s whatsapp_enabled=%s worker_enabled=%s "
            "twilio_sms_configured=%s twilio_whatsapp_configured=%s twilio_account_sid=%s "
            "twilio_phone_number=%s twilio_whatsapp_number=%s invoice_public_base_url=%s "
            "configuration_errors=%s",
            summary["sms_enabled"],
            summary["whatsapp_enabled"],
            summary["worker_enabled"],
            summary["twilio_sms_configured"],
            summary["twilio_whatsapp_configured"],
            summary["twilio_account_sid"],
            summary["twilio_phone_number"],
            summary["twilio_whatsapp_number"],
            summary["invoice_public_base_url"],
            summary["configuration_errors"],
        )
        if not settings.NOTIFICATION_WORKER_ENABLED:
            logger.info("event=notification_worker_disabled")
            return
        if self._task and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="notification-worker")
        logger.info("event=notification_worker_started")

    @property
    def is_running(self) -> bool:
        return bool(self._task and not self._task.done())

    async def stop(self) -> None:
        if not self._task:
            return
        self._stop.set()
        self._task.cancel()
        with suppress(asyncio.CancelledError):
            await self._task
        logger.info("event=notification_worker_stopped")

    async def _run(self) -> None:
        while not self._stop.is_set():
            try:
                await self.run_once()
            except Exception:
                logger.exception("event=notification_worker_cycle_failed")
            try:
                await asyncio.wait_for(
                    self._stop.wait(),
                    timeout=settings.NOTIFICATION_WORKER_INTERVAL_SECONDS,
                )
            except asyncio.TimeoutError:
                pass

    async def run_once(self) -> int:
        processed = 0
        async with AsyncSessionLocal() as db:
            processor = NotificationProcessor(db)
            outbox_ids = await processor.claim_due_outbox()
            if outbox_ids:
                logger.info("event=notification_worker_cycle claimed=%s", len(outbox_ids))
            else:
                logger.debug("event=notification_worker_cycle claimed=0")
            for outbox_id in outbox_ids:
                try:
                    logger.info("event=notification_worker_processing outbox_id=%s", outbox_id)
                    if await processor.process(outbox_id):
                        processed += 1
                except Exception:
                    await db.rollback()
                    logger.exception("event=notification_outbox_process_failed id=%s", outbox_id)
        if processed:
            logger.info("event=notification_worker_cycle_completed processed=%s", processed)
        else:
            logger.debug("event=notification_worker_cycle_completed processed=0")
        return processed


notification_worker = NotificationWorker()
