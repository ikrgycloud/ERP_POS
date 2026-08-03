from decimal import Decimal

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Response, status
from sqlalchemy.orm import Session, selectinload

from app.api.deps import ErpPrincipal, ensure_outlet_record_access, get_erp_principal
from app.audit import record_audit
from app.database import get_db
from app.idempotency import begin_idempotent_request, complete_idempotent_request
from app.invoice_payment_service import (
    NEGATIVE_TYPES,
    POSITIVE_TYPES,
    calculate_payment_summary,
    money,
    sync_invoice_payment_fields,
    utcnow,
)
from app.models import Invoice, InvoicePayment
from app.notification_outbox import enqueue_order_notification
from app.payment_receipt_pdf import build_payment_receipt_pdf
from app.schemas import InvoicePaymentCreate, InvoicePaymentOut, InvoicePaymentResult, InvoicePaymentSummary
from app.services import next_number, retry_on_deadlock

router = APIRouter(tags=["Invoice Payments"])


def _effective_principal(principal: object, business_profile_id: int | None) -> ErpPrincipal:
    if isinstance(principal, ErpPrincipal):
        return principal
    if business_profile_id is None:
        raise HTTPException(status_code=401, detail="Missing tenant context")
    return ErpPrincipal(business_profile_id=business_profile_id, role="admin")


def _invoice(db: Session, invoice_id: int, principal: ErpPrincipal, lock: bool = False) -> Invoice:
    query = db.query(Invoice).filter(
        Invoice.id == invoice_id,
        Invoice.business_profile_id == principal.business_profile_id,
    )
    if lock:
        query = query.with_for_update()
    invoice = query.first()
    if not invoice or invoice.status == "Deleted":
        raise HTTPException(status_code=404, detail="Invoice not found")
    ensure_outlet_record_access(invoice.outlet_id, principal)
    return invoice


def _payment(db: Session, payment_id: int, principal: ErpPrincipal, lock: bool = False) -> InvoicePayment:
    query = db.query(InvoicePayment).options(selectinload(InvoicePayment.invoice)).filter(InvoicePayment.id == payment_id)
    query = query.filter(InvoicePayment.business_profile_id == principal.business_profile_id)
    if lock:
        query = query.with_for_update()
    payment = query.first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    ensure_outlet_record_access(payment.outlet_id, principal)
    return payment


def _result(payment: InvoicePayment, summary: object) -> InvoicePaymentResult:
    return InvoicePaymentResult(
        payment=InvoicePaymentOut.model_validate(payment),
        summary=InvoicePaymentSummary.model_validate(summary.as_dict()),
    )


