"""Background cleanup for abandoned POS draft carts."""
import asyncio
import logging
from contextlib import suppress
from datetime import datetime

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.models.sales import Order
from app.repositories.repos import OrderRepository

logger = logging.getLogger("pos_api.cart_cleanup")


class CartCleanupWorker:
    def __init__(self):
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    def start(self) -> None:
        if not settings.CART_CLEANUP_WORKER_ENABLED:
            logger.info("event=cart_cleanup_worker_disabled")
            return
        if self._task and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="cart-cleanup-worker")
        logger.info("event=cart_cleanup_worker_started")

    async def stop(self) -> None:
        if not self._task:
            return
        self._stop.set()
        self._task.cancel()
        with suppress(asyncio.CancelledError):
            await self._task
        logger.info("event=cart_cleanup_worker_stopped")

    async def _run(self) -> None:
        while not self._stop.is_set():
            try:
                await self.run_once()
            except Exception:
                logger.exception("event=cart_cleanup_worker_cycle_failed")
            try:
                await asyncio.wait_for(
                    self._stop.wait(),
                    timeout=settings.CART_CLEANUP_WORKER_INTERVAL_SECONDS,
                )
            except asyncio.TimeoutError:
                pass

    async def run_once(self) -> int:
        async with AsyncSessionLocal() as db:
            repo = OrderRepository(db)
            expired: list[Order] = list(
                await repo.expired_drafts(
                    datetime.utcnow(),
                    settings.CART_CLEANUP_BATCH_SIZE,
                    for_update=True,
                )
            )
            for order in expired:
                order.status = "Expired"
            if expired:
                await db.commit()
            logger.info("event=cart_cleanup_worker_cycle_completed expired=%s", len(expired))
            return len(expired)


cart_cleanup_worker = CartCleanupWorker()
