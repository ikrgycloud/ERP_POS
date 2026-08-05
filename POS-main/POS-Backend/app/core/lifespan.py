"""FastAPI lifespan wiring."""
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from app.core.config import settings
from app.db.init import DatabaseInitializer
from app.db.session import engine
from app.services.cart_cleanup_worker import cart_cleanup_worker
from app.services.notification_worker import notification_worker


def create_lifespan(database_initializer: DatabaseInitializer | None = None):
    initializer = database_initializer or DatabaseInitializer(
        engine,
        settings.DATABASE_URL,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await initializer.initialize()
        cart_cleanup_worker.start()
        notification_worker.start()
        try:
            yield
        finally:
            await notification_worker.stop()
            await cart_cleanup_worker.stop()
            await initializer.shutdown()

    return lifespan
