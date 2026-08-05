"""Staff management endpoints."""
from typing import Optional

from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, require_roles
from app.api.pagination import PaginationParams, pagination_params
from app.core.roles import Role
from app.db.session import get_db
from app.schemas.common import Message
from app.schemas.masters import (
    StaffCreate,
    StaffOut,
    StaffPasswordReset,
    StaffReport,
    StaffStatusUpdate,
    StaffUpdate,
)
from app.services.staff import StaffService

router = APIRouter(prefix="/staff", tags=["staff"])


@router.get("", response_model=list[StaffOut])
async def list_staff(
    pagination: PaginationParams = Depends(pagination_params),
    user: CurrentUser = Depends(require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER)),
    db: AsyncSession = Depends(get_db),
):
    return await StaffService(db, user).list_visible(pagination.skip, pagination.limit)


@router.post("", response_model=StaffOut, status_code=201)
async def create_staff(
    payload: StaffCreate,
    user: CurrentUser = Depends(require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER)),
    db: AsyncSession = Depends(get_db),
):
    return await StaffService(db, user).create(payload)


@router.get("/{staff_id}", response_model=StaffOut)
async def get_staff(
    staff_id: int,
    user: CurrentUser = Depends(require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER)),
    db: AsyncSession = Depends(get_db),
):
    return await StaffService(db, user).get_visible(staff_id)


@router.put("/{staff_id}", response_model=StaffOut)
async def update_staff(
    staff_id: int,
    payload: StaffUpdate,
    user: CurrentUser = Depends(require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER)),
    db: AsyncSession = Depends(get_db),
):
    return await StaffService(db, user).update(staff_id, payload)


@router.patch("/{staff_id}/status", response_model=StaffOut)
async def set_status(
    staff_id: int,
    payload: Optional[StaffStatusUpdate] = Body(default=None),
    active: Optional[bool] = Query(default=None),
    user: CurrentUser = Depends(require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER)),
    db: AsyncSession = Depends(get_db),
):
    next_active = payload.is_active if payload is not None else active
    return await StaffService(db, user).set_status(staff_id, next_active)


@router.post("/{staff_id}/reset-password", response_model=Message)
async def reset_password(
    staff_id: int,
    payload: StaffPasswordReset,
    user: CurrentUser = Depends(require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER)),
    db: AsyncSession = Depends(get_db),
):
    await StaffService(db, user).reset_password(staff_id, payload.new_password)
    return Message(detail="Password reset")


@router.delete("/{staff_id}", response_model=Message)
async def delete_staff(
    staff_id: int,
    user: CurrentUser = Depends(require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER)),
    db: AsyncSession = Depends(get_db),
):
    await StaffService(db, user).delete(staff_id)
    return Message(detail="Staff deleted")


@router.get("/{staff_id}/report", response_model=StaffReport)
async def staff_report(
    staff_id: int,
    user: CurrentUser = Depends(require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER)),
    db: AsyncSession = Depends(get_db),
):
    return await StaffService(db, user).report(staff_id)
