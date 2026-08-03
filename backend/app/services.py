from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from functools import wraps
import logging
from time import sleep

from fastapi import HTTPException, status
from sqlalchemy.exc import DBAPIError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Customer,
    InventoryLedger,
    Invoice,
    Order,
    OrderItem,
    Product,
    ProductDiscount,
    ProductQuantity,
    DocumentSequence,
    Waybill,
)
from shared_domain.inventory import (
    InventoryMovement,
    InventoryMovementService,
    InventoryMovementType,
)
from shared_domain.finance import FinancialLedgerService

VALID_LEDGER_TYPES = {
    "PURCHASE",
    "SALE",
    "RETURN",
    "DAMAGE",
    "EXPIRED",
    "QUARANTINE",
    "TRANSFER",
    "ADJUSTMENT",
    "RESERVATION",
    "LOST",
    "STOCK_COUNT",
    "SUPPLIER_RETURN",
    "SUPPLIER_REPLACEMENT",
    "SUPPLIER_REJECT",
    "SUPPLIER_CREDIT",
    "SCRAP",
    "REPAIR",
}
logger = logging.getLogger("erp-backend.inventory")

MOVEMENT_BY_LEDGER_TYPE = {
    "PURCHASE": InventoryMovementType.PURCHASE,
    "SALE": InventoryMovementType.SALE,
    "RETURN": InventoryMovementType.RETURN,
    "DAMAGE": InventoryMovementType.DAMAGE,
    "EXPIRED": InventoryMovementType.EXPIRY,
    "QUARANTINE": InventoryMovementType.QUARANTINE,
    "TRANSFER": InventoryMovementType.TRANSFER,
    "ADJUSTMENT": InventoryMovementType.ADJUSTMENT,
    "RESERVATION": InventoryMovementType.RESERVATION,
    "LOST": InventoryMovementType.LOST,
    "STOCK_COUNT": InventoryMovementType.STOCK_COUNT,
    "SUPPLIER_RETURN": InventoryMovementType.SUPPLIER_RETURN,
    "SUPPLIER_REPLACEMENT": InventoryMovementType.SUPPLIER_REPLACEMENT,
    "SUPPLIER_REJECT": InventoryMovementType.SUPPLIER_REJECT,
    "SUPPLIER_CREDIT": InventoryMovementType.SUPPLIER_CREDIT,
    "SCRAP": InventoryMovementType.SCRAP,
    "REPAIR": InventoryMovementType.REPAIR,
}


def is_deadlock_error(exc: BaseException) -> bool:
    original = getattr(exc, "orig", exc)
    return (
        getattr(original, "pgcode", None) == "40P01"
        or getattr(original, "sqlstate", None) == "40P01"
        or "deadlock" in str(original).lower()
    )


def deadlock_backoff(attempt: int) -> None:
    sleep(0.1 * (2 ** attempt))


def retry_on_deadlock(max_retries: int = 3):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            db = kwargs.get("db")
            if db is None:
                db = next((arg for arg in args if isinstance(arg, Session)), None)
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except DBAPIError as exc:
                    if not is_deadlock_error(exc) or attempt == max_retries - 1:
                        logger.exception(
                            "event=erp_deadlock_retry_failed function=%s attempt=%s deadlock=%s",
                            func.__name__,
                            attempt + 1,
                            is_deadlock_error(exc),
                        )
                        raise
                    if db is not None:
                        db.rollback()
                    logger.warning(
                        "event=erp_deadlock_retry function=%s attempt=%s",
                        func.__name__,
                        attempt + 1,
                    )
                    deadlock_backoff(attempt)
            return func(*args, **kwargs)

        return wrapper

    return decorator


def product_metrics(product: Product) -> dict[str, Decimal | int]:
    remaining = product.qty_bought - product.qty_sold
    revenue = Decimal(product.qty_sold) * product.sell_price
    cost = Decimal(product.qty_sold) * product.buy_price
    profit = revenue - cost
    margin = Decimal("0") if revenue == 0 else (profit / revenue) * Decimal("100")
    inventory_value = Decimal(remaining) * product.buy_price
    return {
        "remaining": remaining,
        "revenue": revenue,
        "profit": profit,
        "margin": margin,
        "inventory_value": inventory_value,
    }


