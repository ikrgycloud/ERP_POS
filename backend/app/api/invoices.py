import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import (
    ErpPrincipal,
    apply_date_range,
    ensure_outlet_record_access,
    get_erp_principal,
    resolve_outlet_scope,
)
from app.audit import record_audit
from app.database import get_db
from app.document_service import document_service
from app.idempotency import begin_idempotent_request, complete_idempotent_request
from app.invoice_payment_service import calculate_payment_summary
from app.models import Customer, Invoice, InvoicePayment, NotificationHistory, NotificationOutbox, Order, Outlet
from app.notification_outbox import (
    CHANNEL_EMAIL,
    CHANNEL_EVENT,
    CHANNEL_SMS,
    EVENT_INVOICE_GENERATED,
    enqueue_invoice_notification,
    enqueue_notification,
)
from app.schemas import ApiMessage, InvoiceCreate, InvoiceGenerate, InvoiceOut, InvoiceReverse, InvoiceUpdate
from app.services import (
    create_waybill_for_invoice,
    invoice_direction_for_order,
    invoice_total,
    next_number,
    order_totals,
    recalculate_customer_summary,
    reverse_invoice_inventory,
    retry_on_deadlock,
)

router = APIRouter(prefix="/invoices", tags=["Invoices"])
MAX_NUMBER_RETRIES = 5

LEGACY_B2C_PARTY_TYPES = {"customer", "consumer", "b2c_customer"}
LEGACY_B2B_PARTY_TYPES = {"supplier", "business", "outlet", "admin"}


def resolve_invoice_party_identity(invoice: Invoice, order: Order | None) -> tuple[str, str]:
    is_purchase = bool(order and order.type == "purchase") or str(invoice.invoice_type).strip().lower() == "purchase"
    if is_purchase:
        return "B2B", "Supplier"

    raw_party_type = str(invoice.party_type or (order.party_type if order else "")).strip()
    normalized = raw_party_type.lower()
    if normalized in LEGACY_B2C_PARTY_TYPES:
        return "B2C", "Customer"
    if normalized in LEGACY_B2B_PARTY_TYPES:
        return "B2B", "Business"
    if raw_party_type.upper() in {"B2B", "B2C"}:
        category = raw_party_type.upper()
        return category, "Customer" if category == "B2C" else "Business"
    if order and order.customer_id is not None:
        return "B2C", "Customer"
    return "B2B", "Business"


def queue_invoice_notification(db: Session, invoice: Invoice, *, force_new: bool = False) -> None:
    """Write the outbox event in the same transaction as the invoice."""
    if not force_new:
        enqueue_invoice_notification(db, invoice)
        return
    channels = [CHANNEL_EMAIL, CHANNEL_SMS] if str(invoice.party_type or "").upper() == "B2B" else [CHANNEL_EMAIL]
    enqueue_notification(
        db,
        event_type=EVENT_INVOICE_GENERATED,
        aggregate_type="invoice",
        aggregate_id=invoice.id,
        business_profile_id=invoice.business_profile_id,
        payload={
            "invoiceId": invoice.id,
            "invoiceNumber": invoice.invoice_number,
            "channels": channels,
            "reason": "regenerate",
        },
        idempotency_key=f"{EVENT_INVOICE_GENERATED}:invoice:{invoice.id}:regenerate:{uuid.uuid4()}",
    )


