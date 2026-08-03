from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_business_profile_id
from app.audit import record_audit
from app.database import get_db
from app.models import Category, Supplier
from app.schemas import CategoryCreate, CategoryOut, SupplierCreate, SupplierOut, SupplierUpdate

router = APIRouter(tags=["Masters"])


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(
    search: str | None = None,
    active_only: bool = Query(default=True, alias="activeOnly"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    cursor: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
) -> list[CategoryOut]:
    query = db.query(Category)
    if active_only:
        query = query.filter(Category.is_active.is_(True))
    if search:
        query = query.filter(Category.name.ilike(f"%{search}%"))
    if cursor is not None:
        return query.filter(Category.id < cursor).order_by(Category.id.desc()).limit(limit).all()
    return query.order_by(Category.name.asc()).offset(skip).limit(limit).all()


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryCreate,
    business_profile_id: int = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> CategoryOut:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required")
    existing = db.query(Category).filter(Category.name.ilike(name)).first()
    if existing:
        return existing
    category_data = payload.model_dump()
    category_data["name"] = name
    category = Category(**category_data)
    db.add(category)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        existing = db.query(Category).filter(Category.name.ilike(name)).first()
        if existing:
            return existing
        raise
    record_audit(db, action="create", entity_type="category", entity_id=category.id, details=payload.model_dump())
    db.commit()
    db.refresh(category)
    return category


@router.get("/suppliers", response_model=list[SupplierOut])
def list_suppliers(
    search: str | None = None,
    active_only: bool = Query(default=True, alias="activeOnly"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    cursor: int | None = Query(default=None, ge=1),
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> list[SupplierOut]:
    query = db.query(Supplier)
    if business_profile_id is not None:
        query = query.filter(or_(Supplier.business_profile_id == business_profile_id, Supplier.business_profile_id.is_(None)))
    if active_only:
        query = query.filter(Supplier.is_active.is_(True))
    if search:
        pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Supplier.name.ilike(pattern),
                Supplier.phone.ilike(pattern),
                Supplier.mobile.ilike(pattern),
                Supplier.email.ilike(pattern),
            )
        )
    if cursor is not None:
        return query.filter(Supplier.id < cursor).order_by(Supplier.id.desc()).limit(limit).all()
    return query.order_by(Supplier.name.asc()).offset(skip).limit(limit).all()


@router.post("/suppliers", response_model=SupplierOut, status_code=status.HTTP_201_CREATED)
def create_supplier(
    payload: SupplierCreate,
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> SupplierOut:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Supplier name is required")
    query = db.query(Supplier).filter(Supplier.name.ilike(name))
    if business_profile_id is not None:
        query = query.filter(Supplier.business_profile_id == business_profile_id)
    existing = query.first()
    if existing:
        return existing
    supplier_data = payload.model_dump()
    supplier_data["name"] = name
    supplier_data["business_profile_id"] = business_profile_id
    supplier = Supplier(**supplier_data)
    db.add(supplier)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        existing = query.first()
        if existing:
            return existing
        raise
    record_audit(db, action="create", entity_type="supplier", entity_id=supplier.id, details=payload.model_dump())
    db.commit()
    db.refresh(supplier)
    return supplier


@router.put("/suppliers/{supplier_id}", response_model=SupplierOut)
def update_supplier(
    supplier_id: int,
    payload: SupplierUpdate,
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> SupplierOut:
    query = db.query(Supplier).filter(Supplier.id == supplier_id)
    if business_profile_id is not None:
        query = query.filter(Supplier.business_profile_id == business_profile_id)
    supplier = query.first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Supplier name is required")
    duplicate = db.query(Supplier).filter(
        Supplier.id != supplier_id,
        Supplier.name.ilike(name),
    )
    if business_profile_id is not None:
        duplicate = duplicate.filter(Supplier.business_profile_id == business_profile_id)
    if duplicate.first():
        raise HTTPException(status_code=409, detail="A supplier with this name already exists")

    supplier_data = payload.model_dump()
    supplier_data["name"] = name
    for field, value in supplier_data.items():
        setattr(supplier, field, value)
    record_audit(db, action="update", entity_type="supplier", entity_id=supplier.id, details=supplier_data)
    db.commit()
    db.refresh(supplier)
    return supplier
