from datetime import date
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Query as SqlAlchemyQuery

from app.security import decode_access_token


@dataclass(frozen=True)
class ErpPrincipal:
    business_profile_id: int
    role: str
    outlet_id: int | None = None
    email: str | None = None

    @property
    def is_outlet(self) -> bool:
        return self.outlet_id is not None


def get_erp_principal(authorization: str | None = Header(default=None, alias="Authorization")) -> ErpPrincipal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    payload = decode_access_token(authorization.split(" ", 1)[1].strip())
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    try:
        business_profile_id = int(payload["business_profile_id"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token tenant") from None
    outlet_id = payload.get("outlet_id")
    try:
        outlet_id = int(outlet_id) if outlet_id is not None else None
    except (TypeError, ValueError):
        outlet_id = None
    return ErpPrincipal(
        business_profile_id=business_profile_id,
        role=str(payload.get("role") or ""),
        outlet_id=outlet_id,
        email=payload.get("email"),
    )


def get_business_profile_id(principal: ErpPrincipal = Depends(get_erp_principal)) -> int:
    return principal.business_profile_id


def resolve_outlet_scope(requested_outlet_id: int | None, principal: ErpPrincipal) -> int | None:
    if principal.outlet_id is None:
        return requested_outlet_id
    if requested_outlet_id is not None and requested_outlet_id != principal.outlet_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Outlet access denied")
    return principal.outlet_id


def ensure_outlet_record_access(record_outlet_id: int | None, principal: ErpPrincipal) -> None:
    if principal.outlet_id is not None and record_outlet_id != principal.outlet_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")


def apply_date_range(query: SqlAlchemyQuery, model, start_date: date | None, end_date: date | None) -> SqlAlchemyQuery:
    if start_date:
        query = query.filter(model.date >= start_date)
    if end_date:
        query = query.filter(model.date <= end_date)
    return query


def apply_created_range(
    Query_obj: SqlAlchemyQuery,
    model,
    start_date: date | None,
    end_date: date | None,
) -> SqlAlchemyQuery:
    query = Query_obj
    if start_date:
        query = query.filter(model.created_at >= start_date)
    if end_date:
        query = query.filter(model.created_at <= end_date)
    return query
