"""Enterprise POS control endpoints: audit timeline, approvals, shifts, drawer."""

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, require_roles
from app.core.roles import Role
from app.db.session import get_db
from app.schemas.enterprise import (
    ApprovalCreate,
    ApprovalDecision,
    ApprovalOut,
    AuditLogOut,
    CashDrawerEventCreate,
    CashDrawerEventOut,
    ShiftClose,
    ShiftOpen,
    ShiftOut,
    TerminalOut,
    TerminalRegister,
)
from app.services.enterprise import EnterprisePOSService

router = APIRouter(prefix="/pos/enterprise", tags=["enterprise-pos"])


def _svc(db: AsyncSession, user: CurrentUser, terminal_id: str | None) -> EnterprisePOSService:
    return EnterprisePOSService(db, user, terminal_id=terminal_id)


@router.get("/timeline", response_model=list[AuditLogOut])
async def timeline(
    order_id: int | None = None,
    invoice_id: int | None = None,
    limit: int = Query(default=100, ge=1, le=200),
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return await _svc(db, user, terminal_id).timeline(
        order_id=order_id,
        invoice_id=invoice_id,
        limit=limit,
    )


@router.post("/terminals/register", response_model=TerminalOut, status_code=201)
async def register_terminal(
    payload: TerminalRegister,
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER)),
):
    return await _svc(db, user, terminal_id).register_terminal(payload)


@router.get("/approvals", response_model=list[ApprovalOut])
async def approvals(
    status: str | None = None,
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return await _svc(db, user, terminal_id).approvals(status=status)


@router.post("/approvals", response_model=ApprovalOut, status_code=201)
async def request_approval(
    payload: ApprovalCreate,
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return await _svc(db, user, terminal_id).request_approval(payload)


@router.post("/approvals/{approval_id}/approve", response_model=ApprovalOut)
async def approve(
    approval_id: int,
    payload: ApprovalDecision,
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER)),
):
    return await _svc(db, user, terminal_id).decide_approval(
        approval_id,
        "approved",
        payload.decision_note,
    )


@router.post("/approvals/{approval_id}/reject", response_model=ApprovalOut)
async def reject(
    approval_id: int,
    payload: ApprovalDecision,
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER)),
):
    return await _svc(db, user, terminal_id).decide_approval(
        approval_id,
        "rejected",
        payload.decision_note,
    )


@router.get("/shifts", response_model=list[ShiftOut])
async def shifts(
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return await _svc(db, user, terminal_id).shifts()


@router.get("/shifts/active", response_model=ShiftOut | None)
async def active_shift(
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return await _svc(db, user, terminal_id).active_shift()


@router.post("/shifts/open", response_model=ShiftOut, status_code=201)
async def open_shift(
    payload: ShiftOpen,
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return await _svc(db, user, terminal_id).open_shift(payload)


@router.post("/shifts/{shift_id}/close", response_model=ShiftOut)
async def close_shift(
    shift_id: int,
    payload: ShiftClose,
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return await _svc(db, user, terminal_id).close_shift(shift_id, payload)


@router.post("/drawer-events", response_model=CashDrawerEventOut, status_code=201)
async def drawer_event(
    payload: CashDrawerEventCreate,
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return await _svc(db, user, terminal_id).drawer_event(payload)
