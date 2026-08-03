from datetime import datetime, timezone
import logging
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import ErpPrincipal, ensure_outlet_record_access, get_erp_principal, resolve_outlet_scope
from app.audit import record_audit
from app.database import get_db
from app.models import NotificationOutbox, SupplierReturn, WorkflowStatus
from app.notification_outbox import (
    CHANNEL_EMAIL,
    CHANNEL_EVENT,
    CHANNEL_SMS,
    EVENT_RTV_CREATED,
    EVENT_RTV_DISPATCHED,
    enqueue_notification,
    enqueue_supplier_return_notification,
)
from app.repositories.reverse_logistics import SqlAlchemyReverseLogisticsRepository
from app.reverse_logistics_service import (
    CreateSupplierReturnCommand,
    ReverseLogisticsError,
    ReverseLogisticsService,
    ShipmentCommand,
    SupplierReturnLineCommand,
)
from app.rtv_pdf import build_rtv_pdf
from app.schemas import SupplierReturnCreate, SupplierReturnDispatch, SupplierReturnOut

router = APIRouter(prefix="/supplier-returns", tags=["Supplier Returns"])
logger = logging.getLogger("erp-backend")


DEFAULT_WORKFLOW_STATUSES = [
    ("supplier_return", "draft", "Draft", 10, True, False, ["pending_approval", "shipped", "cancelled"]),
    ("supplier_return", "pending_approval", "Pending Approval", 20, False, False, ["approved", "rejected"]),
    ("supplier_return", "approved", "Approved", 30, False, False, ["ready_for_shipment", "shipped", "cancelled"]),
    ("supplier_return", "ready_for_shipment", "Ready for Shipment", 40, False, False, ["shipped", "cancelled"]),
    ("supplier_return", "shipped", "Shipped", 50, False, False, ["supplier_received", "closed"]),
    ("supplier_return", "supplier_received", "Supplier Received", 60, False, False, ["closed"]),
    ("supplier_return", "closed", "Closed", 100, False, True, []),
    ("supplier_return", "cancelled", "Cancelled", 100, False, True, []),
    ("supplier_return", "rejected", "Rejected", 100, False, True, []),
    ("supplier_return_item", "pending_inspection", "Pending Inspection", 10, True, False, ["inspection_completed"]),
]


def _ensure_reverse_workflow(db: Session, business_profile_id: int) -> None:
    for module, code, label, sequence, is_initial, is_terminal, allowed_next in DEFAULT_WORKFLOW_STATUSES:
        existing = (
            db.query(WorkflowStatus)
            .filter(
                WorkflowStatus.business_profile_id == business_profile_id,
                WorkflowStatus.module == module,
                WorkflowStatus.code == code,
            )
            .first()
        )
        if existing:
            continue
        db.add(
            WorkflowStatus(
                business_profile_id=business_profile_id,
                module=module,
                code=code,
                label=label,
                sequence=sequence,
                is_initial=is_initial,
                is_terminal=is_terminal,
                is_active=True,
                allowed_next=allowed_next,
            )
        )
    db.flush()


def _next_rtv_number(db: Session, business_profile_id: int) -> str:
    prefix = f"RTV-{business_profile_id}-"
    count = db.query(SupplierReturn).filter(SupplierReturn.business_profile_id == business_profile_id).count()
    return f"{prefix}{count + 1:05d}"


