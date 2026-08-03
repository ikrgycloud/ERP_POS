from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from app.api.deps import ErpPrincipal, ensure_outlet_record_access, get_erp_principal
from app.audit import record_audit
from app.database import get_db
from app.models import Invoice, Order, OrderItem, Waybill
from app.services import invoice_total
from app.schemas import ApiMessage, WaybillOut, WaybillUpdate

router = APIRouter(prefix="/waybills", tags=["Waybills"])


def serialize_waybill(waybill: Waybill) -> WaybillOut:
    now = datetime.now(timezone.utc)
    valid_until = waybill.valid_until
    remaining_hours = max(0, int((valid_until - now).total_seconds() // 3600)) if valid_until else 0
    expired = bool(valid_until and valid_until <= now)
    invoice = waybill.invoice
    order = invoice.order if invoice and invoice.order else None
    order_items = []
    order_taxable_value = 0
    order_tax_value = 0
    order_grand_total = 0
    if order:
        order_items = [
            {
                "id": item.id,
                "product_id": item.product_id,
                "quantity": item.quantity,
                "unit_type": item.unit_type,
                "unit_label": item.unit_label,
                "package_count": item.package_count,
                "package_size": item.package_size,
                "package_size_unit": item.package_size_unit,
                "rate": item.rate,
                "gst_rate": item.gst_rate,
                "product_name": item.product.name if item.product else None,
                "sku": item.product.sku if item.product else None,
            }
            for item in order.items
        ]
        order_taxable_value = float(sum((item.quantity or 0) * item.rate for item in order.items))
        order_tax_value = float(sum(((item.quantity or 0) * item.rate * item.gst_rate) / 100 for item in order.items))
        order_grand_total = float(invoice_total(invoice)) if invoice else float(order_taxable_value + order_tax_value)
    return WaybillOut.model_validate(
        {
            "id": waybill.id,
            "waybill_number": waybill.waybill_number,
            "invoice_id": waybill.invoice_id,
            "invoice_number": invoice.invoice_number if invoice else None,
            "party_name": invoice.party_name if invoice else None,
            "invoice_direction": invoice.invoice_direction if invoice else None,
            "order_id": order.id if order else None,
            "order_number": order.order_number if order else None,
            "order_type": order.type if order else None,
            "order_party_type": order.party_type if order else None,
            "order_party_name": order.party_name if order else None,
            "order_status": order.status if order else None,
            "order_payment_status": order.payment_status if order else None,
            "order_date": order.date if order else None,
            "order_taxable_value": order_taxable_value,
            "order_tax_value": order_tax_value,
            "order_grand_total": order_grand_total,
            "order_items": order_items,
            "transport_mode": waybill.transport_mode,
            "vehicle_number": waybill.vehicle_number,
            "from_name": waybill.from_name,
            "to_name": waybill.to_name,
            "generated_at": waybill.generated_at,
            "valid_until": waybill.valid_until,
            "status": "Expired" if expired else waybill.status,
            "is_expired": expired,
            "remaining_hours": remaining_hours,
        }
    )


@router.get("", response_model=list[WaybillOut])
def list_waybills(
    search: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    invoice_id: int | None = Query(default=None, alias="invoiceId"),
    start_date: date | None = Query(default=None, alias="startDate"),
    end_date: date | None = Query(default=None, alias="endDate"),
    cursor: int | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> list[WaybillOut]:
    query = db.query(Waybill).join(Invoice).options(
        selectinload(Waybill.invoice)
        .selectinload(Invoice.order)
        .selectinload(Order.items)
        .selectinload(OrderItem.product),
        selectinload(Waybill.invoice).selectinload(Invoice.order),
    )
    query = query.filter(Invoice.business_profile_id == principal.business_profile_id)
    if principal.is_outlet:
        query = query.filter(Invoice.outlet_id == principal.outlet_id)
    query = query.filter(Waybill.status != "Deleted")
    if search:
        pattern = f"%{search}%"
        query = query.filter(
            or_(
                Waybill.waybill_number.ilike(pattern),
                Invoice.invoice_number.ilike(pattern),
                Invoice.party_name.ilike(pattern),
                Waybill.transport_mode.ilike(pattern),
                Waybill.vehicle_number.ilike(pattern),
                Waybill.from_name.ilike(pattern),
                Waybill.to_name.ilike(pattern),
            )
        )
    if invoice_id:
        query = query.filter(Waybill.invoice_id == invoice_id)
    if start_date:
        query = query.filter(func.date(Waybill.generated_at) >= start_date)
    if end_date:
        query = query.filter(func.date(Waybill.generated_at) <= end_date)
    if status_filter and status_filter != "All":
        if status_filter == "Expired":
            query = query.filter(Waybill.valid_until <= datetime.now(timezone.utc))
        else:
            query = query.filter(Waybill.status == status_filter)
    if cursor is not None:
        records = query.filter(Waybill.id < cursor).order_by(Waybill.id.desc()).limit(limit).all()
        return [serialize_waybill(waybill) for waybill in records]
    records = query.order_by(Waybill.generated_at.desc(), Waybill.id.desc()).offset(skip).limit(limit).all()
    return [serialize_waybill(waybill) for waybill in records]


@router.put("/{waybill_id}", response_model=WaybillOut)
def update_waybill(
    waybill_id: int,
    payload: WaybillUpdate,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> WaybillOut:
    waybill = db.get(Waybill, waybill_id)
    if not waybill:
        raise HTTPException(status_code=404, detail="Waybill not found")
    if waybill.invoice.business_profile_id != principal.business_profile_id:
        raise HTTPException(status_code=404, detail="Waybill not found")
    ensure_outlet_record_access(waybill.invoice.outlet_id, principal)
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(waybill, key, value)
    db.flush()
    record_audit(db, action="update", entity_type="waybill", entity_id=waybill.id, details=changes)
    db.commit()
    db.refresh(waybill)
    return serialize_waybill(waybill)


@router.delete("/{waybill_id}", response_model=ApiMessage)
def delete_waybill(
    waybill_id: int,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> ApiMessage:
    waybill = db.get(Waybill, waybill_id)
    if not waybill:
        raise HTTPException(status_code=404, detail="Waybill not found")
    if waybill.invoice.business_profile_id != principal.business_profile_id:
        raise HTTPException(status_code=404, detail="Waybill not found")
    ensure_outlet_record_access(waybill.invoice.outlet_id, principal)
    record_audit(db, action="delete", entity_type="waybill", entity_id=waybill.id, details={"waybillNumber": waybill.waybill_number})
    waybill.status = "Deleted"
    db.commit()
    return ApiMessage(message="Waybill deleted")
