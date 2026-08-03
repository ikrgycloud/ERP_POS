import json
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog


def record_audit(
    db: Session,
    *,
    action: str,
    entity_type: str,
    entity_id: str | int,
    business_profile_id: int | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    details = details or {}
    if business_profile_id is None:
        business_profile_id = details.get("business_profile_id") or details.get("businessProfileId")
    db.add(
        AuditLog(
            business_profile_id=business_profile_id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            details=json.dumps(details, default=str),
        )
    )