def _notification_status_map(db: Session, supplier_return_ids: list[int]) -> dict[int, dict[str, object]]:
    if not supplier_return_ids:
        return {}
    aggregate_ids = [str(value) for value in supplier_return_ids]
    entries = (
        db.query(NotificationOutbox)
        .filter(
            NotificationOutbox.aggregate_type == "supplier_return",
            NotificationOutbox.aggregate_id.in_(aggregate_ids),
            NotificationOutbox.event_type.in_([EVENT_RTV_CREATED, EVENT_RTV_DISPATCHED]),
        )
        .order_by(NotificationOutbox.updated_at.desc(), NotificationOutbox.id.desc())
        .all()
    )
    result: dict[int, dict[str, object]] = {value: {} for value in supplier_return_ids}
    for entry in entries:
        return_id = int(entry.aggregate_id)
        phase = "dispatched" if entry.event_type == EVENT_RTV_DISPATCHED else "created"
        phase_status = result.setdefault(return_id, {}).setdefault(phase, {"channels": {}})
        if entry.channel == CHANNEL_EVENT:
            if "status" not in phase_status:
                phase_status.update(
                    {
                        "status": entry.status,
                        "updatedAt": entry.updated_at,
                    }
                )
            continue
        channels = phase_status["channels"]
        if entry.channel not in channels:
            channels[entry.channel] = {
                "status": entry.status,
                "attempts": entry.attempts,
                "lastError": entry.last_error,
                "updatedAt": entry.updated_at,
                "sentAt": entry.sent_at,
            }
    return result


def _serialize_supplier_return(supplier_return: SupplierReturn, notifications: dict[str, object] | None = None) -> dict:
    status_code = supplier_return.current_status.code if supplier_return.current_status else "draft"
    items = []
    for item in supplier_return.items or []:
        snapshot = item.product_snapshot or {}
        items.append(
            {
                "id": item.id,
                "damagedInventoryId": item.damaged_inventory_id,
                "productId": item.product_id,
                "productName": snapshot.get("name"),
                "sku": snapshot.get("sku"),
                "quantityRequested": item.quantity_requested,
                "quantityApproved": item.quantity_approved,
                "quantityShipped": item.quantity_shipped,
                "quantitySupplierAccepted": item.quantity_supplier_accepted,
                "quantitySupplierRejected": item.quantity_supplier_rejected,
                "quantityReplaced": item.quantity_replaced,
                "quantityCredited": item.quantity_credited,
                "unitCost": item.unit_cost,
                "reason": item.reason,
                "version": item.version,
            }
        )
    return {
        "id": supplier_return.id,
        "businessProfileId": supplier_return.business_profile_id,
        "supplierId": supplier_return.supplier_id,
        "supplierName": supplier_return.supplier.name if supplier_return.supplier else supplier_return.supplier_snapshot.get("name"),
        "outletId": supplier_return.outlet_id,
        "rtvNumber": supplier_return.rtv_number,
        "status": status_code,
        "approvalStatus": supplier_return.approval_status,
        "shipmentStatus": supplier_return.shipment_status,
        "replacementStatus": supplier_return.replacement_status,
        "creditStatus": supplier_return.credit_status,
        "reason": supplier_return.reason,
        "remarks": supplier_return.remarks,
        "version": supplier_return.version,
        "createdAt": supplier_return.created_at,
        "updatedAt": supplier_return.updated_at,
        "notifications": notifications or {},
        "items": items,
    }


def _get_scoped_supplier_return(
    supplier_return_id: int,
    principal: ErpPrincipal,
    db: Session,
) -> SupplierReturn:
    supplier_return = (
        db.execute(
            select(SupplierReturn)
            .options(
                selectinload(SupplierReturn.items),
                selectinload(SupplierReturn.supplier),
                selectinload(SupplierReturn.current_status),
            )
            .where(
                SupplierReturn.id == supplier_return_id,
                SupplierReturn.business_profile_id == principal.business_profile_id,
            )
        )
        .scalar_one_or_none()
    )
    if not supplier_return:
        raise HTTPException(status_code=404, detail="Supplier return not found")
    ensure_outlet_record_access(supplier_return.outlet_id, principal)
    return supplier_return


@router.get("", response_model=list[SupplierReturnOut])
def list_supplier_returns(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=300),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> list[dict]:
    query = (
        select(SupplierReturn)
                .options(
                    selectinload(SupplierReturn.items),
                    selectinload(SupplierReturn.supplier),
                    selectinload(SupplierReturn.current_status),
                )
                .where(SupplierReturn.business_profile_id == principal.business_profile_id)
                .order_by(SupplierReturn.created_at.desc(), SupplierReturn.id.desc())
                .offset(skip)
                .limit(limit)
    )
    if principal.is_outlet:
        query = query.where(SupplierReturn.outlet_id == principal.outlet_id)
    rows = db.execute(query).scalars().all()
    notification_map = _notification_status_map(db, [row.id for row in rows])
    return [_serialize_supplier_return(row, notification_map.get(row.id)) for row in rows]