def serialize_invoice(invoice: Invoice, db: Session | None = None) -> InvoiceOut:
    linked_invoice_number = None
    if getattr(invoice, "linked_invoice", None) is not None:
        linked_invoice_number = invoice.linked_invoice.invoice_number
    elif db is not None and invoice.linked_invoice_id is not None:
        linked_invoice = db.get(Invoice, invoice.linked_invoice_id)
        linked_invoice_number = linked_invoice.invoice_number if linked_invoice else None
    waybill = getattr(invoice, "waybill", None)
    order = invoice.order
    supplier = order.supplier if order and order.supplier else None
    customer = order.customer if order and order.customer else None
    is_purchase = bool(order and order.type == "purchase") or str(invoice.invoice_type).lower() == "purchase"
    party_category, party_role = resolve_invoice_party_identity(invoice, order)
    supplier_phone = (supplier.phone or supplier.mobile) if supplier else None
    customer_phone = customer.phone if customer else None
    party_phone = supplier_phone if is_purchase else customer_phone
    party_email = supplier.email if is_purchase and supplier else customer.email if customer else None
    payment = calculate_payment_summary(db, invoice) if db is not None else None
    is_pos_sale = bool(
        db is not None
        and db.query(InvoicePayment.id)
        .filter(InvoicePayment.invoice_id == invoice.id, InvoicePayment.notes.ilike("POS checkout%"))
        .first()
    )
    return InvoiceOut.model_validate(
        {
            **invoice.__dict__,
            "order_number": order.order_number if order else None,
            "party_category": party_category,
            "party_role": party_role,
            "party_phone": party_phone,
            "customer_phone": customer_phone,
            "supplier_phone": supplier_phone,
            "party_email": party_email,
            "customer_email": customer.email if customer else None,
            "supplier_email": supplier.email if supplier else None,
            "linked_invoice_number": linked_invoice_number,
            "waybill_number": waybill.waybill_number if waybill else None,
            "waybill_valid_until": waybill.valid_until if waybill else None,
            "waybill_transport_mode": waybill.transport_mode if waybill else None,
            "waybill_vehicle_number": waybill.vehicle_number if waybill else None,
            "waybill_from_name": waybill.from_name if waybill else None,
            "waybill_to_name": waybill.to_name if waybill else None,
            "grand_total": invoice_total(invoice),
            "paid_amount": payment.paid_amount if payment else invoice.paid_amount,
            "remaining_amount": payment.remaining_amount if payment else invoice.remaining_amount,
            "payment_percentage": payment.payment_percentage if payment else invoice.payment_percentage,
            "payment_status": payment.payment_status if payment else invoice.payment_status,
            "last_payment_date": payment.last_payment_date if payment else invoice.last_payment_date,
            "payment_count": payment.payment_count if payment else 0,
            "source": "POS" if is_pos_sale else "ERP",
        }
    )


def validate_invoice_scope(db: Session, data: dict, principal: ErpPrincipal) -> None:
    order = None
    if data.get("order_id") is not None:
        order = db.query(Order).filter(
            Order.id == data["order_id"],
            Order.business_profile_id == principal.business_profile_id,
        ).first()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        ensure_outlet_record_access(order.outlet_id, principal)
        if data.get("outlet_id") is None:
            data["outlet_id"] = order.outlet_id
        elif data["outlet_id"] != order.outlet_id:
            raise HTTPException(status_code=400, detail="Invoice outlet must match the order outlet")
    if data.get("customer_id") is not None:
        customer = (
            db.query(Customer)
            .join(Outlet, Outlet.id == Customer.outlet_id)
            .filter(
                Customer.id == data["customer_id"],
                Customer.is_active.is_(True),
                Outlet.business_profile_id == principal.business_profile_id,
                Outlet.is_active.is_(True),
            )
            .first()
        )
        if not customer or (data.get("outlet_id") is not None and customer.outlet_id != data["outlet_id"]):
            raise HTTPException(status_code=404, detail="Customer not found")


def update_generated_invoice_from_order(
    invoice: Invoice,
    order: Order,
    payload: InvoiceGenerate,
    business_profile_id: int | None,
    taxable_value: Decimal,
    cgst: Decimal,
    sgst: Decimal,
    igst: Decimal,
) -> Invoice:
    invoice.business_profile_id = business_profile_id or order.business_profile_id
    invoice.invoice_type = "Purchase" if order.type == "purchase" else "Sale"
    invoice.invoice_direction = payload.invoice_direction or invoice_direction_for_order(order)
    invoice.outlet_id = order.outlet_id
    invoice.customer_id = order.customer_id
    invoice.party_type = order.party_type
    invoice.party_name = order.party_name
    invoice.date = date.today()
    invoice.due_date = payload.due_date
    invoice.taxable_value = taxable_value
    invoice.cgst = cgst
    invoice.sgst = sgst
    invoice.igst = igst
    invoice.status = payload.status
    return invoice