@router.post("/invoices/{invoice_id}/payments", response_model=InvoicePaymentResult, status_code=status.HTTP_201_CREATED)
@retry_on_deadlock()
def receive_invoice_payment(
    invoice_id: int,
    payload: InvoicePaymentCreate = Body(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    principal: ErpPrincipal = Depends(get_erp_principal),
    business_profile_id: int | None = None,
    db: Session = Depends(get_db),
) -> InvoicePaymentResult:
    principal = _effective_principal(principal, business_profile_id)
    endpoint = f"ERP:POST:/invoices/{invoice_id}/payments"
    idem = begin_idempotent_request(db, idempotency_key, endpoint, payload.model_dump())
    if idem.replay_body is not None:
        return idem.replay_body
    invoice = _invoice(db, invoice_id, principal, lock=True)
    if invoice.is_reverse:
        raise HTTPException(status_code=400, detail="Receive payments against the original invoice, not a reverse invoice")

    before = calculate_payment_summary(db, invoice)
    amount = money(payload.amount)
    if payload.status == "successful" and payload.transaction_type in POSITIVE_TYPES and amount > before.remaining_amount:
        raise HTTPException(status_code=409, detail="Payment amount exceeds the remaining invoice balance")
    if payload.status == "successful" and payload.transaction_type in NEGATIVE_TYPES and amount > before.paid_amount:
        raise HTTPException(status_code=409, detail="Refund or debit adjustment exceeds the paid amount")

    effect = Decimal("0.00")
    if payload.status == "successful":
        effect = amount if payload.transaction_type in POSITIVE_TYPES else -amount
    after_paid = max(Decimal("0.00"), money(before.paid_amount + effect))
    from app.invoice_payment_service import status_for
    after_status, after_remaining, _ = status_for(before.grand_total, after_paid)
    payment = InvoicePayment(
        receipt_number=next_number(db, InvoicePayment, "receipt_number", "RCP"),
        invoice_id=invoice.id,
        business_profile_id=invoice.business_profile_id,
        customer_id=invoice.customer_id,
        outlet_id=invoice.outlet_id,
        amount=amount,
        payment_method=payload.payment_method,
        transaction_reference=payload.transaction_reference,
        transaction_type=payload.transaction_type,
        status=payload.status,
        notes=payload.notes,
        received_by=payload.received_by,
        paid_at=utcnow(),
        invoice_total_snapshot=before.grand_total,
        previous_paid_amount=before.paid_amount,
        total_paid_after=after_paid,
        remaining_after=after_remaining,
        payment_status_after=after_status,
    )
    db.add(payment)
    db.flush()
    summary = calculate_payment_summary(db, invoice)
    auto_delivered_now = sync_invoice_payment_fields(db, invoice, summary)
    if auto_delivered_now and invoice.order is not None:
        enqueue_order_notification(db, invoice.order)
    record_audit(
        db,
        action="receive_payment",
        entity_type="invoice_payment",
        entity_id=payment.id,
        details={"invoiceId": invoice.id, "receiptNumber": payment.receipt_number, "amount": str(amount)},
    )
    response = _result(payment, summary)
    complete_idempotent_request(idem, response, status.HTTP_201_CREATED)
    db.commit()
    db.refresh(payment)
    return _result(payment, summary)


@router.get("/invoices/{invoice_id}/payments", response_model=list[InvoicePaymentOut])
def list_invoice_payments(
    invoice_id: int,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> list[InvoicePaymentOut]:
    invoice = _invoice(db, invoice_id, principal)
    entries = (
        db.query(InvoicePayment)
        .filter(InvoicePayment.invoice_id == invoice.id)
        .order_by(InvoicePayment.paid_at.desc(), InvoicePayment.id.desc())
        .all()
    )
    return [InvoicePaymentOut.model_validate(entry) for entry in entries]


def _summary(invoice_id: int, principal: ErpPrincipal, db: Session) -> InvoicePaymentSummary:
    invoice = _invoice(db, invoice_id, principal)
    return InvoicePaymentSummary.model_validate(calculate_payment_summary(db, invoice).as_dict())


@router.get("/invoices/{invoice_id}/summary", response_model=InvoicePaymentSummary)
def get_invoice_payment_summary(
    invoice_id: int,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> InvoicePaymentSummary:
    return _summary(invoice_id, principal, db)


@router.get("/invoices/{invoice_id}/payment-summary", response_model=InvoicePaymentSummary, include_in_schema=False)
def get_invoice_payment_summary_compat(
    invoice_id: int,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> InvoicePaymentSummary:
    return _summary(invoice_id, principal, db)


@router.get("/payments/{payment_id}/receipt")
def download_payment_receipt(
    payment_id: int,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> Response:
    payment = _payment(db, payment_id, principal)
    return Response(
        content=build_payment_receipt_pdf(db, payment),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{payment.receipt_number}.pdf"'},
    )


@router.post("/payments/{payment_id}/reverse", response_model=InvoicePaymentResult, status_code=status.HTTP_201_CREATED)
@retry_on_deadlock()
def reverse_payment(
    payment_id: int,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    principal: ErpPrincipal = Depends(get_erp_principal),
    business_profile_id: int | None = None,
    db: Session = Depends(get_db),
) -> InvoicePaymentResult:
    principal = _effective_principal(principal, business_profile_id)
    endpoint = f"ERP:POST:/payments/{payment_id}/reverse"
    idem = begin_idempotent_request(db, idempotency_key, endpoint, {"payment_id": payment_id})
    if idem.replay_body is not None:
        return idem.replay_body
    payment = _payment(db, payment_id, principal, lock=True)
    invoice = _invoice(db, payment.invoice_id, principal, lock=True)
    if payment.status != "successful" or payment.transaction_type not in POSITIVE_TYPES:
        raise HTTPException(status_code=409, detail="Only a successful, unreversed payment can be reversed")
    if db.query(InvoicePayment).filter(InvoicePayment.reversal_of_id == payment.id).first():
        raise HTTPException(status_code=409, detail="Payment has already been reversed")

    before = calculate_payment_summary(db, invoice)
    payment.status = "reversed"
    payment.reversed_at = utcnow()
    db.flush()
    after = calculate_payment_summary(db, invoice)
    reversal = InvoicePayment(
        receipt_number=next_number(db, InvoicePayment, "receipt_number", "RCP"),
        invoice_id=invoice.id,
        business_profile_id=invoice.business_profile_id,
        customer_id=invoice.customer_id,
        outlet_id=invoice.outlet_id,
        reversal_of_id=payment.id,
        amount=payment.amount,
        payment_method=payment.payment_method,
        transaction_reference=payment.transaction_reference,
        transaction_type="reversal",
        status="successful",
        notes=f"Reversal of {payment.receipt_number}",
        received_by=payment.received_by,
        paid_at=utcnow(),
        invoice_total_snapshot=before.grand_total,
        previous_paid_amount=before.paid_amount,
        total_paid_after=after.paid_amount,
        remaining_after=after.remaining_amount,
        payment_status_after=after.payment_status,
    )
    db.add(reversal)
    db.flush()
    summary = calculate_payment_summary(db, invoice)
    sync_invoice_payment_fields(db, invoice, summary)
    record_audit(
        db,
        action="reverse_payment",
        entity_type="invoice_payment",
        entity_id=reversal.id,
        details={"originalPaymentId": payment.id, "invoiceId": invoice.id},
    )
    response = _result(reversal, summary)
    complete_idempotent_request(idem, response, status.HTTP_201_CREATED)
    db.commit()
    db.refresh(reversal)
    return _result(reversal, summary)
