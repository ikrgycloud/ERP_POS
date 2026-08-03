import logging
from datetime import date

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.api.deps import ErpPrincipal, apply_date_range, ensure_outlet_record_access, get_erp_principal, resolve_outlet_scope
from app.audit import record_audit
from app.database import get_db
from app.idempotency import begin_idempotent_request, complete_idempotent_request
from app.models import Customer, Order, OrderItem, Product, Supplier
from app.notification_outbox import enqueue_order_notification
from app.schemas import ApiMessage, OrderCreate, OrderItemOut, OrderOut, OrderQuoteCreate, OrderQuoteOut, OrderUpdate
from app.services import (
    active_discount_for_product,
    apply_order_inventory,
    next_number,
    order_inventory_should_apply,
    order_item_pricing,
    order_totals,
    reverse_order_inventory,
    recalculate_customer_summary,
    retry_on_deadlock,
    validate_ledger_inventory_for_sale,
)

router = APIRouter(prefix="/orders", tags=["Orders"])
logger = logging.getLogger("erp-backend")


def available_discount_for_order_item(item: OrderItem) -> dict:
    product = getattr(item, "product", None)
    if not product:
        return {"available_discount_pct": 0, "available_discount_label": None}
    quantity = item.quantity
    unit_price = getattr(product, "sell_price", None) or item.rate
    discount = active_discount_for_product(product, quantity, unit_price)
    if not discount:
        return {"available_discount_pct": 0, "available_discount_label": None}
    if discount.discount_type == "percentage":
        return {
            "available_discount_pct": discount.discount_value,
            "available_discount_label": f"{discount.discount_value}% off",
        }
    if not unit_price:
        return {
            "available_discount_pct": 0,
            "available_discount_label": f"Rs {discount.discount_value} off",
        }
    pct = (discount.discount_value / unit_price) * 100
    return {
        "available_discount_pct": pct,
        "available_discount_label": f"Rs {discount.discount_value} off",
    }


def queue_order_notification_after_commit(db: Session, order: Order) -> None:
    try:
        enqueue_order_notification(db, order)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("event=order_notification_schedule_failed order_id=%s", order.id)


def serialize_order(order: Order) -> OrderOut:
    totals = order_totals(order)
    items = [
        OrderItemOut(
            id=item.id,
            product_id=item.product_id,
            product_name=item.product.name if item.product else None,
            sku=item.product.sku if item.product else None,
            quantity=item.quantity,
            unit_type=item.unit_type,
            unit_label=item.unit_label,
            package_count=item.package_count,
            package_size=item.package_size,
            package_size_unit=item.package_size_unit,
            rate=item.rate,
            **order_item_pricing(item),
            **available_discount_for_order_item(item),
            gst_rate=item.gst_rate,
        )
        for item in order.items
    ]
    return OrderOut.model_validate(
        {
            **order.__dict__,
            **totals,
            "items": items,
            "customer_name": order.customer.name if order.customer else None,
            "customer_phone": order.customer.phone if order.customer else None,
            "supplier_name": order.supplier.name if order.supplier else None,
            "supplier_email": order.supplier.email if order.supplier else None,
            "supplier_phone": (order.supplier.phone or order.supplier.mobile) if order.supplier else None,
            "supplier_mobile": (order.supplier.phone or order.supplier.mobile) if order.supplier else None,
        }
    )


def build_order_items(db: Session, order_type: str, payload_items, business_profile_id: int | None) -> list[OrderItem]:
    items: list[OrderItem] = []
    for payload_item in payload_items:
        product = db.get(Product, payload_item.product_id)
        if not product or not product.is_active:
            raise HTTPException(status_code=404, detail=f"Product {payload_item.product_id} not found")
        if business_profile_id is not None and product.business_profile_id != business_profile_id:
            raise HTTPException(status_code=404, detail=f"Product {payload_item.product_id} not found")
        item_data = payload_item.model_dump()
        quantity = item_data["quantity"]
        if order_type == "sale":
            validate_ledger_inventory_for_sale(db, product, quantity)
            item_data["rate"] = product.sell_price
        items.append(OrderItem(**item_data))
    return items


