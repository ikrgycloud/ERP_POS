"""Database-backed inventory valuation reporting.

This module is the single source of truth for inventory value reporting.  It
uses the immutable quantity history for period movements and the reconciled
product stock cache for the current on-hand valuation.  Amounts are always
cost values, never sales values.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.models import Category, Product, ProductQuantity, Supplier


ZERO = Decimal("0")


def _decimal(value: object) -> Decimal:
    return Decimal(value or 0)


class InventoryValueService:
    """Produces the ERP inventory-value report from database aggregates."""

    def build_report(
        self,
        db: Session,
        *,
        business_profile_id: int,
        start_date: date,
        end_date: date,
        category_id: int | None = None,
        supplier_id: int | None = None,
        product_id: int | None = None,
        search: str | None = None,
        movement_type: str | None = None,
    ) -> dict:
        # Archived products remain in the database for auditability, but they
        # are no longer on hand and must not contribute to current valuation.
        product_filters = [Product.business_profile_id == business_profile_id, Product.is_active.is_(True)]
        if category_id is not None:
            product_filters.append(Product.category_id == category_id)
        if supplier_id is not None:
            product_filters.append(Product.supplier_id == supplier_id)
        if product_id is not None:
            product_filters.append(Product.id == product_id)
        if search:
            product_filters.append(Product.name.ilike(f"%{search.strip()}%"))

        movement_filters = [
            ProductQuantity.effective_date >= start_date,
            ProductQuantity.effective_date <= end_date,
            *product_filters,
        ]
        if movement_type:
            movement_filters.append(ProductQuantity.transaction_type == movement_type)

        value = ProductQuantity.quantity_change * Product.buy_price
        incoming = case((ProductQuantity.quantity_change > 0, value), else_=ZERO)
        outgoing = case((ProductQuantity.quantity_change < 0, -value), else_=ZERO)

        totals = (
            db.query(
                func.coalesce(func.sum(incoming), ZERO).label("incoming"),
                func.coalesce(func.sum(outgoing), ZERO).label("outgoing"),
                func.count(ProductQuantity.id).label("movement_count"),
            )
            .join(Product, Product.id == ProductQuantity.product_id)
            .filter(*movement_filters)
            .one()
        )
        incoming_value = _decimal(totals.incoming)
        outgoing_value = _decimal(totals.outgoing)
        net_change = incoming_value - outgoing_value

        current_value = _decimal(
            db.query(func.coalesce(func.sum(Product.stock_cached * Product.buy_price), ZERO))
            .filter(*product_filters)
            .scalar()
        )
        # Current value minus period movement is the opening value for the
        # selected range.  This remains correct even when the range begins
        # before the first retained daily ledger row.
        opening_value = max(ZERO, current_value - net_change)
        days = max(1, (end_date - start_date).days + 1)
        growth = ZERO if opening_value == ZERO else (current_value - opening_value) * Decimal("100") / opening_value

        breakdown_rows = (
            db.query(
                ProductQuantity.transaction_type,
                func.coalesce(func.sum(incoming), ZERO).label("incoming"),
                func.coalesce(func.sum(outgoing), ZERO).label("outgoing"),
            )
            .join(Product, Product.id == ProductQuantity.product_id)
            .filter(*movement_filters)
            .group_by(ProductQuantity.transaction_type)
            .all()
        )
        breakdown = {
            "purchase": ZERO, "sales": ZERO, "damage": ZERO, "expiry": ZERO,
            "supplierReturns": ZERO, "adjustments": ZERO, "transferIn": ZERO, "transferOut": ZERO,
        }
        for row in breakdown_rows:
            key = (row.transaction_type or "").lower()
            amount = _decimal(row.incoming) - _decimal(row.outgoing)
            if key in {"purchase_received", "opening_stock", "file_import", "file_import_stock", "file_import_new_product"}:
                breakdown["purchase"] += amount
            elif key in {"sale_delivered", "sale"}:
                breakdown["sales"] += amount
            elif "damage" in key:
                breakdown["damage"] += amount
            elif "expiry" in key:
                breakdown["expiry"] += amount
            elif "supplier_return" in key:
                breakdown["supplierReturns"] += amount
            elif "transfer" in key:
                breakdown["transferIn" if amount >= ZERO else "transferOut"] += amount
            else:
                breakdown["adjustments"] += amount

        daily_rows = (
            db.query(
                ProductQuantity.effective_date.label("date"),
                func.coalesce(func.sum(incoming), ZERO).label("incoming"),
                func.coalesce(func.sum(outgoing), ZERO).label("outgoing"),
                func.count(ProductQuantity.id).label("transactions"),
            )
            .join(Product, Product.id == ProductQuantity.product_id)
            .filter(*movement_filters)
            .group_by(ProductQuantity.effective_date)
            .order_by(ProductQuantity.effective_date)
            .all()
        )
        daily = []
        running = opening_value
        for row in daily_rows:
            row_incoming, row_outgoing = _decimal(row.incoming), _decimal(row.outgoing)
            closing = max(ZERO, running + row_incoming - row_outgoing)
            daily.append({
                "date": row.date,
                "opening": running,
                "incoming": row_incoming,
                "outgoing": row_outgoing,
                "closing": closing,
                "netChange": row_incoming - row_outgoing,
                "transactions": int(row.transactions or 0),
            })
            running = closing

        def current_distribution(group_column, label_column):
            rows = (
                db.query(
                    func.coalesce(label_column, "Unassigned").label("name"),
                    func.coalesce(func.sum(Product.stock_cached * Product.buy_price), ZERO).label("value"),
                )
                .outerjoin(group_column)
                .filter(*product_filters)
                .group_by(label_column)
                .order_by(func.sum(Product.stock_cached * Product.buy_price).desc())
                .limit(10)
                .all()
            )
            return [
                {"name": row.name, "value": _decimal(row.value), "percentage": ZERO if current_value == ZERO else _decimal(row.value) * 100 / current_value}
                for row in rows
            ]

        categories = current_distribution(Category, Category.name)
        suppliers = current_distribution(Supplier, Supplier.name)
        products = (
            db.query(Product.name, (Product.stock_cached * Product.buy_price).label("value"))
            .filter(*product_filters)
            .order_by((Product.stock_cached * Product.buy_price).desc())
            .limit(10)
            .all()
        )
        top_products = [
            {"name": row.name, "value": _decimal(row.value), "percentage": ZERO if current_value == ZERO else _decimal(row.value) * 100 / current_value}
            for row in products
        ]
        health = 100
        if outgoing_value > incoming_value:
            health -= 15
        if current_value == ZERO:
            health = 0
        alerts = []
        if growth <= Decimal("-20"):
            alerts.append({"severity": "warning", "title": "Inventory value dropped", "message": "Inventory value declined by more than 20% in the selected period."})
        if breakdown["damage"] < ZERO:
            alerts.append({"severity": "warning", "title": "Damage movement detected", "message": "Damage-related inventory value was recorded in this period."})

        return {
            "summary": {
                "openingValue": opening_value, "incomingValue": incoming_value, "outgoingValue": outgoing_value,
                "currentValue": current_value, "netChange": net_change, "growthPercentage": growth,
                "averageDailyChange": net_change / days, "movementCount": int(totals.movement_count or 0),
                "inventoryHealth": health,
            },
            "breakdown": breakdown,
            "charts": {
                "dailyTrend": daily, "monthlyTrend": [], "incomingVsOutgoing": {"incoming": incoming_value, "outgoing": outgoing_value},
                "categoryDistribution": categories, "warehouseDistribution": [], "supplierDistribution": suppliers,
            },
            "topProducts": top_products, "topCategories": categories, "topSuppliers": suppliers, "topWarehouses": [],
            "dailyLedger": daily, "alerts": alerts,
        }
