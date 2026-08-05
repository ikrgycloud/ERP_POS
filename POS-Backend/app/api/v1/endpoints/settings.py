"""Tenant-scoped POS settings endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, require_roles
from app.core.exceptions import NotFoundError
from app.core.roles import Role
from app.db.session import get_db
from app.models.org import BusinessProfile
from app.schemas.settings import InvoiceBrandingOut, InvoiceBrandingUpdate
from app.services.common import AuditService

router = APIRouter(prefix="/settings", tags=["settings"])

BM_ONLY = require_roles(Role.BRANCH_MANAGER)


def _branding_out(profile: BusinessProfile) -> InvoiceBrandingOut:
    return InvoiceBrandingOut(
        company_name=profile.invoice_company_name or profile.trade_name or profile.legal_name,
    )


async def _profile(db: AsyncSession, business_profile_id: int) -> BusinessProfile:
    profile = await db.get(BusinessProfile, business_profile_id)
    if not profile:
        raise NotFoundError("Business profile not found")
    return profile


@router.get("/invoice-branding", response_model=InvoiceBrandingOut)
async def get_invoice_branding(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return _branding_out(await _profile(db, user.business_profile_id))


@router.put("/invoice-branding", response_model=InvoiceBrandingOut)
async def update_invoice_branding(
    payload: InvoiceBrandingUpdate,
    user: CurrentUser = Depends(BM_ONLY),
    db: AsyncSession = Depends(get_db),
):
    profile = await _profile(db, user.business_profile_id)
    data = payload.model_dump(exclude_unset=True)
    if "company_name" in data:
        profile.invoice_company_name = data["company_name"]
    await AuditService(db, user.business_profile_id).log(
        "update", "invoice_branding", profile.id, {"fields": sorted(data)}
    )
    await db.flush()
    await db.refresh(profile)
    return _branding_out(profile)
