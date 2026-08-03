import hashlib
import json
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import IdempotencyKey


@dataclass
class IdempotencyState:
    record: IdempotencyKey | None = None
    replay_body: Any | None = None


def request_hash(payload: Any) -> str:
    encoded = json.dumps(jsonable_encoder(payload), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def begin_idempotent_request(
    db: Session,
    key: str | None,
    endpoint: str,
    payload: Any,
) -> IdempotencyState:
    if not key:
        return IdempotencyState()
    hashed = request_hash({"endpoint": endpoint, "payload": payload})
    existing = db.query(IdempotencyKey).filter(IdempotencyKey.key == key).first()
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
        return IdempotencyState(replay_body=existing.response_body)

    record = IdempotencyKey(
        key=key,
        endpoint=endpoint,
        request_hash=hashed,
        response_body=None,
        status_code=0,
    )
    db.add(record)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        existing = db.query(IdempotencyKey).filter(IdempotencyKey.key == key).first()
        if existing and existing.request_hash == hashed and existing.response_body is not None:
            return IdempotencyState(replay_body=existing.response_body)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Idempotent request is still processing",
        ) from None
    return IdempotencyState(record=record)


def complete_idempotent_request(
    state: IdempotencyState,
    response_body: Any,
    status_code: int,
) -> Any:
    if state.record is not None:
        state.record.response_body = jsonable_encoder(response_body)
        state.record.status_code = status_code
    return response_body