def product_metrics_from_cache(product: Product) -> dict[str, Decimal | int]:
    remaining = max(Decimal("0"), Decimal(product.stock_cached or 0))
    sold_quantity = max(Decimal("0"), Decimal(product.qty_sold or 0))
    revenue = sold_quantity * product.sell_price
    cost = sold_quantity * product.buy_price
    profit = revenue - cost
    margin = Decimal("0") if revenue == 0 else (profit / revenue) * Decimal("100")
    inventory_value = remaining * product.buy_price
    return {
        "remaining": remaining,
        "revenue": revenue,
        "profit": profit,
        "margin": margin,
        "inventory_value": inventory_value,
    }


def ledger_stock(db: Session, product_id: int, outlet_id: int | None = None) -> Decimal:
    product = db.get(Product, product_id)
    if not product:
        return Decimal("0")
    return reconcile_product_stock_cache(db, product)


def reconcile_product_stock_cache(db: Session, product: Product) -> Decimal:
    ledger_total = Decimal(
        db.query(func.coalesce(func.sum(InventoryLedger.quantity), 0))
        .filter(
            InventoryLedger.product_id == product.id,
        )
        .scalar()
        or 0
    )
    # The shared inventory ledger is authoritative. Product counters are
    # reporting fields and must never be used to manufacture stock movements.
    reconciled = max(Decimal("0"), ledger_total)
    if Decimal(product.stock_cached or 0) != reconciled:
        product.stock_cached = reconciled
    return reconciled


def product_metrics_from_ledger(
    db: Session,
    product: Product,
    outlet_id: int | None = None,
) -> dict[str, Decimal | int]:
    remaining = reconcile_product_stock_cache(db, product)
    sold_quantity = max(Decimal("0"), Decimal(product.qty_sold or 0))
    revenue = sold_quantity * product.sell_price
    cost = sold_quantity * product.buy_price
    profit = revenue - cost
    margin = Decimal("0") if revenue == 0 else (profit / revenue) * Decimal("100")
    inventory_value = remaining * product.buy_price
    return {
        "remaining": remaining,
        "revenue": revenue,
        "profit": profit,
        "margin": margin,
        "inventory_value": inventory_value,
    }


def record_inventory_ledger(
    db: Session,
    product: Product,
    ledger_type: str,
    quantity: Decimal,
    reference_type: str | None = None,
    reference_id: int | str | None = None,
    outlet_id: int | None = None,
    idempotency_key: str | None = None,
    user_id: str | None = None,
    source: str = "ERP",
) -> InventoryLedger | None:
    normalized_type = ledger_type.upper()
    if normalized_type not in VALID_LEDGER_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid inventory ledger type: {ledger_type}",
        )
    reference_id_text = str(reference_id) if reference_id is not None else None
    if idempotency_key:
        existing_entry = (
            db.query(InventoryLedger)
            .filter(InventoryLedger.idempotency_key == idempotency_key)
            .first()
        )
        if existing_entry:
            logger.info(
                "event=inventory_idempotent_replay product_id=%s idempotency_key=%s source=%s reference_id=%s",
                product.id,
                idempotency_key,
                source,
                reference_id_text,
            )
            return existing_entry
    quantity_decimal = Decimal(quantity)
    current_stock = Decimal(product.stock_cached or 0)
    movement_type = MOVEMENT_BY_LEDGER_TYPE[normalized_type]
    if movement_type == InventoryMovementType.SALE:
        movement_quantity = abs(quantity_decimal)
    elif quantity_decimal < 0:
        movement_type = InventoryMovementType.ADJUSTMENT
        movement_quantity = quantity_decimal
    else:
        movement_quantity = quantity_decimal
    try:
        movement_result = InventoryMovementService().apply(
            InventoryMovement(
                movement_type=movement_type,
                product_id=product.id,
                quantity=movement_quantity,
                business_profile_id=product.business_profile_id,
                outlet_id=outlet_id,
                reason=normalized_type.lower(),
                reference_type=reference_type,
                reference_id=reference_id_text,
                idempotency_key=idempotency_key,
                user_id=user_id,
                source=source,
            ),
            current_stock=current_stock,
        )
    except ValueError as exc:
        logger.warning(
            "event=inventory_negative_blocked product_id=%s change=%s current_stock=%s source=%s reference_id=%s",
            product.id,
            quantity,
            current_stock,
            source,
            reference_id_text,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Only {current_stock} units available for {product.name}",
        ) from exc
    product.stock_cached = movement_result.new_stock
    ledger_entry = InventoryLedger(
        product_id=product.id,
        business_profile_id=product.business_profile_id,
        outlet_id=outlet_id,
        type=normalized_type,
        quantity=movement_result.ledger_entry.quantity_delta,
        idempotency_key=idempotency_key,
        user_id=user_id,
        source=source,
        reference_type=reference_type,
        reference_id=reference_id_text,
    )
    db.add(ledger_entry)
    logger.info(
        "event=inventory_update product_id=%s change=%s new_stock=%s source=%s reference_type=%s reference_id=%s idempotency_key=%s",
        product.id,
        quantity,
        product.stock_cached,
        source,
        reference_type,
        reference_id_text,
        idempotency_key,
    )
    return ledger_entry


