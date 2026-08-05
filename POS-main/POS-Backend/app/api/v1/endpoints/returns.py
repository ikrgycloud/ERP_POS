"""Return & reversal endpoints."""
from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, require_roles
from app.api.pagination import PaginationParams, pagination_params
from app.core.exceptions import NotFoundError
from app.core.config import settings
from app.core.roles import Role
from app.db.session import get_db
from app.models.org import Staff
from app.repositories.repos import (
    InvoiceRepository,
    ProductRepository,
    ReturnRepository,
)
from app.schemas.transactions import (
    InvoiceOut,
    ReturnCreate,
    ReturnEvidenceOut,
    ReturnEvidenceUploadInfo,
    ReturnEvidenceUploadLink,
    ReturnLookup,
    ReturnOut,
    ReturnStatusUpdate,
)
from app.services.return_evidence import ReturnEvidenceService
from app.services.returns import ReturnService
from app.services.common import retry_on_deadlock

router = APIRouter(prefix="/returns", tags=["returns"])
SP = require_roles(Role.SALES_PERSON)
BM_SM = require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER)

DAMAGE_TYPES = [
    "damaged",
    "expired",
    "wrong_product",
    "manufacturing_defect",
    "billing_error",
    "quality_issue",
    "customer_changed_mind",
    "delivery_issue",
    "other",
]


@router.get("/damage-types")
async def damage_types(user=Depends(get_current_user)):
    return {"damage_types": DAMAGE_TYPES}


@router.post("/lookup", response_model=InvoiceOut)
async def lookup(payload: ReturnLookup, db: AsyncSession = Depends(get_db), user=Depends(SP)):
    inv_repo = InvoiceRepository(db)
    if payload.invoice_number:
        obj = await inv_repo.get_by_number(payload.invoice_number)
        if obj and obj.business_profile_id == user.business_profile_id and obj.outlet_id == user.outlet_id:
            return obj
    if payload.barcode:
        product = await ProductRepository(db).get_by_barcode(
            payload.barcode,
            business_profile_id=user.business_profile_id,
        )
        if product:
            obj = await inv_repo.latest_sale_containing_product(
                product_id=product.id,
                outlet_id=user.outlet_id,
                business_profile_id=user.business_profile_id,
            )
            if obj:
                return obj
    raise NotFoundError("No matching invoice found")


@router.post("", response_model=ReturnOut, status_code=201)
@retry_on_deadlock()
async def submit_return(payload: ReturnCreate, db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(SP)):
    return await ReturnService(db, user).submit(payload)


@router.get("", response_model=list[ReturnOut])
async def list_returns(
    pagination: PaginationParams = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    repo = ReturnRepository(db)
    if user.role == Role.SALES_PERSON:
        return await repo.list(
            skip=pagination.skip,
            limit=pagination.limit,
            staff_id=user.id,
            business_profile_id=user.business_profile_id,
        )
    if user.role == Role.SALES_MANAGER:
        managed_staff_ids = (
            await db.execute(
                select(Staff.id).where(
                    Staff.business_profile_id == user.business_profile_id,
                    Staff.manager_id == user.id,
                    Staff.is_active.is_(True),
                )
            )
        ).scalars().all()
        return await repo.list(
            skip=pagination.skip,
            limit=pagination.limit,
            staff_ids=list(managed_staff_ids),
            business_profile_id=user.business_profile_id,
        )
    return await repo.list(
        skip=pagination.skip,
        limit=pagination.limit,
        business_profile_id=user.business_profile_id,
    )


@router.get("/{rid}", response_model=ReturnOut)
async def get_return(rid: int, db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    return await ReturnService(db, user).get_visible(rid)


@router.post("/{rid}/evidence-link", response_model=ReturnEvidenceUploadLink)
async def create_evidence_link(
    rid: int,
    request: Request,
    api_base: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    ret = await ReturnService(db, user).get_visible(rid)
    token, expires_at = await ReturnEvidenceService(db).create_upload_link(
        ret,
        business_profile_id=user.business_profile_id,
    )
    return ReturnEvidenceUploadLink(
        return_id=ret.id,
        return_number=ret.return_number,
        upload_url=ReturnEvidenceService.public_url(
            token,
            api_base=api_base,
            frontend_base=request.headers.get("origin"),
        ),
        expires_at=expires_at,
    )


@router.get("/{rid}/evidence", response_model=list[ReturnEvidenceOut])
async def list_evidence(
    rid: int,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    await ReturnService(db, user).get_visible(rid)
    return await ReturnEvidenceService(db).list_for_return(
        rid,
        business_profile_id=user.business_profile_id,
    )


@router.patch("/{rid}/status", response_model=ReturnOut)
@retry_on_deadlock()
async def set_status(rid: int, payload: ReturnStatusUpdate, db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(BM_SM)):
    return await ReturnService(db, user).set_status(rid, payload.status)


@router.post("/{rid}/process", response_model=ReturnOut)
@retry_on_deadlock()
async def process_return(rid: int, inter_state: bool = False, db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(require_roles(Role.BRANCH_MANAGER))):
    return await ReturnService(db, user).process(rid, inter_state)


@router.get("/public/evidence/{token}", response_model=ReturnEvidenceUploadInfo)
async def public_evidence_info(token: str, db: AsyncSession = Depends(get_db)):
    ret, expires_at = await ReturnEvidenceService(db).get_upload_info(token)
    return ReturnEvidenceUploadInfo(
        return_id=ret.id,
        return_number=ret.return_number,
        status=ret.status,
        expires_at=expires_at,
        max_upload_bytes=settings.MAX_UPLOAD_BYTES,
    )


@router.post("/public/evidence/{token}", response_model=ReturnEvidenceOut, status_code=201)
async def public_evidence_upload(
    token: str,
    file: UploadFile = File(...),
    note: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
):
    evidence = await ReturnEvidenceService(db).save_public_upload(token, file, note)
    await db.commit()
    return evidence