@router.get("", response_model=list[InvoiceOut])
def list_invoices(
    search: str | None = None,
    invoice_type: str | None = Query(default=None, alias="invoiceType"),
    invoice_direction: str | None = Query(default=None, alias="invoiceDirection"),
    party_type: str | None = Query(default=None, alias="partyType"),
    status_filter: str | None = Query(default=None, alias="status"),
    tax_type: str | None = Query(default=None, alias="taxType"),
    outlet_id: int | None = Query(default=None, alias="outletId"),
    customer_id: int | None = Query(default=None, alias="customerId"),
    linked_invoice_id: int | None = Query(default=None, alias="linkedInvoiceId"),
    start_date: date | None = Query(default=None, alias="startDate"),
    end_date: date | None = Query(default=None, alias="endDate"),
    cursor: int | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> list[InvoiceOut]:
    query = db.query(Invoice).options(
        selectinload(Invoice.order).selectinload(Order.customer),
        selectinload(Invoice.order).selectinload(Order.supplier),
        selectinload(Invoice.waybill),
        selectinload(Invoice.linked_invoice),
        selectinload(Invoice.payments),
    )
    query = query.filter(Invoice.business_profile_id == principal.business_profile_id)
    outlet_id = resolve_outlet_scope(outlet_id, principal)
    query = query.filter(Invoice.status != "Deleted")
    query = apply_date_range(query, Invoice, start_date, end_date)
    if search:
        pattern = f"%{search}%"
        query = query.filter(or_(Invoice.invoice_number.ilike(pattern), Invoice.party_name.ilike(pattern)))
    if invoice_type:
        query = query.filter(Invoice.invoice_type == invoice_type)
    if invoice_direction:
        query = query.filter(Invoice.invoice_direction == invoice_direction)
    if party_type:
        query = query.filter(Invoice.party_type == party_type)
    if status_filter:
        query = query.filter(Invoice.status == status_filter)
    if tax_type == "igst":
        query = query.filter(Invoice.igst > 0)
    if tax_type == "cgst_sgst":
        query = query.filter(Invoice.igst == 0)
    if outlet_id:
        query = query.filter(Invoice.outlet_id == outlet_id)
    if customer_id:
        query = query.filter(Invoice.customer_id == customer_id)
    if linked_invoice_id:
        query = query.filter(Invoice.linked_invoice_id == linked_invoice_id)
    if cursor is not None:
        invoices = query.filter(Invoice.id < cursor).order_by(Invoice.id.desc()).limit(limit).all()
        return [serialize_invoice(invoice, db) for invoice in invoices]
    invoices = query.order_by(Invoice.created_at.desc(), Invoice.id.desc()).offset(skip).limit(limit).all()
    return [serialize_invoice(invoice, db) for invoice in invoices]


@router.post("", response_model=InvoiceOut, status_code=status.HTTP_201_CREATED)
@retry_on_deadlock()
def create_invoice(
    payload: InvoiceCreate,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> InvoiceOut:
    idem_endpoint = "ERP:POST:/invoices"
    idem_payload = payload.model_dump()
    idem = begin_idempotent_request(db, idempotency_key, idem_endpoint, idem_payload)
    if idem.replay_body is not None:
        return idem.replay_body
    if payload.invoice_direction == "outlet_to_customer" and payload.customer_id is None:
        raise HTTPException(status_code=400, detail="Customer registration is required for customer invoices")
    data = payload.model_dump()
    data["business_profile_id"] = principal.business_profile_id
    data["outlet_id"] = resolve_outlet_scope(data.get("outlet_id"), principal)
    validate_invoice_scope(db, data, principal)
    for attempt in range(MAX_NUMBER_RETRIES):
        invoice = Invoice(invoice_number=next_number(db, Invoice, "invoice_number", "INV", attempt), **data)
        db.add(invoice)
        try:
            db.flush()
            recalculate_customer_summary(db, invoice.customer_id or (invoice.order.customer_id if invoice.order else None))
            create_waybill_for_invoice(db, invoice)
            record_audit(db, action="create", entity_type="invoice", entity_id=invoice.id, details=payload.model_dump())
            queue_invoice_notification(db, invoice)
            complete_idempotent_request(idem, serialize_invoice(invoice, db), status.HTTP_201_CREATED)
            db.commit()
            db.refresh(invoice)
            return serialize_invoice(invoice, db)
        except IntegrityError:
            db.rollback()
            idem = begin_idempotent_request(db, idempotency_key, idem_endpoint, idem_payload)
            if attempt == MAX_NUMBER_RETRIES - 1:
                raise HTTPException(status_code=409, detail="Invoice number conflict. Please try again.")
    raise HTTPException(status_code=409, detail="Invoice number conflict. Please try again.")


@router.post("/generate", response_model=InvoiceOut, status_code=status.HTTP_201_CREATED)
@retry_on_deadlock()
def generate_invoice(
    payload: InvoiceGenerate,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> InvoiceOut:
    idem_endpoint = "ERP:POST:/invoices/generate"
    idem_payload = payload.model_dump()
    idem = begin_idempotent_request(db, idempotency_key, idem_endpoint, idem_payload)
    if idem.replay_body is not None:
        return idem.replay_body
    order = db.query(Order).filter(Order.id == payload.order_id).with_for_update().first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.business_profile_id != principal.business_profile_id:
        raise HTTPException(status_code=404, detail="Order not found")
    ensure_outlet_record_access(order.outlet_id, principal)
    if order.party_type == "B2C" and order.customer_id is None:
        raise HTTPException(status_code=400, detail="Customer registration is required before invoicing this order")
    totals = order_totals(order)
    if payload.intra_state:
        cgst = totals["tax_value"] / Decimal("2")
        sgst = totals["tax_value"] / Decimal("2")
        igst = Decimal("0")
    else:
        cgst = Decimal("0")
        sgst = Decimal("0")
        igst = totals["tax_value"]
    invoice = (
        db.query(Invoice)
        .filter(
            Invoice.order_id == order.id,
            Invoice.is_reverse.is_(False),
        )
        .order_by(Invoice.id.asc())
        .first()
    )
    is_new_invoice = invoice is None
    for attempt in range(MAX_NUMBER_RETRIES):
        if invoice is None:
            invoice = Invoice(
                invoice_number=next_number(db, Invoice, "invoice_number", "INV", attempt),
                order_id=order.id,
            )
            db.add(invoice)
        update_generated_invoice_from_order(
            invoice,
            order,
            payload,
            principal.business_profile_id,
            totals["taxable_value"],
            cgst,
            sgst,
            igst,
        )
        try:
            db.flush()
            recalculate_customer_summary(db, order.customer_id)
            create_waybill_for_invoice(db, invoice)
            record_audit(
                db,
                action="generate" if is_new_invoice else "regenerate_update",
                entity_type="invoice",
                entity_id=invoice.id,
                details={**payload.model_dump(), "reusedExistingInvoice": not is_new_invoice},
            )
            # Updating/regenerating an existing invoice must not notify the
            # recipient again. A notification is sent on first creation only;
            # use the explicit channel resend endpoint for a deliberate resend.
            queue_invoice_notification(db, invoice)
            complete_idempotent_request(idem, serialize_invoice(invoice, db), status.HTTP_201_CREATED)
            db.commit()
            db.refresh(invoice)
            return serialize_invoice(invoice, db)
        except IntegrityError:
            db.rollback()
            idem = begin_idempotent_request(db, idempotency_key, idem_endpoint, idem_payload)
            if not is_new_invoice or attempt == MAX_NUMBER_RETRIES - 1:
                raise HTTPException(status_code=409, detail="Invoice number conflict. Please try again.")
            invoice = None
    raise HTTPException(status_code=409, detail="Invoice number conflict. Please try again.")


def _get_scoped_invoice(invoice_id: int, principal: ErpPrincipal, db: Session) -> Invoice:
    invoice = db.get(Invoice, invoice_id)
    if not invoice or invoice.business_profile_id != principal.business_profile_id:
        raise HTTPException(status_code=404, detail="Invoice not found")
    ensure_outlet_record_access(invoice.outlet_id, principal)
    return invoice


@router.get("/{invoice_id}/notifications")
def get_invoice_notification_status(
    invoice_id: int,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    _get_scoped_invoice(invoice_id, principal, db)
    entries = (
        db.query(NotificationOutbox)
        .filter(
            NotificationOutbox.aggregate_type == "invoice",
            NotificationOutbox.aggregate_id == str(invoice_id),
            NotificationOutbox.channel.in_([CHANNEL_EVENT, CHANNEL_EMAIL, CHANNEL_SMS]),
        )
        .order_by(NotificationOutbox.updated_at.desc(), NotificationOutbox.id.desc())
        .all()
    )
    channels: dict[str, dict[str, object]] = {}
    parent_event: NotificationOutbox | None = None
    for entry in entries:
        if entry.channel == CHANNEL_EVENT:
            parent_event = parent_event or entry
            continue
        # An invoice can have an older failed attempt and a later successful
        # resend. A confirmed send is the meaningful customer-facing status,
        # so it must take precedence over historical dead-letter rows.
        if entry.channel not in channels or (
            entry.status == "sent" and channels[entry.channel].get("status") != "sent"
        ):
            channels[entry.channel] = {
                "status": entry.status,
                "attempts": entry.attempts,
                "lastError": entry.last_error,
                "updatedAt": entry.updated_at,
                "sentAt": entry.sent_at,
            }
    if parent_event:
        expected_channels = (parent_event.payload or {}).get("channels") or []
        for channel in expected_channels:
            if channel in {CHANNEL_EMAIL, CHANNEL_SMS} and channel not in channels:
                channels[channel] = {
                    "status": parent_event.status,
                    "attempts": parent_event.attempts,
                    "lastError": parent_event.last_error,
                    "updatedAt": parent_event.updated_at,
                    "sentAt": None,
                }
    history = (
        db.query(NotificationHistory)
        .filter(
            NotificationHistory.aggregate_type == "invoice",
            NotificationHistory.aggregate_id == str(invoice_id),
            NotificationHistory.channel.in_([CHANNEL_EMAIL, CHANNEL_SMS]),
        )
        .order_by(NotificationHistory.created_at.desc(), NotificationHistory.id.desc())
        .limit(12)
        .all()
    )
    return {
        "invoiceId": invoice_id,
        "channels": channels,
        "history": [
            {
                "channel": entry.channel,
                "status": entry.status,
                "attempt": entry.attempt,
                "completedAt": entry.completed_at,
                "createdAt": entry.created_at,
                "errorMessage": entry.error_message,
                "correlationId": entry.correlation_id,
            }
            for entry in history
        ],
    }


@router.post("/{invoice_id}/notifications/{channel}/resend", status_code=status.HTTP_202_ACCEPTED)
def resend_invoice_notification(
    invoice_id: int,
    channel: str,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    if channel not in {CHANNEL_EMAIL, CHANNEL_SMS}:
        raise HTTPException(status_code=400, detail="Channel must be email or sms")
    invoice = _get_scoped_invoice(invoice_id, principal, db)
    outbox = enqueue_notification(
        db,
        event_type=EVENT_INVOICE_GENERATED,
        aggregate_type="invoice",
        aggregate_id=invoice.id,
        business_profile_id=invoice.business_profile_id,
        payload={"invoiceId": invoice.id, "invoiceNumber": invoice.invoice_number, "channels": [channel], "resend": True},
        channel=channel,
        idempotency_key=f"invoice.resend:{invoice.id}:{channel}:{uuid.uuid4()}",
    )
    db.commit()
    return {"status": "queued", "channel": channel, "outboxId": outbox.id}


@router.get("/{invoice_id}/pdf")
def download_invoice_pdf(
    invoice_id: int,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> Response:
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.business_profile_id != principal.business_profile_id:
        raise HTTPException(status_code=404, detail="Invoice not found")
    ensure_outlet_record_access(invoice.outlet_id, principal)
    pdf_bytes = document_service.invoice_pdf(db, invoice)
    filename = f"{invoice.invoice_number or invoice.id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{invoice_id}/reverse", response_model=InvoiceOut, status_code=status.HTTP_201_CREATED)
@retry_on_deadlock()
def reverse_invoice(
    invoice_id: int,
    payload: InvoiceReverse | None = Body(default=None),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> InvoiceOut:
    payload = payload or InvoiceReverse()
    idem = begin_idempotent_request(
        db,
        idempotency_key,
        f"ERP:POST:/invoices/{invoice_id}/reverse",
        {"invoice_id": invoice_id, **payload.model_dump()},
    )
    if idem.replay_body is not None:
        return idem.replay_body
    source_invoice = db.query(Invoice).filter(Invoice.id == invoice_id).with_for_update().first()
    if not source_invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if source_invoice.business_profile_id != principal.business_profile_id:
        raise HTTPException(status_code=404, detail="Invoice not found")
    ensure_outlet_record_access(source_invoice.outlet_id, principal)
    if source_invoice.is_reverse:
        raise HTTPException(status_code=400, detail="Reverse invoices cannot be reversed again")
    if not source_invoice.order:
        raise HTTPException(status_code=400, detail="Original order is required to create a reverse invoice")
    existing_linked_reverse = db.query(Invoice).filter(
        Invoice.linked_invoice_id == source_invoice.id,
        Invoice.is_reverse.is_(True),
    ).first()
    if existing_linked_reverse:
        raise HTTPException(status_code=400, detail="Reverse invoice already exists for this invoice")

    reverse_number = f"{source_invoice.invoice_number}-REV"
    existing_reverse = db.query(Invoice).filter(Invoice.invoice_number == reverse_number).first()
    if existing_reverse:
        reverse_number = f"{reverse_number}-{source_invoice.id}"

    reverse = Invoice(
        invoice_number=reverse_number,
        business_profile_id=source_invoice.business_profile_id,
        order_id=source_invoice.order_id,
        invoice_type="Reverse",
        invoice_direction=(
            "customer_to_outlet"
            if source_invoice.invoice_direction == "outlet_to_customer"
            else "outlet_to_admin"
        ),
        linked_invoice_id=source_invoice.id,
        outlet_id=source_invoice.outlet_id,
        customer_id=source_invoice.customer_id,
        is_reverse=True,
        party_type=source_invoice.party_type,
        party_name=source_invoice.party_name,
        date=date.today(),
        due_date=payload.due_date,
        taxable_value=source_invoice.taxable_value,
        cgst=source_invoice.cgst,
        sgst=source_invoice.sgst,
        igst=source_invoice.igst,
        status=payload.status or "Pending Approval",
    )
    db.add(reverse)
    db.flush()
    create_waybill_for_invoice(db, reverse)
    record_audit(
        db,
        action="reverse",
        entity_type="invoice",
        entity_id=reverse.id,
        details={"sourceInvoiceId": source_invoice.id, **payload.model_dump()},
    )
    complete_idempotent_request(idem, serialize_invoice(reverse, db), status.HTTP_201_CREATED)
    db.commit()
    db.refresh(reverse)
    return serialize_invoice(reverse, db)


@router.post("/{invoice_id}/approve-reverse", response_model=InvoiceOut)
@retry_on_deadlock()
def approve_reverse_invoice(
    invoice_id: int,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> InvoiceOut:
    idem = begin_idempotent_request(
        db,
        idempotency_key,
        f"ERP:POST:/invoices/{invoice_id}/approve-reverse",
        {"invoice_id": invoice_id},
    )
    if idem.replay_body is not None:
        return idem.replay_body
    reverse = db.query(Invoice).filter(Invoice.id == invoice_id).with_for_update().first()
    if not reverse:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if reverse.business_profile_id != principal.business_profile_id:
        raise HTTPException(status_code=404, detail="Invoice not found")
    ensure_outlet_record_access(reverse.outlet_id, principal)
    if not reverse.is_reverse:
        raise HTTPException(status_code=400, detail="Only reverse invoices can be approved")
    if reverse.status in {"Approved", "Refunded"}:
        return serialize_invoice(reverse, db)
    if reverse.linked_invoice_id is None:
        raise HTTPException(status_code=400, detail="Source invoice is required to approve reverse invoice")

    source_invoice = db.query(Invoice).filter(Invoice.id == reverse.linked_invoice_id).with_for_update().first()
    if not source_invoice:
        raise HTTPException(status_code=404, detail="Source invoice not found")
    if not source_invoice.order:
        raise HTTPException(status_code=400, detail="Original order is required to refund inventory")

    reverse_invoice_inventory(db, source_invoice)
    recalculate_customer_summary(db, source_invoice.customer_id or source_invoice.order.customer_id)
    reverse.status = "Refunded"
    db.flush()
    record_audit(
        db,
        action="approve_reverse",
        entity_type="invoice",
        entity_id=reverse.id,
        details={"sourceInvoiceId": source_invoice.id, "status": reverse.status},
    )
    queue_invoice_notification(db, reverse)
    complete_idempotent_request(idem, serialize_invoice(reverse, db), status.HTTP_200_OK)
    db.commit()
    db.refresh(reverse)
    return serialize_invoice(reverse, db)


@router.put("/{invoice_id}", response_model=InvoiceOut)
@retry_on_deadlock()
def update_invoice(
    invoice_id: int,
    payload: InvoiceUpdate,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> InvoiceOut:
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).with_for_update().first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.business_profile_id != principal.business_profile_id:
        raise HTTPException(status_code=404, detail="Invoice not found")
    ensure_outlet_record_access(invoice.outlet_id, principal)
    previous_customer_id = invoice.customer_id or (invoice.order.customer_id if invoice.order else None)
    changes = payload.model_dump()
    changes["business_profile_id"] = principal.business_profile_id
    changes["outlet_id"] = resolve_outlet_scope(changes.get("outlet_id"), principal)
    validate_invoice_scope(db, changes, principal)
    for key, value in changes.items():
        setattr(invoice, key, value)
    db.flush()
    recalculate_customer_summary(db, previous_customer_id)
    recalculate_customer_summary(db, invoice.customer_id or (invoice.order.customer_id if invoice.order else None))
    record_audit(db, action="update", entity_type="invoice", entity_id=invoice.id, details=payload.model_dump())
    db.commit()
    db.refresh(invoice)
    return serialize_invoice(invoice, db)


@router.delete("/{invoice_id}", response_model=ApiMessage)
@retry_on_deadlock()
def delete_invoice(
    invoice_id: int,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> ApiMessage:
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).with_for_update().first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.business_profile_id != principal.business_profile_id:
        raise HTTPException(status_code=404, detail="Invoice not found")
    ensure_outlet_record_access(invoice.outlet_id, principal)
    customer_id = invoice.customer_id or (invoice.order.customer_id if invoice.order else None)
    linked_reverses = db.query(Invoice).filter(Invoice.linked_invoice_id == invoice.id).all()
    for linked_reverse in linked_reverses:
        if linked_reverse.waybill:
            linked_reverse.waybill.status = "Deleted"
        record_audit(
            db,
            action="delete_linked_reverse",
            entity_type="invoice",
            entity_id=linked_reverse.id,
            details={"invoiceNumber": linked_reverse.invoice_number, "sourceInvoiceId": invoice.id},
        )
        linked_reverse.status = "Deleted"
    if invoice.waybill:
        invoice.waybill.status = "Deleted"
    record_audit(db, action="delete", entity_type="invoice", entity_id=invoice.id, details={"invoiceNumber": invoice.invoice_number})
    invoice.status = "Deleted"
    db.flush()
    recalculate_customer_summary(db, customer_id)
    db.commit()
    return ApiMessage(message="Invoice deleted")
