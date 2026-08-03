import shutil
import logging
from pathlib import Path
from urllib.parse import quote

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, RedirectResponse, Response
from sqlalchemy import func
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session
import uuid

from app.api.deps import ErpPrincipal, get_business_profile_id, get_erp_principal
from app.audit import record_audit
from app.config import get_settings
from app.database import get_db
from app.models import BusinessProfile, Outlet, Staff
from app.schemas import (
    AdminRegisterCreate,
    BusinessProfileCreate,
    BusinessProfileOut,
    BusinessProfileUpdate,
    LoginRequest,
    LoginResponse,
    OutletCreate,
    OutletOut,
    OutletUpdate,
    PosStaffCreate,
    PosStaffOut,
)
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/business-profile", tags=["Business Profile"])
logger = logging.getLogger("erp.business_registration")

ADMIN_ROLE = "admin"
OUTLET_ROLE = "outlet"


def scrub_sensitive_fields(payload: dict) -> dict:
    redacted = dict(payload)
    for key in ("password", "password_hash", "access_code"):
        redacted.pop(key, None)
    return redacted


def _require_profile_access(
    profile_id: int,
    principal: ErpPrincipal,
    *,
    admin_required: bool = False,
) -> None:
    if principal.business_profile_id != profile_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")
    if admin_required and principal.role != ADMIN_ROLE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")


@router.get("", response_model=BusinessProfileOut | None)
def get_business_profile(
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> BusinessProfile | None:
    if business_profile_id is not None:
        return db.get(BusinessProfile, business_profile_id)
    return db.query(BusinessProfile).order_by(BusinessProfile.id.asc()).first()


@router.post("", response_model=BusinessProfileOut, status_code=status.HTTP_201_CREATED)
def create_business_profile(
    payload: BusinessProfileCreate, db: Session = Depends(get_db)
) -> BusinessProfile:
    existing = db.query(BusinessProfile).first()
    if existing:
        raise HTTPException(status_code=400, detail="Business profile already exists")
    data = payload.model_dump()
    if data.pop("role", ADMIN_ROLE) != ADMIN_ROLE:
        raise HTTPException(status_code=400, detail="The first profile must be created as admin")
    access_code = data.pop("access_code", None) or f"ADM-{uuid.uuid4().hex[:8].upper()}"
    password = data.pop("password")
    profile = BusinessProfile(
        **data,
        role=ADMIN_ROLE,
        access_code=access_code,
        password_hash=hash_password(password),
    )
    db.add(profile)
    db.flush()
    record_audit(
        db,
        action="create",
        entity_type="business_profile",
        entity_id=profile.id,
        details=scrub_sensitive_fields(payload.model_dump()),
    )
    db.commit()
    db.refresh(profile)
    return profile


@router.post("/register-admin", response_model=BusinessProfileOut, status_code=status.HTTP_201_CREATED)
def register_admin(payload: AdminRegisterCreate, db: Session = Depends(get_db)) -> BusinessProfile:
    settings = get_settings()
    if payload.register_key != settings.register_key:
        raise HTTPException(status_code=403, detail="Invalid registration key")

    data = payload.model_dump()
    data.pop("register_key", None)
    if data.pop("role", ADMIN_ROLE) != ADMIN_ROLE:
        raise HTTPException(status_code=400, detail="Admin role is required")

    data["email"] = data["email"].strip().lower()
    if db.query(BusinessProfile).filter(func.lower(BusinessProfile.email) == data["email"]).first():
        raise HTTPException(status_code=400, detail="Admin email already exists")

    access_code = data.pop("access_code", None) or f"ADM-{uuid.uuid4().hex[:8].upper()}"
    password = data.pop("password")
    try:
        profile = BusinessProfile(
            **data,
            role=ADMIN_ROLE,
            access_code=access_code,
            password_hash=hash_password(password),
        )
        db.add(profile)
        db.flush()
        record_audit(
            db,
            action="register_admin",
            entity_type="business_profile",
            entity_id=profile.id,
            business_profile_id=profile.id,
            details=scrub_sensitive_fields(payload.model_dump()),
        )
        db.commit()
        db.refresh(profile)
        return profile
    except IntegrityError as exc:
        db.rollback()
        logger.info("event=admin_registration_conflict email=%s", data["email"])
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This business profile could not be created because one of its unique details already exists.",
        ) from exc
    except DataError as exc:
        db.rollback()
        logger.info("event=admin_registration_invalid_data email=%s", data["email"])
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="One or more business details exceed the allowed length. Please shorten the value and try again.",
        ) from exc
    except Exception as exc:
        db.rollback()
        logger.exception("event=admin_registration_failed email=%s", data["email"])
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Registration could not be completed. Please verify the business details and try again.",
        ) from exc


