from decimal import Decimal
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func
from sqlalchemy.orm import aliased
from sqlalchemy.orm import Session

from app.api.deps import ErpPrincipal, apply_date_range, get_erp_principal, resolve_outlet_scope
from app.database import get_db
from app.inventory_value_service import InventoryValueService
from app.models import Invoice, Order, OrderItem, Product, ProductQuantity
from app.schemas import DashboardSummary, InventoryValueTimelinePoint
from shared_domain.dashboard import DashboardAggregationService
from shared_domain.finance import FinancialLedgerSummary

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


def _decimal(value) -> Decimal:
    return Decimal(value or 0)


@router.get("/inventory-value-report")
def get_inventory_value_report(
    start_date: date | None = Query(default=None, alias="startDate"),
    end_date: date | None = Query(default=None, alias="endDate"),
    outlet_id: int | None = Query(default=None, alias="outletId"),
    category_id: int | None = Query(default=None, alias="categoryId"),
    supplier_id: int | None = Query(default=None, alias="supplierId"),
    product_id: int | None = Query(default=None, alias="productId"),
    search: str | None = Query(default=None),
    movement_type: str | None = Query(default=None, alias="movementType"),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> dict:
    """Version-1 database report contract for the Inventory Value workspace."""
    resolve_outlet_scope(outlet_id, principal)
    report_end = end_date or date.today()
    report_start = start_date or report_end
    if report_start > report_end:
        report_start, report_end = report_end, report_start
    return InventoryValueService().build_report(
        db,
        business_profile_id=principal.business_profile_id,
        start_date=report_start,
        end_date=report_end,
        category_id=category_id,
        supplier_id=supplier_id,
        product_id=product_id,
        search=search,
        movement_type=movement_type,
    )


@router.get("/inventory-value-timeline", response_model=list[InventoryValueTimelinePoint])
def get_inventory_value_timeline(
    outlet_id: int | None = Query(default=None, alias="outletId"),
    start_date: date | None = Query(default=None, alias="startDate"),
    end_date: date | None = Query(default=None, alias="endDate"),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> list[InventoryValueTimelinePoint]:
    business_profile_id = principal.business_profile_id
    resolve_outlet_scope(outlet_id, principal)
    timeline_end = end_date or date.today()
    earliest_movement_date = (
        db.query(func.min(ProductQuantity.effective_date))
        .join(Product, Product.id == ProductQuantity.product_id)
        .filter(Product.business_profile_id == business_profile_id, Product.is_active.is_(True))
        .scalar()
    )
    timeline_start = start_date or earliest_movement_date or timeline_end
    if timeline_start > timeline_end:
        timeline_start, timeline_end = timeline_end, timeline_start

    current_inventory_value = _decimal(
        db.query(func.coalesce(func.sum(Product.stock_cached * Product.buy_price), 0))
        .filter(Product.business_profile_id == business_profile_id, Product.is_active.is_(True))
        .scalar()
    )

    movement_rows = (
        db.query(
            ProductQuantity.effective_date.label("movement_date"),
            func.coalesce(func.sum(ProductQuantity.quantity_change * Product.buy_price), 0).label("change_value"),
            func.coalesce(
                func.sum(
                    case(
                        (ProductQuantity.quantity_change > 0, ProductQuantity.quantity_change * Product.buy_price),
                        else_=0,
                    )
                ),
                0,
            ).label("inbound_value"),
            func.coalesce(
                func.sum(
                    case(
                        (ProductQuantity.quantity_change < 0, ProductQuantity.quantity_change * Product.buy_price),
                        else_=0,
                    )
                ),
                0,
            ).label("outbound_value"),
            func.count(ProductQuantity.id).label("movement_count"),
        )
        .join(Product, Product.id == ProductQuantity.product_id)
        .filter(
            Product.business_profile_id == business_profile_id,
            Product.is_active.is_(True),
            ProductQuantity.effective_date >= timeline_start,
            ProductQuantity.effective_date <= timeline_end,
        )
        .group_by(ProductQuantity.effective_date)
        .all()
    )
    movements_by_date = {
        row.movement_date: {
            "change_value": _decimal(row.change_value),
            "inbound_value": _decimal(row.inbound_value),
            "outbound_value": _decimal(row.outbound_value),
            "movement_count": int(row.movement_count or 0),
        }
        for row in movement_rows
    }

    running_value = current_inventory_value
    points_desc: list[InventoryValueTimelinePoint] = []
    current_date = timeline_end
    while current_date >= timeline_start:
        movement = movements_by_date.get(
            current_date,
            {
                "change_value": Decimal("0"),
                "inbound_value": Decimal("0"),
                "outbound_value": Decimal("0"),
                "movement_count": 0,
            },
        )
        points_desc.append(
            InventoryValueTimelinePoint(
                date=current_date,
                inventory_value=max(Decimal("0"), running_value),
                change_value=movement["change_value"],
                inbound_value=movement["inbound_value"],
                outbound_value=movement["outbound_value"],
                movement_count=movement["movement_count"],
            )
        )
        running_value -= movement["change_value"]
        current_date -= timedelta(days=1)

    return list(reversed(points_desc))


@router.get("", response_model=DashboardSummary)
def get_dashboard_summary(
    outlet_id: int | None = Query(default=None, alias="outletId"),
    start_date: date | None = Query(default=None, alias="startDate"),
    end_date: date | None = Query(default=None, alias="endDate"),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> DashboardSummary:
    product_query = db.query(Product)
    order_query = db.query(Order)
    invoice_query = db.query(Invoice)

    business_profile_id = principal.business_profile_id
    outlet_id = resolve_outlet_scope(outlet_id, principal)
    product_query = product_query.filter(Product.business_profile_id == business_profile_id, Product.is_active.is_(True))
    order_query = order_query.filter(Order.business_profile_id == business_profile_id)
    invoice_query = invoice_query.filter(Invoice.business_profile_id == business_profile_id)

    if outlet_id is not None:
        order_query = order_query.filter(Order.outlet_id == outlet_id)
        invoice_query = invoice_query.filter(Invoice.outlet_id == outlet_id)

    inactive_statuses = {"Deleted", "Cancelled"}
    active_order_query = order_query.filter(~Order.status.in_(inactive_statuses))
    active_order_query = apply_date_range(active_order_query, Order, start_date, end_date)
    purchase_orders = active_order_query.filter(Order.type == "purchase").count()
    sales_orders = active_order_query.filter(Order.type == "sale").count()

    inventory_value = _decimal(
        product_query.with_entities(func.coalesce(func.sum(Product.stock_cached * Product.buy_price), 0)).scalar()
    )
    low_stock_count = (
        product_query.filter(Product.stock_cached <= Product.reorder_level).with_entities(func.count(Product.id)).scalar()
        or 0
    )

    line_quantity = func.coalesce(OrderItem.quantity, 0)
    line_rate = func.coalesce(OrderItem.rate, 0)
    line_gst_rate = func.coalesce(OrderItem.gst_rate, 0)
    product_buy_price = func.coalesce(Product.buy_price, 0)
    line_total = line_quantity * line_rate * (1 + (line_gst_rate / 100))
    line_profit = line_quantity * (line_rate - product_buy_price)

    order_line_query = (
        db.query(
            func.coalesce(func.sum(line_total), 0),
            func.coalesce(func.sum(line_profit), 0),
        )
        .join(Order, Order.id == OrderItem.order_id)
        .join(Product, Product.id == OrderItem.product_id)
        .filter(Order.type == "sale", ~Order.status.in_(inactive_statuses))
    )
    order_line_query = order_line_query.filter(Order.business_profile_id == business_profile_id)
    if outlet_id is not None:
        order_line_query = order_line_query.filter(Order.outlet_id == outlet_id)
    order_line_query = apply_date_range(order_line_query, Order, start_date, end_date)
    total_revenue_raw, total_profit_raw = order_line_query.one()
    total_revenue = _decimal(total_revenue_raw)
    total_profit = _decimal(total_profit_raw)

    dated_invoice_query = apply_date_range(invoice_query, Invoice, start_date, end_date)
    invoice_amount = Invoice.taxable_value + Invoice.cgst + Invoice.sgst + Invoice.igst
    invoice_balance = case(
        (Invoice.payment_status == "Paid", 0),
        (Invoice.remaining_amount > 0, Invoice.remaining_amount),
        else_=invoice_amount,
    )
    active_invoice_query = dated_invoice_query.outerjoin(Order, Order.id == Invoice.order_id).filter(
        ~Invoice.status.in_(inactive_statuses),
        (Order.id.is_(None)) | (~Order.status.in_(inactive_statuses)),
    )
    sale_invoice_query = active_invoice_query.filter(Invoice.invoice_type == "Sale", Invoice.is_reverse.is_(False))
    sale_invoice_total = _decimal(
        sale_invoice_query.with_entities(func.coalesce(func.sum(invoice_amount), 0)).scalar()
    )
    if sale_invoice_total > 0:
        total_revenue = sale_invoice_total
        invoice_line_query = (
            db.query(
                func.coalesce(func.sum(line_total), 0),
                func.coalesce(func.sum(line_profit), 0),
            )
            .join(Order, Order.id == OrderItem.order_id)
            .join(Product, Product.id == OrderItem.product_id)
            .join(Invoice, Invoice.order_id == Order.id)
            .filter(
                Order.business_profile_id == business_profile_id,
                Order.type == "sale",
                ~Order.status.in_(inactive_statuses),
                Invoice.business_profile_id == business_profile_id,
                Invoice.invoice_type == "Sale",
                Invoice.is_reverse.is_(False),
                ~Invoice.status.in_(inactive_statuses),
            )
        )
        if outlet_id is not None:
            invoice_line_query = invoice_line_query.filter(Order.outlet_id == outlet_id, Invoice.outlet_id == outlet_id)
        invoice_line_query = apply_date_range(invoice_line_query, Invoice, start_date, end_date)
        invoice_line_revenue_raw, invoice_line_profit_raw = invoice_line_query.one()
        if _decimal(invoice_line_revenue_raw) > 0:
            total_profit = _decimal(invoice_line_profit_raw)
    receivables_total = _decimal(
        active_invoice_query.filter(Invoice.invoice_type == "Sale")
        .with_entities(func.coalesce(func.sum(invoice_balance), 0))
        .scalar()
    )
    payables_total = _decimal(
        active_invoice_query.filter(Invoice.invoice_type == "Purchase")
        .with_entities(func.coalesce(func.sum(invoice_balance), 0))
        .scalar()
    )

    source_invoice = aliased(Invoice)
    reverse_amount = Invoice.taxable_value + Invoice.cgst + Invoice.sgst + Invoice.igst
    reverse_base = dated_invoice_query.join(source_invoice, source_invoice.id == Invoice.linked_invoice_id).filter(
        Invoice.is_reverse.is_(True),
        Invoice.status.in_(("Approved", "Refunded")),
    )
    sale_refund_total = _decimal(
        reverse_base.filter(source_invoice.invoice_type == "Sale")
        .with_entities(func.coalesce(func.sum(reverse_amount), 0))
        .scalar()
    )
    purchase_refund_total = _decimal(
        reverse_base.filter(source_invoice.invoice_type == "Purchase")
        .with_entities(func.coalesce(func.sum(reverse_amount), 0))
        .scalar()
    )
    reverse_invoices = dated_invoice_query.filter(Invoice.is_reverse.is_(True)).count()
    admin_to_outlet_invoices = dated_invoice_query.filter(Invoice.invoice_direction == "admin_to_outlet").count()
    customer_invoices = dated_invoice_query.filter(Invoice.invoice_direction == "outlet_to_customer").count()
    financials = FinancialLedgerSummary(
        gross_revenue=total_revenue,
        refunds=sale_refund_total,
        cogs=max(Decimal("0"), total_revenue - total_profit),
        inventory_value=inventory_value,
    )
    dashboard = DashboardAggregationService().summarize(
        financials,
        returns_count=reverse_invoices,
        low_stock_count=low_stock_count,
    )

    return DashboardSummary(
        total_revenue=dashboard.net_revenue,
        total_profit=financials.profit,
        inventory_value=dashboard.inventory_value,
        low_stock_count=low_stock_count,
        purchase_orders=purchase_orders,
        sales_orders=sales_orders,
        receivables=max(
            Decimal("0"),
            receivables_total - sale_refund_total,
        ),
        payables=max(
            Decimal("0"),
            payables_total - purchase_refund_total,
        ),
        reverse_invoices=reverse_invoices,
        admin_to_outlet_invoices=admin_to_outlet_invoices,
        customer_invoices=customer_invoices,
    )
