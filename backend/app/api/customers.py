from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import ErpPrincipal, apply_created_range, get_business_profile_id, get_erp_principal
from app.audit import record_audit
from app.database import get_db
from app.models import BusinessProfile, Customer, Outlet
from app.schemas import ApiMessage, CustomerCreate, CustomerOut, CustomerUpdate

router = APIRouter(prefix="/business-profile/{profile_id}/outlets/{outlet_id}/customers", tags=["Customers"])


def get_authorized_outlet_or_404(
    profile_id: int,
    outlet_id: int,
    business_profile_id: int,
    principal: ErpPrincipal,
    db: Session,
) -> Outlet:
    if business_profile_id != profile_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant access denied")
    if principal.outlet_id is not None and principal.outlet_id != outlet_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Outlet access denied")

    profile = db.get(BusinessProfile, business_profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Business profile not found")
    outlet = (
        db.query(Outlet)
        .filter(
            Outlet.id == outlet_id,
            Outlet.business_profile_id == business_profile_id,
            Outlet.is_active.is_(True),
        )
        .first()
    )
    if not outlet:
        raise HTTPException(status_code=404, detail="Outlet not found")
    return outlet


def get_authorized_customer_or_404(
    customer_id: int,
    outlet_id: int,
    db: Session,
) -> Customer:
    customer = (
        db.query(Customer)
        .filter(
            Customer.id == customer_id,
            Customer.outlet_id == outlet_id,
            Customer.is_active.is_(True),
        )
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


def serialize_customer(customer: Customer) -> CustomerOut:
    return CustomerOut.model_validate(customer)


@router.get("", response_model=list[CustomerOut])
def list_customers(
    profile_id: int,
    outlet_id: int,
    search: str | None = None,
    phone: str | None = None,
    start_date: date | None = Query(default=None, alias="startDate"),
    end_date: date | None = Query(default=None, alias="endDate"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    cursor: int | None = Query(default=None, ge=1),
    business_profile_id: int = Depends(get_business_profile_id),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> list[CustomerOut]:
    outlet = get_authorized_outlet_or_404(profile_id, outlet_id, business_profile_id, principal, db)
    query = db.query(Customer).filter(Customer.outlet_id == outlet_id, Customer.is_active.is_(True))
    query = query.join(Outlet).filter(Outlet.business_profile_id == outlet.business_profile_id)
    query = apply_created_range(query, Customer, start_date, end_date)
    if search:
        pattern = f"%{search}%"
        query = query.filter(or_(Customer.name.ilike(pattern), Customer.phone.ilike(pattern)))
    if phone:
        query = query.filter(Customer.phone == phone)
    if cursor is not None:
        customers = query.filter(Customer.id < cursor).order_by(Customer.id.desc()).limit(limit).all()
        return [serialize_customer(customer) for customer in customers]
    customers = query.order_by(Customer.created_at.desc()).offset(skip).limit(limit).all()
    return [serialize_customer(customer) for customer in customers]


@router.get("/{customer_id}", response_model=CustomerOut)
def get_customer(
    profile_id: int,
    outlet_id: int,
    customer_id: int,
    business_profile_id: int = Depends(get_business_profile_id),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> CustomerOut:
    get_authorized_outlet_or_404(profile_id, outlet_id, business_profile_id, principal, db)
    customer = get_authorized_customer_or_404(customer_id, outlet_id, db)
    return serialize_customer(customer)


@router.post("", response_model=CustomerOut, status_code=status.HTTP_201_CREATED)
def create_customer(
    profile_id: int,
    outlet_id: int,
    payload: CustomerCreate,
    business_profile_id: int = Depends(get_business_profile_id),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> CustomerOut:
    outlet = get_authorized_outlet_or_404(profile_id, outlet_id, business_profile_id, principal, db)
    customer = Customer(outlet_id=outlet.id, **payload.model_dump())
    db.add(customer)
    try:
        db.flush()
        record_audit(
            db,
            action="create",
            entity_type="customer",
            entity_id=customer.id,
            details=payload.model_dump(),
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Customer phone already exists for this outlet") from exc
    db.refresh(customer)
    return serialize_customer(customer)


@router.put("/{customer_id}", response_model=CustomerOut)
def update_customer(
    profile_id: int,
    outlet_id: int,
    customer_id: int,
    payload: CustomerUpdate,
    business_profile_id: int = Depends(get_business_profile_id),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> CustomerOut:
    get_authorized_outlet_or_404(profile_id, outlet_id, business_profile_id, principal, db)
    customer = get_authorized_customer_or_404(customer_id, outlet_id, db)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(customer, key, value)
    try:
        db.flush()
        record_audit(
            db,
            action="update",
            entity_type="customer",
            entity_id=customer.id,
            details=payload.model_dump(),
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Customer phone already exists for this outlet") from exc
    db.refresh(customer)
    return serialize_customer(customer)


@router.delete("/{customer_id}", response_model=ApiMessage)
def delete_customer(
    profile_id: int,
    outlet_id: int,
    customer_id: int,
    business_profile_id: int = Depends(get_business_profile_id),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> ApiMessage:
    get_authorized_outlet_or_404(profile_id, outlet_id, business_profile_id, principal, db)
    customer = get_authorized_customer_or_404(customer_id, outlet_id, db)
    record_audit(
        db,
        action="delete",
        entity_type="customer",
        entity_id=customer.id,
        details={"phone": customer.phone, "outletId": outlet_id},
    )
    customer.is_active = False
    db.commit()
    return ApiMessage(message="Customer deleted")