def discount_savings_amount(discount: ProductDiscount, quantity: Decimal, unit_price: Decimal) -> Decimal:
    gross = quantity * unit_price
    if gross <= 0:
        return Decimal("0")
    if discount.discount_type == "percentage":
        return max(Decimal("0"), (gross * discount.discount_value) / Decimal("100"))
    return min(gross, quantity * discount.discount_value)


def order_item_discount_amount(item: OrderItem) -> Decimal:
    product = getattr(item, "product", None)
    order = getattr(item, "order", None)
    if not product or (order is not None and order.type != "sale"):
        return Decimal("0")
    quantity = Decimal(item.quantity)
    rate = Decimal(item.rate)
    discount = active_discount_for_product(product, quantity, rate)
    if not discount:
        return Decimal("0")
    return discount_savings_amount(discount, quantity, rate)


def order_item_discount_label(item: OrderItem) -> str | None:
    product = getattr(item, "product", None)
    order = getattr(item, "order", None)
    if not product or (order is not None and order.type != "sale"):
        return None
    discount = active_discount_for_product(product, Decimal(item.quantity), Decimal(item.rate))
    if not discount:
        return None
    if discount.discount_type == "percentage":
        return f"{discount.discount_value}% off"
    return f"Rs {discount.discount_value} off"


def order_item_discount_pct(item: OrderItem) -> Decimal:
    subtotal = Decimal(item.quantity) * Decimal(item.rate)
    if subtotal <= 0:
        return Decimal("0")
    return (order_item_discount_amount(item) / subtotal) * Decimal("100")


def order_item_pricing(item: OrderItem) -> dict[str, Decimal | str | None]:
    quantity = Decimal(item.quantity)
    subtotal = quantity * Decimal(item.rate)
    discount_amount = order_item_discount_amount(item)
    line_total = max(Decimal("0"), subtotal - discount_amount)
    return {
        "line_subtotal": subtotal,
        "discount_amount": discount_amount,
        "discount_pct": order_item_discount_pct(item),
        "discount_label": order_item_discount_label(item),
        "line_total": line_total,
    }


def order_totals(order: Order) -> dict[str, Decimal]:
    subtotal_value = Decimal("0")
    discount_value = Decimal("0")
    taxable_value = Decimal("0")
    tax_value = Decimal("0")
    for item in order.items:
        pricing = order_item_pricing(item)
        line_taxable = Decimal(pricing["line_total"])
        subtotal_value += Decimal(pricing["line_subtotal"])
        discount_value += Decimal(pricing["discount_amount"])
        taxable_value += line_taxable
        tax_value += (line_taxable * item.gst_rate) / Decimal("100")
    return {
        "subtotal_value": subtotal_value,
        "discount_value": discount_value,
        "discount_amount": discount_value,
        "taxable_value": taxable_value,
        "tax_value": tax_value,
        "grand_total": taxable_value + tax_value,
    }