def _build_s3_object_url(bucket: str, region: str, key: str) -> str:
    escaped_key = quote(key)
    if region == "us-east-1":
        return f"https://{bucket}.s3.amazonaws.com/{escaped_key}"
    return f"https://{bucket}.s3.{region}.amazonaws.com/{escaped_key}"


def _logo_placeholder(profile: BusinessProfile | None = None) -> Response:
    label = ((profile.trade_name if profile else None) or (profile.logo_text if profile else None) or "ERP").strip()
    label = "".join(character for character in label.upper() if character.isalnum())[:3] or "ERP"
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
  <rect width="160" height="160" rx="32" fill="#E8F2ED"/>
  <text x="80" y="92" text-anchor="middle" font-family="Calibri, Arial, sans-serif" font-size="42" font-weight="700" fill="#32584D">{label}</text>
</svg>"""
    return Response(content=svg, media_type="image/svg+xml")


@router.post("/{profile_id}/logo", response_model=BusinessProfileOut)
def upload_business_logo(
    profile_id: int,
    logo: UploadFile = File(...),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> BusinessProfile:
    _require_profile_access(profile_id, principal, admin_required=True)
    profile = db.get(BusinessProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Business profile not found")

    extension = Path(logo.filename or "").suffix.lower()
    if extension not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(status_code=400, detail="Logo must be JPG, PNG, or WEBP")
    if logo.size is not None and logo.size > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Logo size must not exceed 5 MB")

    settings = get_settings()
    bucket_name = settings.aws_s3_bucket_name
    region = settings.aws_region
    access_key = settings.aws_access_key_id
    secret_key = settings.aws_secret_access_key

    file_name = f"business-{profile_id}-{uuid.uuid4().hex[:8]}{extension}"
    object_key = f"logos/{file_name}"

    if bucket_name and region and access_key and secret_key:
        try:
            s3 = boto3.client(
                "s3",
                region_name=region,
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key,
            )
            s3.upload_fileobj(
                logo.file,
                bucket_name,
                object_key,
                ExtraArgs={"ContentType": logo.content_type or "application/octet-stream"},
            )
        except (BotoCoreError, ClientError) as exc:
            raise HTTPException(status_code=500, detail="Failed to upload logo to S3") from exc

        profile.logo_path = object_key
        profile.logo_url = f"/api/v1/business-profile/{profile_id}/logo-file?v={uuid.uuid4().hex[:8]}"
    else:
        upload_root = Path(settings.upload_dir)
        if not upload_root.is_absolute():
            upload_root = Path(__file__).resolve().parents[2] / upload_root
        logo_dir = upload_root / "logos"
        logo_dir.mkdir(parents=True, exist_ok=True)
        destination = logo_dir / file_name
        with destination.open("wb") as output:
            shutil.copyfileobj(logo.file, output)

        profile.logo_path = str(destination)
        profile.logo_url = f"/api/v1/business-profile/{profile_id}/logo-file?v={uuid.uuid4().hex[:8]}"

    db.flush()
    record_audit(
        db,
        action="upload_logo",
        entity_type="business_profile",
        entity_id=profile.id,
        details={"logoUrl": profile.logo_url},
    )
    db.commit()
    db.refresh(profile)
    return profile


@router.get("/{profile_id}/logo-file")
def get_business_logo_file(profile_id: int, db: Session = Depends(get_db)):
    profile = db.get(BusinessProfile, profile_id)
    if not profile or not profile.logo_path:
        return _logo_placeholder(profile)

    settings = get_settings()
    bucket_name = settings.aws_s3_bucket_name
    region = settings.aws_region
    access_key = settings.aws_access_key_id
    secret_key = settings.aws_secret_access_key

    if bucket_name and region and access_key and secret_key and not str(profile.logo_path).startswith(("/", "\\")):
        try:
            s3 = boto3.client(
                "s3",
                region_name=region,
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key,
            )
            signed_url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket_name, "Key": profile.logo_path},
                ExpiresIn=3600,
            )
            return RedirectResponse(signed_url)
        except (BotoCoreError, ClientError):
            return _logo_placeholder(profile)

    local_path = Path(profile.logo_path)
    if not local_path.exists():
        upload_root = Path(settings.upload_dir)
        if not upload_root.is_absolute():
            upload_root = Path(__file__).resolve().parents[2] / upload_root
        local_path = upload_root / "logos" / Path(profile.logo_path).name
    if not local_path.exists():
        return _logo_placeholder(profile)
    return FileResponse(local_path)


@router.put("/{profile_id}", response_model=BusinessProfileOut)
def update_business_profile(
    profile_id: int,
    payload: BusinessProfileUpdate,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> BusinessProfile:
    _require_profile_access(profile_id, principal, admin_required=True)
    profile = db.get(BusinessProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Business profile not found")
    data = payload.model_dump()
    if data.pop("role", ADMIN_ROLE) != ADMIN_ROLE:
        raise HTTPException(status_code=400, detail="Business profile role cannot be changed")
    access_code = data.pop("access_code", None)
    password = data.pop("password", None)
    for key, value in data.items():
        setattr(profile, key, value)
    profile.role = ADMIN_ROLE
    if access_code is not None:
        profile.access_code = access_code
    if password:
        profile.password_hash = hash_password(password)
    db.flush()
    record_audit(
        db,
        action="update",
        entity_type="business_profile",
        entity_id=profile.id,
        details=scrub_sensitive_fields(payload.model_dump()),
    )
    db.commit()
    db.refresh(profile)
    return profile


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    profile = db.query(BusinessProfile).filter(BusinessProfile.email == payload.email).first()
    if profile and profile.role == ADMIN_ROLE and verify_password(payload.password, profile.password_hash):
        access_token = create_access_token(
            {
                "sub": f"business:{profile.id}",
                "business_profile_id": profile.id,
                "role": ADMIN_ROLE,
                "email": profile.email,
            }
        )
        return LoginResponse(
            message="Login successful",
            role=ADMIN_ROLE,
            business_profile=profile,
            access_token=access_token,
        )

    outlet = db.query(Outlet).filter(Outlet.email == payload.email, Outlet.is_active.is_(True)).first()
    if outlet and verify_password(payload.password, outlet.password_hash):
        business_profile = db.get(BusinessProfile, outlet.business_profile_id)
        if not business_profile:
            raise HTTPException(status_code=404, detail="Business profile not found")
        access_token = create_access_token(
            {
                "sub": f"outlet:{outlet.id}",
                "business_profile_id": business_profile.id,
                "outlet_id": outlet.id,
                "role": OUTLET_ROLE,
                "email": outlet.email,
            }
        )
        return LoginResponse(
            message="Login successful",
            role=OUTLET_ROLE,
            business_profile=business_profile,
            outlet=outlet,
            access_token=access_token,
        )

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")


@router.get("/{profile_id}/outlets", response_model=list[OutletOut])
def list_outlets(
    profile_id: int,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> list[Outlet]:
    _require_profile_access(profile_id, principal)
    profile = db.get(BusinessProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Business profile not found")
    return (
        db.query(Outlet)
        .filter(Outlet.business_profile_id == profile_id, Outlet.is_active.is_(True))
        .order_by(Outlet.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/{profile_id}/pos-staff", response_model=list[PosStaffOut])
def list_pos_staff(
    profile_id: int,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> list[Staff]:
    _require_profile_access(profile_id, principal, admin_required=True)
    return (
        db.query(Staff)
        .filter(Staff.business_profile_id == profile_id)
        .order_by(Staff.is_active.desc(), Staff.full_name.asc())
        .all()
    )


@router.post("/{profile_id}/pos-staff", response_model=PosStaffOut, status_code=status.HTTP_201_CREATED)
def create_pos_staff(
    profile_id: int,
    payload: PosStaffCreate,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> Staff:
    _require_profile_access(profile_id, principal, admin_required=True)
    outlet = db.get(Outlet, payload.outlet_id)
    if not outlet or outlet.business_profile_id != profile_id or not outlet.is_active:
        raise HTTPException(status_code=400, detail="Choose an active outlet in this business")
    if db.query(Staff).filter(Staff.employee_code == payload.employee_code).first():
        raise HTTPException(status_code=400, detail="Employee code already exists")
    staff = Staff(
        business_profile_id=profile_id,
        outlet_id=outlet.id,
        role=payload.role,
        employee_code=payload.employee_code,
        full_name=payload.full_name.strip(),
        phone=payload.phone.strip() if payload.phone else None,
        email=payload.email.strip().lower() if payload.email else None,
        password_hash=hash_password(payload.password),
        is_active=True,
    )
    db.add(staff)
    db.flush()
    record_audit(
        db,
        action="create",
        entity_type="pos_staff",
        entity_id=staff.id,
        details={"employeeCode": staff.employee_code, "outletId": staff.outlet_id, "role": staff.role},
    )
    db.commit()
    db.refresh(staff)
    return staff


@router.post("/{profile_id}/outlets", response_model=OutletOut, status_code=status.HTTP_201_CREATED)
def create_outlet(
    profile_id: int,
    payload: OutletCreate,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> Outlet:
    _require_profile_access(profile_id, principal, admin_required=True)
    profile = db.get(BusinessProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Business profile not found")
    if profile.role != ADMIN_ROLE:
        raise HTTPException(status_code=403, detail="Only admin can create outlets")
    data = payload.model_dump()
    if data.pop("role", OUTLET_ROLE) != OUTLET_ROLE:
        raise HTTPException(status_code=400, detail="Outlet role must be outlet")
    password = data.pop("password", None)
    if not password:
        raise HTTPException(status_code=400, detail="Outlet password is required")
    access_code = data.pop("access_code", None) or f"OUT-{uuid.uuid4().hex[:8].upper()}"
    outlet = Outlet(
        business_profile_id=profile_id,
        role=OUTLET_ROLE,
        access_code=access_code,
        password_hash=hash_password(password),
        **data,
    )
    db.add(outlet)
    db.flush()
    record_audit(
        db,
        action="create",
        entity_type="outlet",
        entity_id=outlet.id,
        details=scrub_sensitive_fields(payload.model_dump()),
    )
    db.commit()
    db.refresh(outlet)
    return outlet


@router.put("/{profile_id}/outlets/{outlet_id}", response_model=OutletOut)
def update_outlet(
    profile_id: int,
    outlet_id: int,
    payload: OutletUpdate,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> Outlet:
    _require_profile_access(profile_id, principal, admin_required=True)
    outlet = db.get(Outlet, outlet_id)
    if not outlet or outlet.business_profile_id != profile_id:
        raise HTTPException(status_code=404, detail="Outlet not found")
    data = payload.model_dump()
    if data.pop("role", OUTLET_ROLE) != OUTLET_ROLE:
        raise HTTPException(status_code=400, detail="Outlet role cannot be changed")
    access_code = data.pop("access_code", None)
    password = data.pop("password", None)
    for key, value in data.items():
        setattr(outlet, key, value)
    outlet.role = OUTLET_ROLE
    if access_code is not None:
        outlet.access_code = access_code
    if password:
        outlet.password_hash = hash_password(password)
    db.flush()
    record_audit(
        db,
        action="update",
        entity_type="outlet",
        entity_id=outlet.id,
        details=scrub_sensitive_fields(payload.model_dump()),
    )
    db.commit()
    db.refresh(outlet)
    return outlet


@router.delete("/{profile_id}/outlets/{outlet_id}", response_model=dict[str, str])
def delete_outlet(
    profile_id: int,
    outlet_id: int,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    _require_profile_access(profile_id, principal, admin_required=True)
    outlet = db.get(Outlet, outlet_id)
    if not outlet or outlet.business_profile_id != profile_id:
        raise HTTPException(status_code=404, detail="Outlet not found")
    record_audit(db, action="delete", entity_type="outlet", entity_id=outlet.id, details={"outletCode": outlet.outlet_code})
    outlet.is_active = False
    db.commit()
    return {"message": "Outlet deleted"}
