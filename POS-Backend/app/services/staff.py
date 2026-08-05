"""Staff service — enforces who can create/manage whom."""
from typing import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.core.roles import Role
from app.core.security import hash_password
from app.models.org import Staff
from app.repositories.repos import InvoiceRepository, StaffRepository
from app.schemas.masters import StaffCreate, StaffReport, StaffUpdate
from app.services.common import AuditService

# who each role is allowed to create
CREATE_MATRIX = {
    Role.BRANCH_MANAGER: {Role.SALES_MANAGER},
    Role.SALES_MANAGER: {Role.SALES_PERSON},
    Role.SALES_PERSON: set(),
}


class StaffService:
    def __init__(self, db: AsyncSession, user: CurrentUser):
        self.db = db
        self.user = user
        self.repo = StaffRepository(db)
        self.invoices = InvoiceRepository(db)
        self.audit = AuditService(db, user.business_profile_id)

    async def create(self, payload: StaffCreate) -> Staff:
        allowed = CREATE_MATRIX.get(self.user.role, set())
        if payload.role not in allowed:
            raise ForbiddenError(
                f"{self.user.role.value} cannot create {payload.role.value}"
            )
        if await self.repo.get_by_code(payload.employee_code):
            raise ConflictError("employee_code already exists")
        if payload.email and await self.repo.get_by_email(payload.email):
            raise ConflictError("email already exists")

        manager_id = None
        if payload.role in CREATE_MATRIX[self.user.role]:
            manager_id = self.user.id  # reports to the Branch Manager creating them
        outlet_id = payload.outlet_id or self.user.outlet_id

        staff = await self.repo.create(
            business_profile_id=self.user.business_profile_id,
            outlet_id=outlet_id,
            role=payload.role.value,
            employee_code=payload.employee_code,
            full_name=payload.full_name,
            phone=payload.phone,
            email=str(payload.email).lower() if payload.email else None,
            password_hash=hash_password(payload.password),
            manager_id=manager_id,
            joining_date=payload.joining_date,
            is_active=True,
        )
        await self.audit.log("create", "staff", staff.id, {"role": staff.role})
        return staff

    async def list_visible(self, skip: int, limit: int) -> Sequence[Staff]:
        if self.user.role == Role.BRANCH_MANAGER:
            return await self.repo.list(
                skip=skip, limit=limit,
                business_profile_id=self.user.business_profile_id,
            )
        if self.user.role == Role.SALES_MANAGER:
            return await self.repo.list_subordinates(self.user.id)
        raise ForbiddenError("Not permitted to list staff")

    async def get_visible(self, staff_id: int) -> Staff:
        staff = await self.repo.get(staff_id)
        if not staff:
            raise NotFoundError("Staff not found")
        if self.user.role == Role.SALES_MANAGER and staff.manager_id != self.user.id:
            raise ForbiddenError("Sales Manager may only view own Sales Persons")
        return staff

    async def update(self, staff_id: int, payload: StaffUpdate) -> Staff:
        staff = await self.get_visible(staff_id)
        data = payload.model_dump(exclude_unset=True)
        return await self.repo.update(staff, **data)

    async def set_status(self, staff_id: int, active: bool | None) -> Staff:
        if active is None:
            raise ForbiddenError("Status value is required")
        staff = await self.get_visible(staff_id)
        staff.is_active = active
        await self.db.flush()
        await self.audit.log("status", "staff", staff.id, {"active": active})
        await self.db.refresh(staff)
        return staff

    async def reset_password(self, staff_id: int, new_password: str) -> None:
        staff = await self.get_visible(staff_id)
        staff.password_hash = hash_password(new_password)
        await self.db.flush()
        await self.audit.log("reset_password", "staff", staff.id)

    async def delete(self, staff_id: int) -> None:
        staff = await self.get_visible(staff_id)
        if self.user.role == Role.SALES_MANAGER and staff.role != Role.SALES_PERSON.value:
            raise ForbiddenError("Sales Manager may only delete own Sales Persons")
        if self.user.role not in {Role.BRANCH_MANAGER, Role.SALES_MANAGER}:
            raise ForbiddenError("Not permitted to delete staff")
        await self.repo.delete(staff)
        await self.audit.log("delete", "staff", staff_id)

    async def report(self, staff_id: int) -> StaffReport:
        staff = await self.get_visible(staff_id)
        count = await self.invoices.count_for_staff(staff.id)
        revenue = await self.invoices.revenue_by_staff(staff.id)
        return StaffReport(
            staff_id=staff.id,
            full_name=staff.full_name,
            invoice_count=count,
            revenue=revenue,
        )