def invoice_total(invoice: Invoice) -> Decimal:
    return FinancialLedgerService().invoice_total(
        taxable_value=invoice.taxable_value,
        cgst=invoice.cgst,
        sgst=invoice.sgst,
        igst=invoice.igst,
    )


def is_approved_reverse_invoice(invoice: Invoice) -> bool:
    return invoice.is_reverse and invoice.status in {"Approved", "Refunded"}


def invoice_refunded_total(invoice: Invoice) -> Decimal:
    if invoice.is_reverse:
        return invoice_total(invoice) if is_approved_reverse_invoice(invoice) else Decimal("0")
    return sum(
        invoice_total(linked_invoice)
        for linked_invoice in getattr(invoice, "linked_invoices", [])
        if is_approved_reverse_invoice(linked_invoice)
    )


def invoice_net_total(invoice: Invoice) -> Decimal:
    if invoice.is_reverse:
        return Decimal("0")
    return max(Decimal("0"), invoice_total(invoice) - invoice_refunded_total(invoice))


def invoice_direction_for_order(order: Order) -> str:
    if order.party_type == "B2C" or order.customer_id is not None:
        return "outlet_to_customer"
    if order.type == "purchase":
        return "admin_to_outlet"
    return "outlet_to_admin"


def order_inventory_should_apply(order_type: str, order_status: str) -> bool:
    normalized_status = (order_status or "").strip().lower()
    if order_type == "purchase":
        return normalized_status == "received"
    if order_type == "sale":
        return normalized_status in {"delivered", "received"}
    return False


def active_discount_for_product(
    product: Product,
    quantity: Decimal = Decimal("1"),
    unit_price: Decimal | None = None,
) -> ProductDiscount | None:
    today = date.today()
    price = Decimal(unit_price if unit_price is not None else product.sell_price)
    eligible = []
    for discount in getattr(product, "discounts", []):
        if not discount.is_active:
            continue
        if discount.start_date and discount.start_date > today:
            continue
        if discount.end_date and discount.end_date < today:
            continue
        if quantity < discount.min_quantity:
            continue
        eligible.append(discount)
    if not eligible:
        return None
    return sorted(
        eligible,
        key=lambda item: (
            discount_savings_amount(item, quantity, price),
            item.start_date or date.min,
            item.created_at or datetime.min,
            item.id or 0,
        ),
        reverse=True,
    )[0]


def discounted_price(product: Product, quantity: Decimal = Decimal("1")) -> Decimal:
    discount = active_discount_for_product(product, quantity)
    price = Decimal(product.sell_price)
    if not discount:
        return price
    if discount.discount_type == "percentage":
        return max(Decimal("0"), price - ((price * discount.discount_value) / Decimal("100")))
    return max(Decimal("0"), price - discount.discount_value)


def next_number(
    db: Session,
    model: type[Order] | type[Invoice] | type[Waybill] | type[Product],
    field_name: str,
    prefix: str,
    offset: int = 0,
) -> str:
    year = date.today().year
    family = f"{prefix}-{year}"
    sequence = db.query(DocumentSequence).filter(DocumentSequence.family == family).with_for_update().first()
    if sequence is None:
        sequence = DocumentSequence(family=family, next_value=1)
        db.add(sequence)
        db.flush()
    value = int(sequence.next_value) + offset
    sequence.next_value = value + 1
    return f"{prefix}-{year}-{value:04d}"


def _waybill_route_labels(invoice: Invoice) -> tuple[str, str]:
    if invoice.invoice_direction == "admin_to_outlet":
        return "Admin", invoice.party_name
    if invoice.invoice_direction == "outlet_to_admin":
        return invoice.party_name, "Admin"
    return invoice.order.party_name if invoice.order else invoice.party_name, invoice.party_name