@router.post("", response_model=SupplierReturnOut, status_code=status.HTTP_201_CREATED)
def create_supplier_return(
    payload: SupplierReturnCreate,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> dict:
    _ensure_reverse_workflow(db, principal.business_profile_id)
    command = CreateSupplierReturnCommand(
        business_profile_id=principal.business_profile_id,
        supplier_id=payload.supplier_id,
        outlet_id=resolve_outlet_scope(payload.outlet_id, principal),
        rtv_number=_next_rtv_number(db, principal.business_profile_id),
        created_by_staff_id=None,
        reason=payload.reason,
        remarks=payload.remarks,
        lines=tuple(
            SupplierReturnLineCommand(
                damaged_inventory_id=line.damaged_inventory_id,
                product_id=line.product_id,
                quantity=line.quantity,
                reason=line.reason or payload.reason,
            )
            for line in payload.lines
        ),
    )
    try:
        supplier_return = ReverseLogisticsService(SqlAlchemyReverseLogisticsRepository(db)).create_supplier_return(command)
        db.flush()
        record_audit(
            db,
            action="create",
            entity_type="supplier_return",
            entity_id=supplier_return.id,
            details={
                "businessProfileId": principal.business_profile_id,
                "rtvNumber": supplier_return.rtv_number,
            },
        )
        enqueue_supplier_return_notification(db, supplier_return, dispatched=False)
        db.commit()
    except ReverseLogisticsError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        db.rollback()
        raise
    db.refresh(supplier_return)
    logger.info(
        "event=rtv_created supplier_return_id=%s rtv_number=%s business_profile_id=%s",
        supplier_return.id,
        supplier_return.rtv_number,
        principal.business_profile_id,
    )
    logger.info(
        "event=rtv_notification_queued supplier_return_id=%s rtv_number=%s dispatched=false",
        supplier_return.id,
        supplier_return.rtv_number,
    )
    created_return = db.execute(
        select(SupplierReturn)
        .options(
            selectinload(SupplierReturn.items),
            selectinload(SupplierReturn.supplier),
            selectinload(SupplierReturn.current_status),
        )
        .where(SupplierReturn.id == supplier_return.id)
    ).scalar_one()
    notifications = _notification_status_map(db, [created_return.id]).get(created_return.id)
    return _serialize_supplier_return(created_return, notifications)


@router.get("/{supplier_return_id}/notifications")
def get_supplier_return_notification_status(
    supplier_return_id: int,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    _get_scoped_supplier_return(supplier_return_id, principal, db)
    events = _notification_status_map(db, [supplier_return_id]).get(supplier_return_id, {})
    return {"supplierReturnId": supplier_return_id, "events": events}


@router.post(
    "/{supplier_return_id}/notifications/{phase}/{channel}/resend",
    status_code=status.HTTP_202_ACCEPTED,
)
def resend_supplier_return_notification(
    supplier_return_id: int,
    phase: str,
    channel: str,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    if phase not in {"created", "dispatched"}:
        raise HTTPException(status_code=400, detail="Phase must be created or dispatched")
    allowed_channels = {CHANNEL_EMAIL, CHANNEL_SMS} if phase == "created" else {CHANNEL_EMAIL}
    if channel not in allowed_channels:
        raise HTTPException(status_code=400, detail="Dispatched RTV notifications are email-only")
    supplier_return = _get_scoped_supplier_return(supplier_return_id, principal, db)
    dispatched = phase == "dispatched"
    if dispatched and supplier_return.shipment_status != "shipped":
        raise HTTPException(status_code=409, detail="The RTV must be dispatched before sending dispatch email")
    event_type = EVENT_RTV_DISPATCHED if dispatched else EVENT_RTV_CREATED
    outbox = enqueue_notification(
        db,
        event_type=event_type,
        aggregate_type="supplier_return",
        aggregate_id=supplier_return.id,
        business_profile_id=supplier_return.business_profile_id,
        payload={
            "supplierReturnId": supplier_return.id,
            "rtvNumber": supplier_return.rtv_number,
            "dispatched": dispatched,
            "channels": [channel],
            "resend": True,
        },
        channel=channel,
        idempotency_key=f"supplier_return.resend:{supplier_return.id}:{phase}:{channel}:{uuid.uuid4()}",
    )
    db.commit()
    return {"status": "queued", "phase": phase, "channel": channel, "outboxId": outbox.id}


@router.get("/{supplier_return_id}/pdf")
def supplier_return_pdf(
    supplier_return_id: int,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> Response:
    supplier_return = _get_scoped_supplier_return(supplier_return_id, principal, db)
    filename = f"{supplier_return.rtv_number or supplier_return.id}.pdf"
    return Response(
        build_rtv_pdf(db, supplier_return),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{supplier_return_id}/dispatch", response_model=SupplierReturnOut)
def dispatch_supplier_return(
    supplier_return_id: int,
    payload: SupplierReturnDispatch,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> dict:
    _ensure_reverse_workflow(db, principal.business_profile_id)
    supplier_return = _get_scoped_supplier_return(supplier_return_id, principal, db)
    if supplier_return.shipment_status == "shipped":
        return _serialize_supplier_return(supplier_return)

    try:
        ReverseLogisticsService(SqlAlchemyReverseLogisticsRepository(db)).create_shipment(
            ShipmentCommand(
                supplier_return_id=supplier_return.id,
                actor_staff_id=None,
                expected_version=supplier_return.version,
                carrier_name=payload.carrier_name,
                transport_mode=payload.transport_mode,
                tracking_number=payload.tracking_number,
                vehicle_number=payload.vehicle_number,
                driver_name=payload.driver_name,
                driver_phone=payload.driver_phone,
                shipment_date=datetime.now(timezone.utc),
                remarks=payload.remarks,
            )
        )
        shipped_status = (
            db.query(WorkflowStatus)
            .filter(
                WorkflowStatus.business_profile_id == principal.business_profile_id,
                WorkflowStatus.module == "supplier_return",
                WorkflowStatus.code == "shipped",
            )
            .first()
        )
        supplier_return.current_status_id = shipped_status.id if shipped_status else supplier_return.current_status_id
        supplier_return.approval_status = "approved"
        supplier_return.shipment_status = "shipped"
        for item in supplier_return.items:
            item.quantity_approved = item.quantity_requested
            item.quantity_shipped = item.quantity_requested
        record_audit(
            db,
            action="dispatch",
            entity_type="supplier_return",
            entity_id=supplier_return.id,
            details={
                "businessProfileId": principal.business_profile_id,
                "trackingNumber": payload.tracking_number,
                "carrierName": payload.carrier_name,
            },
        )
        enqueue_supplier_return_notification(db, supplier_return, dispatched=True)
        db.commit()
    except ReverseLogisticsError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        db.rollback()
        raise
    logger.info(
        "event=rtv_dispatched supplier_return_id=%s rtv_number=%s business_profile_id=%s",
        supplier_return.id,
        supplier_return.rtv_number,
        principal.business_profile_id,
    )
    logger.info(
        "event=rtv_notification_queued supplier_return_id=%s rtv_number=%s dispatched=true",
        supplier_return.id,
        supplier_return.rtv_number,
    )
    dispatched_return = db.execute(
        select(SupplierReturn)
        .options(
            selectinload(SupplierReturn.items),
            selectinload(SupplierReturn.supplier),
            selectinload(SupplierReturn.current_status),
        )
        .where(SupplierReturn.id == supplier_return.id)
    ).scalar_one()
    notifications = _notification_status_map(db, [dispatched_return.id]).get(dispatched_return.id)
    return _serialize_supplier_return(dispatched_return, notifications)
