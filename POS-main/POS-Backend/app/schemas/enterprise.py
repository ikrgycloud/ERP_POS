from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.schemas.common import ORMModel


class ApprovalCreate(BaseModel):
    approval_type: str = Field(min_length=2, max_length=40)
    reason: str = Field(min_length=2, max_length=500)
    order_id: Optional[int] = None
    invoice_id: Optional[int] = None
    payload: dict[str, Any] = {}


class ApprovalDecision(BaseModel):
    decision_note: Optional[str] = Field(default=None, max_length=500)


class ApprovalOut(ORMModel):
    id: int
    business_profile_id: int
    outlet_id: Optional[int]
    order_id: Optional[int]
    invoice_id: Optional[int]
    requested_by_staff_id: int
    approved_by_staff_id: Optional[int]
    terminal_id: Optional[str]
    approval_type: str
    status: str
    reason: Optional[str]
    payload: Optional[dict[str, Any]]
    decision_note: Optional[str]
    decided_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


class ShiftOpen(BaseModel):
    opening_cash: Decimal = Field(default=Decimal("0"), ge=0)
    note: Optional[str] = Field(default=None, max_length=500)


class ShiftClose(BaseModel):
    closing_cash: Decimal = Field(ge=0)
    expected_cash: Optional[Decimal] = Field(default=None, ge=0)
    note: Optional[str] = Field(default=None, max_length=500)


class ShiftOut(ORMModel):
    id: int
    business_profile_id: int
    outlet_id: Optional[int]
    staff_id: int
    terminal_id: Optional[str]
    status: str
    opened_at: datetime
    closed_at: Optional[datetime]
    opening_cash: Decimal
    closing_cash: Optional[Decimal]
    expected_cash: Optional[Decimal]
    variance: Optional[Decimal]
    note: Optional[str]
    created_at: datetime
    updated_at: datetime


class CashDrawerEventCreate(BaseModel):
    event_type: str = Field(min_length=2, max_length=40)
    amount: Optional[Decimal] = Field(default=None, ge=0)
    reason: Optional[str] = Field(default=None, max_length=500)
    metadata: dict[str, Any] = {}


class CashDrawerEventOut(ORMModel):
    id: int
    business_profile_id: int
    outlet_id: Optional[int]
    staff_id: int
    shift_id: Optional[int]
    terminal_id: Optional[str]
    event_type: str
    amount: Optional[Decimal]
    reason: Optional[str]
    metadata_json: Optional[dict[str, Any]]
    created_at: datetime
    updated_at: datetime


class TerminalRegister(BaseModel):
    terminal_id: str = Field(min_length=2, max_length=120)
    name: str = Field(min_length=2, max_length=180)
    secret: str = Field(min_length=8, max_length=120)


class TerminalOut(ORMModel):
    id: int
    business_profile_id: int
    outlet_id: int
    terminal_id: str
    name: str
    is_active: bool
    last_seen_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


class AuditLogOut(ORMModel):
    id: int
    business_profile_id: Optional[int]
    outlet_id: Optional[int]
    staff_id: Optional[int]
    terminal_id: Optional[str]
    severity: str
    action: str
    entity_type: str
    entity_id: str
    details: Optional[str]
    details_json: Optional[dict[str, Any]] = None
    created_at: datetime