def create_waybill_for_invoice(db: Session, invoice: Invoice) -> Waybill:
    existing_waybill = db.query(Waybill).filter(Waybill.invoice_id == invoice.id).first()
    if existing_waybill:
        return existing_waybill

    generated_at = datetime.now(timezone.utc)
    from_name, to_name = _waybill_route_labels(invoice)
    waybill = Waybill(
        waybill_number=next_number(db, Waybill, "waybill_number", "WB"),
        invoice_id=invoice.id,
        generated_at=generated_at,
        valid_until=generated_at + timedelta(hours=24),
        status="Active",
        transport_mode="Unspecified",
        vehicle_number="",
        from_name=from_name,
        to_name=to_name,
    )
    db.add(waybill)
    db.flush()
    return waybill


def get_product_or_404(db: Session, product_id: int) -> Product:
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return product


def get_product_for_update_or_404(db: Session, product_id: int) -> Product:
    product = db.query(Product).filter(Product.id == product_id).with_for_update().first()
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return product


def validate_inventory_for_sale(product: Product, quantity: Decimal) -> None:
    remaining = product.qty_bought - product.qty_sold
    if quantity > remaining:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Only {remaining} units available for {product.name}",
        )


def validate_ledger_inventory_for_sale(db: Session, product: Product, quantity: Decimal) -> None:
    remaining = reconcile_product_stock_cache(db, product)
    if quantity > remaining:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Only {remaining} units available for {product.name}",
        )


def record_product_quantity(
    db: Session,
    product: Product,
    transaction_type: str,
    quantity_change: Decimal,
    old_stock: Decimal,
    new_stock: Decimal,
    sold_stock: Decimal,
    remaining_quantity: Decimal | None = None,
    reference_order_id: int | None = None,
    effective_date: date | None = None,
    note: str | None = None,
    idempotency_key: str | None = None,
    source: str = "ERP",
    user_id: str | None = None,
) -> None:
    if remaining_quantity is None:
        remaining_quantity = Decimal(product.qty_bought) - Decimal(product.qty_sold)
    ledger_type_by_transaction = {
        "opening_stock": "PURCHASE" if quantity_change >= 0 else "ADJUSTMENT",
        "manual_adjustment": "ADJUSTMENT",
        "purchase_received": "PURCHASE",
        "sale_delivered": "SALE",
        "purchase_reversed": "RETURN",
        "sale_reversed": "ADJUSTMENT",
        "file_import": "PURCHASE",
        "file_import_stock": "PURCHASE",
        "file_import_new_product": "PURCHASE",
    }
    ledger_entry = record_inventory_ledger(
        db,
        product,
        ledger_type_by_transaction.get(transaction_type, "ADJUSTMENT"),
        Decimal(quantity_change),
        reference_type="ORDER" if reference_order_id else transaction_type.upper(),
        reference_id=reference_order_id,
        idempotency_key=(
            idempotency_key
            or f"{source}:{transaction_type}:{product.id}:{reference_order_id or note or effective_date or date.today()}:{quantity_change}"
        ),
        source=source,
        user_id=user_id,
    )
    if idempotency_key and ledger_entry is not None and ledger_entry.id is not None:
        return
    db.add(
        ProductQuantity(
            product_id=product.id,
            business_profile_id=product.business_profile_id,
            transaction_type=transaction_type,
            quantity_change=quantity_change,
            old_stock=old_stock,
            new_stock=new_stock,
            sold_stock=sold_stock,
            effective_date=effective_date or date.today(),
            remaining_quantity=remaining_quantity,
            reference_order_id=reference_order_id,
            note=note,
        )
    )


def apply_order_inventory(db: Session, order_type: str, items: list[OrderItem]) -> None:
    for item in sorted(items, key=lambda order_item: (order_item.product_id, order_item.id or 0)):
        product = get_product_for_update_or_404(db, item.product_id)
        old_stock = Decimal(product.qty_bought)
        old_sold = Decimal(product.qty_sold)
        if order_type == "purchase":
            product.qty_bought += item.quantity
            transaction_type = "purchase_received"
            quantity_change = Decimal(item.quantity)
            display_new_stock = Decimal(item.quantity)
        elif order_type == "sale":
            validate_ledger_inventory_for_sale(db, product, item.quantity)
            product.qty_sold += item.quantity
            transaction_type = "sale_delivered"
            quantity_change = -Decimal(item.quantity)
            display_new_stock = Decimal(product.qty_bought)
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid order type")
        record_product_quantity(
            db,
            product,
            transaction_type=transaction_type,
            quantity_change=quantity_change,
            old_stock=old_stock,
            new_stock=display_new_stock,
            sold_stock=Decimal(product.qty_sold),
            remaining_quantity=Decimal(product.qty_bought) - Decimal(product.qty_sold),
            reference_order_id=item.order_id,
            note=f"{transaction_type} for order item {item.id or 'new'}",
            idempotency_key=f"ERP:ORDER:{item.order_id}:{item.id or product.id}:{transaction_type}:{item.quantity}",
            source="ERP",
        )


