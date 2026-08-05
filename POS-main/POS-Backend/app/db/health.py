"""Database health checks."""
import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.config import settings


async def check_database(engine: AsyncEngine) -> bool:
    try:
        async def _check() -> None:
            async with engine.connect() as connection:
                await connection.execute(text("SELECT 1"))

        await asyncio.wait_for(_check(), timeout=settings.DB_HEALTH_TIMEOUT_SECONDS)
        return True
    except (Exception, asyncio.TimeoutError):
        return False
