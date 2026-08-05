"""Async database engine, session factory, and declarative base."""
from datetime import datetime
from typing import AsyncGenerator

import time

from sqlalchemy import DateTime, event, func
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.config import settings
from app.core.profiling import begin_query, current_profile, end_query


def _engine_kwargs() -> dict:
    """Pooling options are dialect-specific.

    SQLite (used in tests / local dev) is driven through NullPool, which
    rejects pool_size / max_overflow. Only pass them for real pooled
    backends such as Postgres.
    """
    kwargs: dict = {"echo": settings.DB_ECHO or settings.LOG_SQL}
    if not settings.DATABASE_URL.startswith("sqlite"):
        kwargs.update(
            pool_size=settings.DB_POOL_SIZE,
            max_overflow=settings.DB_MAX_OVERFLOW,
            pool_pre_ping=True,
        )
    return kwargs


engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs())


@event.listens_for(engine.sync_engine, "before_cursor_execute")
def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    begin_query()


@event.listens_for(engine.sync_engine, "after_cursor_execute")
def _after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    end_query(statement)

AsyncSessionLocal = async_sessionmaker(
    bind=engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
)


class Base(DeclarativeBase):
    """Declarative base with created_at / updated_at mixed in per-model."""


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding a session with commit/rollback handling."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            start = time.perf_counter()
            await session.commit()
            profile = current_profile()
            if profile is not None:
                profile.db_commit_ms += (time.perf_counter() - start) * 1000
        except Exception:
            start = time.perf_counter()
            await session.rollback()
            profile = current_profile()
            if profile is not None:
                profile.db_rollback_ms += (time.perf_counter() - start) * 1000
            raise
        finally:
            await session.close()