def reverse_order_inventory(db: Session, order: Order) -> None:
    for item in sorted(order.items, key=lambda order_item: (order_item.product_id, order_item.id or 0)):
        product = get_product_for_update_or_404(db, item.product_id)
        old_stock = Decimal(product.qty_bought)
        old_sold = Decimal(product.qty_sold)
        if order.type == "purchase":
            product.qty_bought = max(0, product.qty_bought - item.quantity)
            transaction_type = "purchase_reversed"
            quantity_change = -Decimal(item.quantity)
        elif order.type == "sale":
            product.qty_sold = max(0, product.qty_sold - item.quantity)
            transaction_type = "sale_reversed"
            quantity_change = Decimal(item.quantity)
        else:
            continue
        record_product_quantity(
            db,
            product,
            transaction_type=transaction_type,
            quantity_change=quantity_change,
            old_stock=old_stock,
            new_stock=Decimal(product.qty_bought),
            sold_stock=Decimal(product.qty_sold),
            remaining_quantity=Decimal(product.qty_bought) - Decimal(product.qty_sold),
            reference_order_id=order.id,
            note=f"{transaction_type} for order {order.order_number}",
            idempotency_key=f"ERP:ORDER_REVERSE:{order.id}:{item.id}:{transaction_type}:{item.quantity}",
            source="ERP",
        )


def reverse_invoice_inventory(db: Session, invoice: Invoice) -> None:
    if not invoice.order or not invoice.order.inventory_applied:
        return
    reverse_order_inventory(db, invoice.order)
    invoice.order.inventory_applied = False


def recalculate_customer_summary(db: Session, customer_id: int | None) -> None:
    if customer_id is None:
        return
    customer = db.get(Customer, customer_id)
    if not customer:
        return

    sale_orders = (
        db.query(Order)
        .filter(Order.customer_id == customer_id, Order.type == "sale")
        .order_by(Order.date.desc(), Order.id.desc())
        .all()
    )
    total_spent = Decimal("0")
    purchase_count = 0
    last_purchase_amount = Decimal("0")
    last_purchase_at = None

    for order in sale_orders:
        if order.status in {"Deleted", "Cancelled"}:
            continue

        invoices = [invoice for invoice in order.invoices if invoice.status != "Deleted"]
        non_reverse_invoices = [invoice for invoice in invoices if not invoice.is_reverse]
        if non_reverse_invoices:
            net_total = sum((invoice_total(invoice) for invoice in non_reverse_invoices), Decimal("0"))
            net_total -= sum(
                (invoice_total(invoice) for invoice in invoices if is_approved_reverse_invoice(invoice)),
                Decimal("0"),
            )
            activity_date = max(invoice.date for invoice in non_reverse_invoices)
        else:
            # A saved sale order is customer activity even before its invoice is generated.
            # This keeps the Customer screen useful during the normal order-to-invoice flow.
            net_total = Decimal(order_totals(order)["grand_total"])
            activity_date = order.date

        net_total = max(Decimal("0"), net_total)
        if net_total <= 0:
            continue
        total_spent += net_total
        purchase_count += 1
        activity_at = datetime.combine(activity_date, datetime.min.time())
        if last_purchase_at is None or activity_at > last_purchase_at:
            last_purchase_amount = net_total
            last_purchase_at = activity_at

    customer.total_spent = total_spent
    customer.purchase_count = purchase_count
    customer.last_purchase_amount = last_purchase_amount
    customer.last_purchase_at = last_purchase_at
    customer.loyalty_points = int(total_spent // Decimal("100"))
