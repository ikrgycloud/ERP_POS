"""Auth endpoints — login, refresh, me, change password."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, oauth2_scheme
from app.core.exceptions import UnauthorizedError
from app.core.login_security import (
    clear_login_failures,
    is_login_locked,
    record_login_failure,
)
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.core.token_store import is_token_revoked, revoke_token
from app.db.session import get_db
from app.repositories.repos import StaffRepository
from app.schemas.common import (
    ChangePasswordRequest,
    LoginRequest,
    LogoutRequest,
    Message,
    RefreshRequest,
    Token,
)
from app.schemas.masters import StaffOut
from app.services.common import AuditService

router = APIRouter(prefix="/auth", tags=["auth"])


def _issue(staff) -> Token:
    claims = {
        "role": staff.role,
        "bp": staff.business_profile_id,
        "outlet": staff.outlet_id,
    }
    return Token(
        access_token=create_access_token(staff.id, claims),
        refresh_token=create_refresh_token(staff.id),
    )


def _token_expires_at(payload: dict) -> datetime | None:
    exp = payload.get("exp")
    if isinstance(exp, int):
        return datetime.fromtimestamp(exp, tz=timezone.utc)
    if isinstance(exp, datetime):
        return exp
    return None


@router.post("/login", response_model=Token)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    employee_code = payload.employee_code.strip().upper()
    if is_login_locked(employee_code):
        raise UnauthorizedError("Account temporarily locked")
    repo = StaffRepository(db)
    staff = await repo.get_by_code(employee_code)
    if not staff:
        record_login_failure(employee_code)
        raise UnauthorizedError("Incorrect Employee Code", code="INVALID_EMPLOYEE_CODE")
    if not verify_password(payload.password, staff.password_hash):
        record_login_failure(employee_code)
        raise UnauthorizedError("Incorrect Password", code="INVALID_PASSWORD")
    if not staff.is_active:
        raise UnauthorizedError("Account is inactive", code="ACCOUNT_INACTIVE")
    if not staff.business_profile_id:
        raise UnauthorizedError("Business access is not configured", code="BUSINESS_ACCESS_DENIED")
    if staff.outlet_id is None:
        raise UnauthorizedError("Outlet access is not configured", code="OUTLET_ACCESS_DENIED")
    clear_login_failures(employee_code)
    staff.last_login_at = datetime.now(timezone.utc)
    await db.flush()
    await AuditService(
        db,
        staff.business_profile_id,
        staff_id=staff.id,
        outlet_id=staff.outlet_id,
    ).log(
        "cashier_login",
        "staff",
        staff.id,
        {"employee_code": staff.employee_code, "role": staff.role},
    )
    return _issue(staff)


@router.post("/refresh", response_model=Token)
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    token_payload = decode_token(payload.refresh_token)
    if not token_payload or token_payload.get("type") != "refresh":
        raise UnauthorizedError("Invalid refresh token")
    if is_token_revoked(token_payload.get("jti")):
        raise UnauthorizedError("Refresh token has been revoked")
    revoke_token(token_payload.get("jti"), _token_expires_at(token_payload))
    staff = await StaffRepository(db).get(int(token_payload["sub"]))
    if not staff or not staff.is_active:
        raise UnauthorizedError("Account not found or inactive")
    return _issue(staff)


@router.post("/logout", response_model=Message)
async def logout(
    payload: LogoutRequest,
    access_token: str = Depends(oauth2_scheme),
):
    access_payload = decode_token(access_token) if access_token else None
    if access_payload:
        revoke_token(access_payload.get("jti"), _token_expires_at(access_payload))
    if payload.refresh_token:
        refresh_payload = decode_token(payload.refresh_token)
        if refresh_payload:
            revoke_token(refresh_payload.get("jti"), _token_expires_at(refresh_payload))
    return Message(detail="Logged out")


@router.get("/me", response_model=StaffOut)
async def me(user: CurrentUser = Depends(get_current_user)):
    return user.staff


@router.post("/change-password", response_model=Message)
async def change_password(
    payload: ChangePasswordRequest,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    staff = await StaffRepository(db).get(user.id)
    if not staff or not staff.is_active:
        raise UnauthorizedError("Account not found or inactive")
    if not verify_password(payload.old_password, staff.password_hash):
        raise UnauthorizedError("Old password is incorrect")
    staff.password_hash = hash_password(payload.new_password)
    await db.flush()
    return Message(detail="Password updated")
