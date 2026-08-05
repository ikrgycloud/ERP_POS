"""FastAPI dependencies for auth and RBAC."""
from dataclasses import dataclass
from datetime import datetime
from time import monotonic
from types import SimpleNamespace
from typing import Iterable, Optional

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.core.roles import Role
from app.core.security import decode_token
from app.core.token_store import is_token_revoked
from app.db.session import get_db
from app.models.org import Staff
from app.permissions.rules import Permission, has_permission

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_PREFIX}/auth/login", auto_error=False
)


@dataclass
class CurrentUser:
    id: int
    role: Role
    business_profile_id: int
    outlet_id: Optional[int]
    staff: Staff


AUTH_USER_CACHE_TTL_SECONDS = 60
_auth_user_cache: dict[str, tuple[float, CurrentUser]] = {}


def _staff_snapshot(staff: Staff):
    return SimpleNamespace(
        id=staff.id,
        business_profile_id=staff.business_profile_id,
        outlet_id=staff.outlet_id,
        role=staff.role,
        employee_code=staff.employee_code,
        full_name=staff.full_name,
        phone=staff.phone,
        email=staff.email,
        password_hash=staff.password_hash,
        manager_id=staff.manager_id,
        joining_date=staff.joining_date,
        is_active=staff.is_active,
        last_login_at=staff.last_login_at,
        created_at=getattr(staff, "created_at", datetime.utcnow()),
        updated_at=getattr(staff, "updated_at", None),
    )


async def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    if not token:
        raise UnauthorizedError("Missing bearer token")
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise UnauthorizedError("Invalid or expired token")
    token_id = payload.get("jti")
    if is_token_revoked(token_id):
        raise UnauthorizedError("Token has been revoked")
    now = monotonic()
    cached = _auth_user_cache.get(token_id)
    if cached and cached[0] > now:
        return cached[1]
    if cached:
        _auth_user_cache.pop(token_id, None)
    staff_id = int(payload["sub"])
    staff = await db.get(Staff, staff_id)
    if not staff or not staff.is_active:
        _auth_user_cache.pop(token_id, None)
        raise UnauthorizedError("Account not found or inactive")
    current = CurrentUser(
        id=staff.id,
        role=Role(staff.role),
        business_profile_id=staff.business_profile_id,
        outlet_id=staff.outlet_id,
        staff=_staff_snapshot(staff),
    )
    _auth_user_cache[token_id] = (now + AUTH_USER_CACHE_TTL_SECONDS, current)
    return current


def require_roles(*allowed: Role):
    """Dependency factory guarding an endpoint to specific roles."""

    allowed_set: Iterable[Role] = set(allowed)

    async def guard(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in allowed_set:
            raise ForbiddenError(
                f"Role '{user.role.value}' may not perform this action"
            )
        return user

    return guard


def require_permissions(*required: Permission):
    """Dependency factory guarding an endpoint by permissions."""

    async def guard(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        missing = [
            permission.value
            for permission in required
            if not has_permission(user.role, permission)
        ]
        if missing:
            raise ForbiddenError(
                f"Missing required permission(s): {', '.join(missing)}"
            )
        return user

    return guard
