import hashlib
import json
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.catalog import IdempotencyKey


@dataclass
class AsyncIdempotencyState:
    record: IdempotencyKey | None = None
    replay_body: Any | None = None


def request_hash(payload: Any) -> str:
    encoded = json.dumps(jsonable_encoder(payload), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


async def begin_idempotent_request(
    db: AsyncSession,
    key: str | None,
    endpoint: str,
    payload: Any,
) -> AsyncIdempotencyState:
    if not key:
        return AsyncIdempotencyState()
    hashed = request_hash({"endpoint": endpoint, "payload": payload})
    result = await db.execute(select(IdempotencyKey).where(IdempotencyKey.key == key))
    existing = result.scalar_one_or_none()
    if existing:
        if existing.request_hash != hashed:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Idempotency-Key was already used with a different request",
            )
        if existing.response_body is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Idempotent request is still processing",
            )
        return AsyncIdempotencyState(replay_body=existing.response_body)

    record = IdempotencyKey(
        key=key,
        endpoint=endpoint,
        request_hash=hashed,
        response_body=None,
        status_code=0,
    )
    db.add(record)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        result = await db.execute(select(IdempotencyKey).where(IdempotencyKey.key == key))
        existing = result.scalar_one_or_none()
        if existing and existing.request_hash == hashed and existing.response_body is not None:
            return AsyncIdempotencyState(replay_body=existing.response_body)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Idempotent request is still processing",
        ) from None
    return AsyncIdempotencyState(record=record)


def complete_idempotent_request(
    state: AsyncIdempotencyState,
    response_body: Any,
    status_code: int,
) -> Any:
    if state.record is not None:
        state.record.response_body = jsonable_encoder(response_body)
        state.record.status_code = status_code
    return response_body
