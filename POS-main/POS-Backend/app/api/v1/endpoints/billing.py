"""POS billing, invoice, and payment endpoints."""

import logging
from time import perf_counter

from fastapi import APIRouter, Depends, Header, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, require_roles
from app.api.pagination import PaginationParams, pagination_params
from app.core.exceptions import NotFoundError
from app.core.roles import Role
from app.db.session import get_db
from app.models.sales import Customer
from app.repositories.repos import (
    InvoiceRepository,
    PaymentRepository,
)
from app.schemas.transactions import (
    CartCustomerUpdate,
    CartLine,
    CartLineUpdate,
    CartScan,
    CartStart,
    CartView,
    CheckoutRequest,
    InvoiceOut,
    PaymentMethodSummary,
    PaymentOut,
)
from app.services.billing import BillingService
from app.services.enterprise import EnterprisePOSService
from app.services.idempotency import begin_idempotent_request, complete_idempotent_request

router = APIRouter(tags=["billing"])
logger = logging.getLogger("pos_api.billing")
SP = require_roles(Role.SALES_PERSON)
BM_SM = require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER)


def _can_see_invoice(invoice, user: CurrentUser) -> bool:
    if invoice.business_profile_id != user.business_profile_id:
        return False
    if user.role == Role.SALES_PERSON:
        return invoice.staff_id == user.id and invoice.outlet_id == user.outlet_id
    return True


async def _attach_customer_phones(db: AsyncSession, invoices):
    rows = list(invoices if isinstance(invoices, (list, tuple)) else [invoices])
    customer_ids = {invoice.customer_id for invoice in rows if invoice and invoice.customer_id}
    if not customer_ids:
        for invoice in rows:
            if invoice is not None:
                setattr(invoice, "customer_phone", None)
        return invoices

    result = await db.execute(select(Customer.id, Customer.phone).where(Customer.id.in_(customer_ids)))
    phone_by_customer_id = {customer_id: phone for customer_id, phone in result.all()}
    for invoice in rows:
        if invoice is not None:
            setattr(invoice, "customer_phone", phone_by_customer_id.get(invoice.customer_id))
    return invoices


async def _billing_service(
    db: AsyncSession,
    user: CurrentUser,
    terminal_id: str | None,
    terminal_secret: str | None = None,
) -> BillingService:
    await EnterprisePOSService(db, user, terminal_id=terminal_id).verify_registered_terminal(
        terminal_secret
    )
    return BillingService(db, user, terminal_id=terminal_id)


