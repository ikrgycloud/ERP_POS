from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser
from app.core.exceptions import BusinessRuleError, ForbiddenError, NotFoundError
from app.core.roles import Role
from app.core.security import hash_password, verify_password
from app.models.org import Terminal
from app.models.sales import ApprovalRequest, AuditLog, CashDrawerEvent, ShiftSession
from app.schemas.enterprise import (
    ApprovalCreate,
    CashDrawerEventCreate,
    ShiftClose,
    ShiftOpen,
    TerminalRegister,
)
from app.services.common import AuditService


APPROVAL_ROLES: dict[str, set[Role]] = {
    "supervisor_override": {Role.BRANCH_MANAGER, Role.SALES_MANAGER},
    "manager_approval": {Role.BRANCH_MANAGER, Role.SALES_MANAGER},
    "discount": {Role.BRANCH_MANAGER, Role.SALES_MANAGER},
    "price_override": {Role.BRANCH_MANAGER},
    "refund": {Role.BRANCH_MANAGER},
    "cash_drawer": {Role.BRANCH_MANAGER, Role.SALES_MANAGER},
    "void": {Role.BRANCH_MANAGER, Role.SALES_MANAGER},
}


class EnterprisePOSService:
    def __init__(self, db: AsyncSession, user: CurrentUser, terminal_id: str | None = None):
        self.db = db
        self.user = user
        self.terminal_id = (terminal_id or "default")[:120]
        self.audit = AuditService(
            db,
            user.business_profile_id,
            staff_id=user.id,
            outlet_id=user.outlet_id,
            terminal_id=self.terminal_id,
        )

    async def verify_registered_terminal(self, secret: str | None = None) -> Terminal | None:
        stmt = select(Terminal).where(
            Terminal.terminal_id == self.terminal_id,
            Terminal.business_profile_id == self.user.business_profile_id,
            Terminal.outlet_id == self.user.outlet_id,
        )
        terminal = (await self.db.execute(stmt)).scalars().first()
        if not terminal:
            return None
        if not terminal.is_active:
            raise ForbiddenError("Terminal is inactive")
        if terminal.secret_hash and not verify_password(secret or "", terminal.secret_hash):
            raise ForbiddenError("Terminal secret is invalid")
        terminal.last_seen_at = self._now()
        await self.db.flush()
        return terminal

    async def register_terminal(self, payload: TerminalRegister) -> Terminal:
        if self.user.role not in {Role.BRANCH_MANAGER, Role.SALES_MANAGER}:
            raise ForbiddenError("Only managers can register POS terminals")
        terminal_id = payload.terminal_id.strip()[:120]
        stmt = select(Terminal).where(Terminal.terminal_id == terminal_id)
        terminal = (await self.db.execute(stmt)).scalars().first()
        if terminal and (
            terminal.business_profile_id != self.user.business_profile_id
            or terminal.outlet_id != self.user.outlet_id
        ):
            raise ForbiddenError("Terminal id belongs to another outlet")
        if not terminal:
            terminal = Terminal(
                business_profile_id=self.user.business_profile_id,
                outlet_id=self.user.outlet_id or 0,
                terminal_id=terminal_id,
                name=payload.name,
                secret_hash=hash_password(payload.secret),
                is_active=True,
                last_seen_at=self._now(),
            )
            self.db.add(terminal)
        else:
            terminal.name = payload.name
            terminal.secret_hash = hash_password(payload.secret)
            terminal.is_active = True
            terminal.last_seen_at = self._now()
        await self.db.flush()
        await self.db.refresh(terminal)
        await self.audit.log(
            "terminal_registered",
            "terminal",
            terminal.terminal_id,
            {"terminal_id": terminal.terminal_id, "name": terminal.name},
        )
        return terminal

    @staticmethod
    def _now():
        return datetime.now(timezone.utc)

    async def active_shift(self) -> ShiftSession | None:
        stmt = (
            select(ShiftSession)
            .where(
                ShiftSession.business_profile_id == self.user.business_profile_id,
                ShiftSession.outlet_id == self.user.outlet_id,
                ShiftSession.staff_id == self.user.id,
                ShiftSession.terminal_id == self.terminal_id,
                ShiftSession.status == "open",
            )
            .order_by(ShiftSession.id.desc())
        )
        return (await self.db.execute(stmt)).scalars().first()

    async def open_shift(self, payload: ShiftOpen) -> ShiftSession:
        active = await self.active_shift()
        if active:
            return active
        shift = ShiftSession(
            business_profile_id=self.user.business_profile_id,
            outlet_id=self.user.outlet_id,
            staff_id=self.user.id,
            terminal_id=self.terminal_id,
            status="open",
            opening_cash=payload.opening_cash,
            note=payload.note,
        )
        self.db.add(shift)
        try:
            await self.db.flush()
        except IntegrityError:
            await self.db.rollback()
            active = await self.active_shift()
            if not active:
                raise
            return active
        await self.db.refresh(shift)
        await self.audit.log(
            "shift_opened",
            "shift",
            shift.id,
            {"opening_cash": str(payload.opening_cash), "note": payload.note},
        )
        return shift

    async def close_shift(self, shift_id: int, payload: ShiftClose) -> ShiftSession:
        shift = await self.db.get(ShiftSession, shift_id)
        if not shift or shift.business_profile_id != self.user.business_profile_id:
            raise NotFoundError("Shift not found")
        if shift.staff_id != self.user.id and self.user.role == Role.SALES_PERSON:
            raise ForbiddenError("Only the cashier or a manager can close this shift")
        if shift.status != "open":
            raise BusinessRuleError("Shift is already closed")
        expected_cash = payload.expected_cash
        if expected_cash is None:
            cash_events = await self._cash_event_total(shift.id)
            expected_cash = Decimal(str(shift.opening_cash or 0)) + cash_events
        variance = payload.closing_cash - expected_cash
        shift.status = "closed"
        shift.closed_at = self._now()
        shift.closing_cash = payload.closing_cash
        shift.expected_cash = expected_cash
        shift.variance = variance
        shift.note = payload.note or shift.note
        await self.db.flush()
        await self.db.refresh(shift)
        await self.audit.log(
            "shift_closed",
            "shift",
            shift.id,
            {
                "closing_cash": str(payload.closing_cash),
                "expected_cash": str(expected_cash),
                "variance": str(variance),
            },
            severity="warning" if variance else "info",
        )
        return shift

    async def _cash_event_total(self, shift_id: int) -> Decimal:
        positive = select(func.coalesce(func.sum(CashDrawerEvent.amount), 0)).where(
            CashDrawerEvent.shift_id == shift_id,
            CashDrawerEvent.event_type.in_(["sale_cash_in", "cash_in"]),
        )
        negative = select(func.coalesce(func.sum(CashDrawerEvent.amount), 0)).where(
            CashDrawerEvent.shift_id == shift_id,
            CashDrawerEvent.event_type.in_(["refund_cash_out", "cash_out", "payout"]),
        )
        cash_in = Decimal(str((await self.db.execute(positive)).scalar_one() or 0))
        cash_out = Decimal(str((await self.db.execute(negative)).scalar_one() or 0))
        return cash_in - cash_out

    async def drawer_event(self, payload: CashDrawerEventCreate) -> CashDrawerEvent:
        shift = await self.active_shift()
        event = CashDrawerEvent(
            business_profile_id=self.user.business_profile_id,
            outlet_id=self.user.outlet_id,
            staff_id=self.user.id,
            shift_id=shift.id if shift else None,
            terminal_id=self.terminal_id,
            event_type=payload.event_type,
            amount=payload.amount,
            reason=payload.reason,
            metadata_json=payload.metadata,
        )
        self.db.add(event)
        await self.db.flush()
        await self.db.refresh(event)
        await self.audit.log(
            f"drawer_{payload.event_type}",
            "cash_drawer",
            event.id,
            {"amount": str(payload.amount or ""), "reason": payload.reason, "shift_id": event.shift_id},
        )
        return event

    async def request_approval(self, payload: ApprovalCreate) -> ApprovalRequest:
        request = ApprovalRequest(
            business_profile_id=self.user.business_profile_id,
            outlet_id=self.user.outlet_id,
            order_id=payload.order_id,
            invoice_id=payload.invoice_id,
            requested_by_staff_id=self.user.id,
            terminal_id=self.terminal_id,
            approval_type=payload.approval_type,
            status="pending",
            reason=payload.reason,
            payload=payload.payload,
        )
        self.db.add(request)
        await self.db.flush()
        await self.db.refresh(request)
        await self.audit.log(
            "approval_requested",
            "approval",
            request.id,
            {
                "approval_type": payload.approval_type,
                "order_id": payload.order_id,
                "invoice_id": payload.invoice_id,
                "reason": payload.reason,
            },
            severity="warning",
        )
        return request

    async def decide_approval(self, approval_id: int, status: str, note: str | None) -> ApprovalRequest:
        if status not in {"approved", "rejected"}:
            raise BusinessRuleError("Approval decision must be approved or rejected")
        approval = await self.db.get(ApprovalRequest, approval_id)
        if not approval or approval.business_profile_id != self.user.business_profile_id:
            raise NotFoundError("Approval request not found")
        allowed = APPROVAL_ROLES.get(approval.approval_type, {Role.BRANCH_MANAGER, Role.SALES_MANAGER})
        if self.user.role not in allowed:
            raise ForbiddenError("This role cannot approve the requested action")
        if approval.status != "pending":
            raise BusinessRuleError("Approval request is already decided")
        approval.status = status
        approval.approved_by_staff_id = self.user.id if status == "approved" else None
        approval.decision_note = note
        approval.decided_at = self._now()
        await self.db.flush()
        await self.db.refresh(approval)
        await self.audit.log(
            f"approval_{status}",
            "approval",
            approval.id,
            {
                "approval_type": approval.approval_type,
                "requested_by_staff_id": approval.requested_by_staff_id,
                "decision_note": note,
            },
            severity="warning",
        )
        return approval

    async def approvals(self, status: str | None = None) -> list[ApprovalRequest]:
        stmt = (
            select(ApprovalRequest)
            .where(ApprovalRequest.business_profile_id == self.user.business_profile_id)
            .order_by(ApprovalRequest.id.desc())
            .limit(100)
        )
        if self.user.role == Role.SALES_PERSON:
            stmt = stmt.where(ApprovalRequest.requested_by_staff_id == self.user.id)
        if status:
            stmt = stmt.where(ApprovalRequest.status == status)
        return list((await self.db.execute(stmt)).scalars().all())

    async def timeline(
        self,
        *,
        order_id: int | None = None,
        invoice_id: int | None = None,
        limit: int = 100,
    ) -> list[AuditLog]:
        stmt = (
            select(AuditLog)
            .where(AuditLog.business_profile_id == self.user.business_profile_id)
            .order_by(AuditLog.id.desc())
            .limit(min(limit, 200))
        )
        if self.user.role == Role.SALES_PERSON:
            stmt = stmt.where(AuditLog.staff_id == self.user.id)
        if order_id is not None:
            stmt = stmt.where(AuditLog.entity_id == str(order_id), AuditLog.entity_type.in_(["cart", "order"]))
        if invoice_id is not None:
            stmt = stmt.where(AuditLog.entity_id == str(invoice_id), AuditLog.entity_type == "invoice")
        return list((await self.db.execute(stmt)).scalars().all())

    async def shifts(self) -> list[ShiftSession]:
        stmt = (
            select(ShiftSession)
            .where(ShiftSession.business_profile_id == self.user.business_profile_id)
            .order_by(ShiftSession.id.desc())
            .limit(100)
        )
        if self.user.role == Role.SALES_PERSON:
            stmt = stmt.where(ShiftSession.staff_id == self.user.id)
        return list((await self.db.execute(stmt)).scalars().all())