def build_order_quote(
    db: Session,
    order_type: str,
    payload_items,
    business_profile_id: int | None,
) -> OrderQuoteOut:
    with db.no_autoflush:
        quote_order = Order(type=order_type)
        quote_items: list[OrderItem] = []
        for payload_item in payload_items:
            product = db.get(Product, payload_item.product_id)
            if not product or not product.is_active:
                raise HTTPException(status_code=404, detail=f"Product {payload_item.product_id} not found")
            if business_profile_id is not None and product.business_profile_id != business_profile_id:
                raise HTTPException(status_code=404, detail=f"Product {payload_item.product_id} not found")
            item_data = payload_item.model_dump()
            if order_type == "sale":
                item_data["rate"] = product.sell_price
            quote_item = OrderItem(**item_data)
            quote_item.product = product
            quote_item.order = quote_order
            quote_items.append(quote_item)
        quote_order.items = quote_items
        totals = order_totals(quote_order)
        items = [
            OrderItemOut(
                id=index,
                product_id=item.product_id,
                product_name=item.product.name if item.product else None,
                sku=item.product.sku if item.product else None,
                quantity=item.quantity,
                unit_type=item.unit_type,
                unit_label=item.unit_label,
                package_count=item.package_count,
                package_size=item.package_size,
                package_size_unit=item.package_size_unit,
                rate=item.rate,
                **order_item_pricing(item),
                **available_discount_for_order_item(item),
                gst_rate=item.gst_rate,
            )
            for index, item in enumerate(quote_items, start=1)
        ]
    return OrderQuoteOut.model_validate({**totals, "items": items})


def validate_order_parties(
    db: Session,
    payload: OrderCreate | OrderUpdate,
    business_profile_id: int | None,
) -> None:
    if payload.customer_id is not None:
        customer = db.get(Customer, payload.customer_id)
        if not customer or not customer.is_active:
            raise HTTPException(status_code=404, detail="Customer not found")
        if payload.outlet_id is not None and customer.outlet_id != payload.outlet_id:
            raise HTTPException(status_code=400, detail="Customer does not belong to the selected outlet")
    supplier = db.get(Supplier, payload.supplier_id) if payload.supplier_id is not None else None
    if payload.supplier_id is not None:
        if not supplier or not supplier.is_active:
            raise HTTPException(status_code=404, detail="Supplier not found")
        if business_profile_id is not None and supplier.business_profile_id not in {None, business_profile_id}:
            raise HTTPException(status_code=404, detail="Supplier not found")
    if payload.type == "purchase" and payload.supplier_id is None and payload.outlet_id is None:
        raise HTTPException(status_code=400, detail="Supplier is required for purchase orders")
    if payload.party_type == "B2C" and payload.customer_id is None:
        raise HTTPException(status_code=400, detail="Customer registration is required for B2C orders")