# ------------------------------ POS Cart ------------------------------
@router.post("/pos/cart", status_code=201)
async def start_cart(
    payload: CartStart,
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    terminal_secret: str | None = Header(default=None, alias="X-Terminal-Secret"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(SP),
):
    svc = await _billing_service(db, user, terminal_id, terminal_secret)
    order = await svc.start_cart(payload.customer_id)
    return {"order_id": order.id, "order_number": order.order_number}


@router.get("/pos/cart/active", response_model=CartView | None)
async def active_cart(
    inter_state: bool = False,
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    terminal_secret: str | None = Header(default=None, alias="X-Terminal-Secret"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(SP),
):
    start = perf_counter()
    logger.info(
        "event=active_cart_start business_profile_id=%s outlet_id=%s staff_id=%s terminal_id=%s",
        user.business_profile_id,
        user.outlet_id,
        user.id,
        terminal_id or "default",
    )
    try:
        result = await (await _billing_service(db, user, terminal_id, terminal_secret)).active_cart(inter_state)
        duration_ms = (perf_counter() - start) * 1000
        logger.info(
            "event=active_cart_finish business_profile_id=%s outlet_id=%s staff_id=%s terminal_id=%s has_cart=%s duration_ms=%.2f",
            user.business_profile_id,
            user.outlet_id,
            user.id,
            terminal_id or "default",
            result is not None,
            duration_ms,
        )
        if duration_ms > 500:
            logger.warning(
                "event=active_cart_slow business_profile_id=%s outlet_id=%s staff_id=%s terminal_id=%s duration_ms=%.2f",
                user.business_profile_id,
                user.outlet_id,
                user.id,
                terminal_id or "default",
                duration_ms,
            )
        return result
    except Exception:
        logger.exception(
            "event=active_cart_failed business_profile_id=%s outlet_id=%s staff_id=%s terminal_id=%s",
            user.business_profile_id,
            user.outlet_id,
            user.id,
            terminal_id or "default",
        )
        raise


@router.post("/pos/cart/{order_id}/lease/renew")
async def renew_cart_lease(
    order_id: int,
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    terminal_secret: str | None = Header(default=None, alias="X-Terminal-Secret"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(SP),
):
    lease_expires_at = await (
        await _billing_service(db, user, terminal_id, terminal_secret)
    ).renew_cart_lease(order_id)
    return {"order_id": order_id, "lease_expires_at": lease_expires_at}


@router.patch("/pos/cart/{order_id}/customer")
async def attach_customer(
    order_id: int,
    payload: CartCustomerUpdate,
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    terminal_secret: str | None = Header(default=None, alias="X-Terminal-Secret"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(SP),
):
    await (await _billing_service(db, user, terminal_id, terminal_secret)).attach_customer(order_id, payload.customer_id)
    return {"detail": "Customer updated"}


@router.post("/pos/cart/{order_id}/cancel")
async def cancel_cart(
    order_id: int,
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    terminal_secret: str | None = Header(default=None, alias="X-Terminal-Secret"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(SP),
):
    order = await (await _billing_service(db, user, terminal_id, terminal_secret)).cancel_cart(order_id)
    return {"order_id": order.id, "order_number": order.order_number, "status": order.status}


@router.post("/pos/cart/{order_id}/void")
async def void_cart(
    order_id: int,
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    terminal_secret: str | None = Header(default=None, alias="X-Terminal-Secret"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(SP),
):
    order = await (await _billing_service(db, user, terminal_id, terminal_secret)).void_cart(order_id)
    return {"order_id": order.id, "order_number": order.order_number, "status": order.status}


@router.post("/pos/cart/cleanup")
async def cleanup_expired_carts(
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    terminal_secret: str | None = Header(default=None, alias="X-Terminal-Secret"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(SP),
):
    expired = await (await _billing_service(db, user, terminal_id, terminal_secret)).expire_abandoned_drafts(
        business_profile_id=user.business_profile_id,
        outlet_id=user.outlet_id,
        staff_id=user.id,
    )
    return {"expired": expired}


@router.post("/pos/cart/{order_id}/scan", response_model=CartLine)
async def scan(
    order_id: int,
    payload: CartScan,
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    terminal_secret: str | None = Header(default=None, alias="X-Terminal-Secret"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(SP),
):
    return await (await _billing_service(db, user, terminal_id, terminal_secret)).scan_add(order_id, payload.barcode, payload.quantity)


@router.patch("/pos/cart/{order_id}/items/{item_id}", response_model=CartView)
async def update_line(
    order_id: int,
    item_id: int,
    payload: CartLineUpdate,
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    terminal_secret: str | None = Header(default=None, alias="X-Terminal-Secret"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(SP),
):
    return await (await _billing_service(db, user, terminal_id, terminal_secret)).update_line(
        order_id,
        item_id,
        payload.product_id,
        payload.quantity,
    )


@router.delete("/pos/cart/{order_id}/items/{item_id}", response_model=CartView)
async def remove_line(
    order_id: int,
    item_id: int,
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    terminal_secret: str | None = Header(default=None, alias="X-Terminal-Secret"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(SP),
):
    return await (await _billing_service(db, user, terminal_id, terminal_secret)).remove_line(order_id, item_id)


@router.get("/pos/cart/{order_id}/totals", response_model=CartView)
async def cart_totals(
    order_id: int,
    inter_state: bool = False,
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    terminal_secret: str | None = Header(default=None, alias="X-Terminal-Secret"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(SP),
):
    return await (await _billing_service(db, user, terminal_id, terminal_secret)).view(order_id, inter_state)


@router.post("/pos/cart/{order_id}/checkout", response_model=InvoiceOut)
async def checkout(
    order_id: int,
    payload: CheckoutRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    terminal_id: str | None = Header(default=None, alias="X-Terminal-Id"),
    terminal_secret: str | None = Header(default=None, alias="X-Terminal-Secret"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(SP),
):
    idem = await begin_idempotent_request(
        db,
        idempotency_key,
        f"POS:POST:/pos/cart/{order_id}/checkout",
        {"order_id": order_id, **payload.model_dump()},
    )
    if idem.replay_body is not None:
        return idem.replay_body
    invoice = await (await _billing_service(db, user, terminal_id, terminal_secret)).checkout(order_id, payload)
    await _attach_customer_phones(db, invoice)
    response = InvoiceOut.model_validate(invoice).model_dump(mode="json")
    complete_idempotent_request(idem, response, status.HTTP_201_CREATED)
    return response


# ------------------------------ Invoices ------------------------------
@router.get("/invoices", response_model=list[InvoiceOut])
async def list_invoices(
    pagination: PaginationParams = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    repo = InvoiceRepository(db)
    if user.role == Role.SALES_PERSON:
        invoices = await repo.list_for_staff(user.id, pagination.skip, pagination.limit, cursor=pagination.cursor)
        await _attach_customer_phones(db, invoices)
        return invoices
    invoices = await repo.list_for_business(
        user.business_profile_id,
        pagination.skip,
        pagination.limit,
        cursor=pagination.cursor,
    )
    await _attach_customer_phones(db, invoices)
    return invoices


@router.get("/invoices/number/{invoice_number}", response_model=InvoiceOut)
async def invoice_by_number(invoice_number: str, db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    obj = await InvoiceRepository(db).get_by_number(invoice_number)
    if not obj or not _can_see_invoice(obj, user):
        raise NotFoundError("Invoice not found")
    await _attach_customer_phones(db, obj)
    return obj


@router.get("/invoices/{iid}", response_model=InvoiceOut)
async def get_invoice(iid: int, db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    obj = await InvoiceRepository(db).get_with_items(iid)
    if not obj or not _can_see_invoice(obj, user):
        raise NotFoundError("Invoice not found")
    await _attach_customer_phones(db, obj)
    return obj


@router.get("/invoices/{iid}/payments", response_model=list[PaymentOut])
async def invoice_payments(iid: int, db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(BM_SM)):
    obj = await InvoiceRepository(db).get_visible(iid, user.business_profile_id)
    if not obj:
        raise NotFoundError("Invoice not found")
    return await PaymentRepository(db).list(limit=100, invoice_id=iid)


# ------------------------------ Payments ------------------------------
@router.get("/payments/summary", response_model=list[PaymentMethodSummary])
async def payments_summary(db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(BM_SM)):
    return await PaymentRepository(db).summary_by_method(user.business_profile_id)
