"""Cross-cutting services: audit logging and sequence numbers."""
import asyncio
import json
import zlib
from functools import wraps
from typing import Any

from sqlalchemy.exc import DBAPIError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sales import AuditLog, DocumentSequence


def is_deadlock_error(exc: BaseException) -> bool:
    original = getattr(exc, "orig", exc)
    return (
        getattr(original, "sqlstate", None) == "40P01"
        or getattr(original, "pgcode", None) == "40P01"
        or "deadlock" in str(original).lower()
    )


def retry_on_deadlock(max_retries: int = 3):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            db = kwargs.get("db")
            if db is None:
                db = next((arg for arg in args if isinstance(arg, AsyncSession)), None)
            for attempt in range(max_retries):
                try:
                    return await func(*args, **kwargs)
                except DBAPIError as exc:
                    if not is_deadlock_error(exc) or attempt == max_retries - 1:
                        raise
                    if db is not None:
                        await db.rollback()
                    await asyncio.sleep(0.1 * (2 ** attempt))
            return await func(*args, **kwargs)

        return wrapper

    return decorator


class AuditService:
    def __init__(
        self,
        db: AsyncSession,
        business_profile_id: int | None = None,
        *,
        staff_id: int | None = None,
        outlet_id: int | None = None,
        terminal_id: str | None = None,
    ):
        self.db = db
        self.business_profile_id = business_profile_id
        self.staff_id = staff_id
        self.outlet_id = outlet_id
        self.terminal_id = terminal_id

    async def log(
        self,
        action: str,
        entity_type: str,
        entity_id: Any,
        details: dict | None = None,
        *,
        severity: str = "info",
        flush: bool = True,
    ) -> None:
        details = details or {}
        business_profile_id = self.business_profile_id or details.get("business_profile_id")
        entry = AuditLog(
            business_profile_id=business_profile_id,
            outlet_id=details.get("outlet_id", self.outlet_id),
            staff_id=details.get("staff_id", self.staff_id),
            terminal_id=details.get("terminal_id", self.terminal_id),
            severity=severity,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            details=json.dumps(details) if details else None,
            details_json=details or None,
        )
        self.db.add(entry)
        if flush:
            await self.db.flush()


class NumberService:
    """Transaction-safe sequence numbers per document family."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _lock_family(self, family: str) -> None:
        bind = self.db.get_bind()
        if bind.dialect.name != "postgresql":
            return
        lock_key = zlib.crc32(f"pos:{family}".encode("utf-8"))
        await self.db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})

    async def _next(self, family: str) -> int:
        await self._lock_family(family)
        stmt = (
            select(DocumentSequence)
            .where(DocumentSequence.family == family)
            .with_for_update()
        )
        seq = (await self.db.execute(stmt)).scalar_one_or_none()
        if not seq:
            seq = DocumentSequence(family=family, next_value=1)
            self.db.add(seq)
            await self.db.flush()
        value = int(seq.next_value)
        seq.next_value = value + 1
        await self.db.flush()
        return value

    async def next_invoice_seq(self) -> int:
        return await self._next("invoice")

    async def next_order_seq(self) -> int:
        return await self._next("order")

    async def next_return_seq(self) -> int:
        return await self._next("return")