@router.get("", response_model=list[OrderOut])
def list_orders(
    search: str | None = None,
    order_type: str | None = Query(default=None, alias="type"),
    party_type: str | None = Query(default=None, alias="partyType"),
    status_filter: str | None = Query(default=None, alias="status"),
    payment_status: str | None = Query(default=None, alias="paymentStatus"),
    outlet_id: int | None = Query(default=None, alias="outletId"),
    customer_id: int | None = Query(default=None, alias="customerId"),
    start_date: date | None = Query(default=None, alias="startDate"),
    end_date: date | None = Query(default=None, alias="endDate"),
    cursor: int | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> list[OrderOut]:
    query = db.query(Order).options(
        selectinload(Order.items).selectinload(OrderItem.product),
        selectinload(Order.customer),
        selectinload(Order.supplier),
    )
    business_profile_id = principal.business_profile_id
    outlet_id = resolve_outlet_scope(outlet_id, principal)
    query = query.filter(Order.business_profile_id == business_profile_id)
    query = query.filter(Order.status != "Deleted")
    query = apply_date_range(query, Order, start_date, end_date)
    if search:
        pattern = f"%{search}%"
        query = query.filter(or_(Order.order_number.ilike(pattern), Order.party_name.ilike(pattern)))
    if order_type:
        query = query.filter(Order.type == order_type)
    if party_type:
        query = query.filter(Order.party_type == party_type)
    if status_filter:
        query = query.filter(Order.status == status_filter)
    if payment_status:
        query = query.filter(Order.payment_status == payment_status)
    if outlet_id:
        query = query.filter(Order.outlet_id == outlet_id)
    if customer_id:
        query = query.filter(Order.customer_id == customer_id)
    if cursor is not None:
        orders = query.filter(Order.id < cursor).order_by(Order.id.desc()).limit(limit).all()
        return [serialize_order(order) for order in orders]
    orders = query.order_by(Order.date.desc(), Order.id.desc()).offset(skip).limit(limit).all()
    return [serialize_order(order) for order in orders]


@router.post("/quote", response_model=OrderQuoteOut)
def quote_order(
    payload: OrderQuoteCreate,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> OrderQuoteOut:
    if not payload.items:
        return OrderQuoteOut(items=[])
    return build_order_quote(db, payload.type, payload.items, principal.business_profile_id)


@router.post("", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
@retry_on_deadlock()
def create_order(
    payload: OrderCreate,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> OrderOut:
    business_profile_id = principal.business_profile_id
    payload.outlet_id = resolve_outlet_scope(payload.outlet_id, principal)
    idem = begin_idempotent_request(db, idempotency_key, "ERP:POST:/orders", payload.model_dump())
    if idem.replay_body is not None:
        return idem.replay_body
    if not payload.items:
        raise HTTPException(status_code=400, detail="Order must contain at least one item")
    validate_order_parties(db, payload, business_profile_id)
    order = Order(
        order_number=next_number(db, Order, "order_number", "ORD"),
        business_profile_id=business_profile_id or payload.business_profile_id,
        type=payload.type,
        party_type=payload.party_type,
        party_name=payload.party_name,
        outlet_id=payload.outlet_id,
        customer_id=payload.customer_id,
        supplier_id=payload.supplier_id,
        status=payload.status,
        date=payload.date,
        payment_status=payload.payment_status,
    )
    order.items = build_order_items(db, payload.type, payload.items, business_profile_id)
    db.add(order)
    db.flush()
    should_apply_inventory = order_inventory_should_apply(order.type, order.status)
    if should_apply_inventory:
        apply_order_inventory(db, order.type, order.items)
    order.inventory_applied = should_apply_inventory
    db.flush()
    recalculate_customer_summary(db, order.customer_id)
    record_audit(db, action="create", entity_type="order", entity_id=order.id, details=payload.model_dump())
    complete_idempotent_request(idem, serialize_order(order), status.HTTP_201_CREATED)
    db.commit()
    db.refresh(order)
    if should_apply_inventory:
        queue_order_notification_after_commit(db, order)
    return serialize_order(order)


@router.put("/{order_id}", response_model=OrderOut)
@retry_on_deadlock()
def update_order(
    order_id: int,
    payload: OrderUpdate,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> OrderOut:
    business_profile_id = principal.business_profile_id
    order = db.query(Order).filter(Order.id == order_id).with_for_update().first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if business_profile_id is not None and order.business_profile_id != business_profile_id:
        raise HTTPException(status_code=404, detail="Order not found")
    ensure_outlet_record_access(order.outlet_id, principal)
    payload.outlet_id = resolve_outlet_scope(payload.outlet_id, principal)
    validate_order_parties(db, payload, business_profile_id)
    old_customer_id = order.customer_id
    was_inventory_applied = order.inventory_applied
    if was_inventory_applied:
        reverse_order_inventory(db, order)
    order.type = payload.type
    order.party_type = payload.party_type
    order.party_name = payload.party_name
    order.outlet_id = payload.outlet_id
    order.customer_id = payload.customer_id
    order.supplier_id = payload.supplier_id
    order.status = payload.status
    order.date = payload.date
    order.payment_status = payload.payment_status
    order.business_profile_id = business_profile_id or payload.business_profile_id or order.business_profile_id
    order.items = build_order_items(db, payload.type, payload.items, business_profile_id)
    db.flush()
    should_apply_inventory = order_inventory_should_apply(order.type, order.status)
    if should_apply_inventory:
        apply_order_inventory(db, order.type, order.items)
    order.inventory_applied = should_apply_inventory
    db.flush()
    recalculate_customer_summary(db, old_customer_id)
    if order.customer_id != old_customer_id:
        recalculate_customer_summary(db, order.customer_id)
    record_audit(db, action="update", entity_type="order", entity_id=order.id, details=payload.model_dump())
    db.commit()
    db.refresh(order)
    if should_apply_inventory and not was_inventory_applied:
        queue_order_notification_after_commit(db, order)
    return serialize_order(order)


@router.delete("/{order_id}", response_model=ApiMessage)
@retry_on_deadlock()
def delete_order(
    order_id: int,
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> ApiMessage:
    business_profile_id = principal.business_profile_id
    order = db.query(Order).filter(Order.id == order_id).with_for_update().first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if business_profile_id is not None and order.business_profile_id != business_profile_id:
        raise HTTPException(status_code=404, detail="Order not found")
    ensure_outlet_record_access(order.outlet_id, principal)
    customer_id = order.customer_id
    if order.inventory_applied:
        reverse_order_inventory(db, order)
        order.inventory_applied = False
    order.status = "Deleted"
    db.flush()
    recalculate_customer_summary(db, customer_id)
    record_audit(db, action="archive", entity_type="order", entity_id=order.id, details={"orderNumber": order.order_number})
    db.commit()
    return ApiMessage(message="Order deleted")
