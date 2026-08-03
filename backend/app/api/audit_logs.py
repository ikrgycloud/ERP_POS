from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_business_profile_id
from app.database import get_db
from app.models import AuditLog
from app.schemas import AuditLogOut

router = APIRouter(prefix="/audit-logs", tags=["Audit Logs"])


@router.get("", response_model=list[AuditLogOut])
def list_audit_logs(
    entity_type: str | None = Query(default=None, alias="entityType"),
    action: str | None = None,
    start_date: date | None = Query(default=None, alias="startDate"),
    end_date: date | None = Query(default=None, alias="endDate"),
    limit: int = Query(default=100, ge=1, le=200),
    cursor: int | None = Query(default=None, ge=1),
    business_profile_id: int = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> list[AuditLog]:
    query = db.query(AuditLog).filter(AuditLog.business_profile_id == business_profile_id)
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    if action:
        query = query.filter(AuditLog.action == action)
    if start_date:
        query = query.filter(AuditLog.created_at >= start_date)
    if end_date:
        query = query.filter(AuditLog.created_at <= end_date)
    if cursor is not None:
        query = query.filter(AuditLog.id < cursor).order_by(AuditLog.id.desc())
    else:
        query = query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    return query.limit(limit).all()
