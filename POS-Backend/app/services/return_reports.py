"""Return analytics service.

The service owns report calculations while routes remain thin. It uses the
existing transactional models so reporting stays backward compatible.
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterable, Literal

from sqlalchemy import Select, asc, desc, distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.api.deps import CurrentUser
from app.core.roles import Role
from app.models.catalog import Product, Supplier
from app.models.org import Outlet, Staff
from app.models.sales import Customer, Invoice, Return, ReturnItem
from app.schemas.reports import (
    ReturnBreakdownItem,
    ReturnBreakdowns,
    ReturnEntityAnalytics,
    ReturnInsight,
    ReturnInventoryAnalytics,
    ReturnReportItemDetail,
    ReturnReportRow,
    ReturnReportSummary,
    ReturnReportTable,
    ReturnTrendPoint,
)
from shared_domain.inventory import InventoryDisposition, return_disposition


SELLABLE_DISPOSITIONS = {InventoryDisposition.AVAILABLE}
DAMAGED_DISPOSITIONS = {
    InventoryDisposition.DAMAGED,
    InventoryDisposition.EXPIRED,
    InventoryDisposition.QUARANTINE,
    InventoryDisposition.LOST,
}


@dataclass(slots=True)
class ReturnReportFilters:
    start_date: date | None = None
    end_date: date | None = None
    status: str | None = None
    employee_id: int | None = None
    outlet_id: int | None = None
    customer_id: int | None = None
    category: str | None = None
    supplier_id: int | None = None
    reason: str | None = None
    damage_only: bool = False
    refund_only: bool = False
    pending_only: bool = False
    search: str | None = None
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None


@dataclass(slots=True)
class ReturnReportRecord:
    return_id: int
    return_number: str
    original_invoice_id: int
    reversal_invoice_id: int | None
    original_invoice_no: str | None
    reversal_invoice_no: str | None
    return_date: date
    customer_id: int | None
    customer_name: str | None
    customer_phone: str | None
    staff_id: int | None
    employee: str | None
    employee_code: str | None
    outlet_id: int | None
    outlet: str | None
    reason: str | None
    resolution: str
    refund_method: str | None
    refund_amount: Decimal
    refund_status: str
    status: str
    return_remarks: str | None
    created_at: datetime
    updated_at: datetime | None
    item_id: int | None
    product_id: int | None
    product_name: str | None
    sku: str | None
    barcode: str | None
    category: str | None
    supplier_id: int | None
    supplier: str | None
    quantity: Decimal
    rate: Decimal
    discount: Decimal
    gst_rate: Decimal
    line_refund: Decimal
    damage_type: str | None
    item_remarks: str | None
    buy_price: Decimal
    sell_price: Decimal
    stock_cached: Decimal


def _money(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.01"))


def _qty(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(Decimal("0.001"))


def _percent(part: Decimal, whole: Decimal) -> Decimal:
    if not whole:
        return Decimal("0.00")
    return ((part / whole) * Decimal("100")).quantize(Decimal("0.01"))


def _reason_for(record: ReturnReportRecord) -> str:
    return (record.damage_type or record.reason or "damaged").strip()


def _disposition(record: ReturnReportRecord) -> InventoryDisposition:
    return return_disposition(_reason_for(record))


def _period_key(value: date, grain: Literal["daily", "weekly", "monthly", "quarterly", "yearly"]) -> str:
    if grain == "weekly":
        year, week, _ = value.isocalendar()
        return f"{year}-W{week:02d}"
    if grain == "monthly":
        return value.strftime("%Y-%m")
    if grain == "quarterly":
        quarter = ((value.month - 1) // 3) + 1
        return f"{value.year}-Q{quarter}"
    if grain == "yearly":
        return str(value.year)
    return value.isoformat()


class ReturnReportService:
    def __init__(self, db: AsyncSession, user: CurrentUser):
        self.db = db
        self.user = user

    async def summary(self, filters: ReturnReportFilters) -> ReturnReportSummary:
        records = await self._records(filters)
        grouped = self._group_returns(records)
        return_count = len(grouped)
        returned_qty = sum((row["returned_qty"] for row in grouped.values()), Decimal("0"))
        damaged_qty = sum((row["damaged_qty"] for row in grouped.values()), Decimal("0"))
        restocked_qty = sum((row["restocked_qty"] for row in grouped.values()), Decimal("0"))
        refund_amount = _money(sum((row["total_refund"] for row in grouped.values()), Decimal("0")))
        damage_cost = _money(sum((row["loss_value"] for row in grouped.values()), Decimal("0")))
        recovery_value = _money(sum((row["recovery_value"] for row in grouped.values()), Decimal("0")))
        invoice_count = await self._invoice_count(filters)
        completed = [row for row in grouped.values() if row["status"] == "completed"]
        processing_hours = [
            Decimal(str((row["updated_at"] - row["created_at"]).total_seconds() / 3600))
            for row in completed
            if row["updated_at"] and row["created_at"]
        ]
        avg_processing = (
            sum(processing_hours, Decimal("0")) / Decimal(len(processing_hours))
            if processing_hours
            else Decimal("0")
        ).quantize(Decimal("0.01"))
        return ReturnReportSummary(
            total_return_invoices=return_count,
            total_returned_items=_qty(returned_qty),
            total_damaged_items=_qty(damaged_qty),
            total_restocked_items=_qty(restocked_qty),
            pending_approval=sum(1 for row in grouped.values() if row["status"] in {"submitted", "verified"}),
            pending_inspection=sum(1 for row in grouped.values() if row["status"] == "approved"),
            pending_refund=sum(1 for row in grouped.values() if row["refund_status"] != "completed"),
            pending_inventory_update=sum(1 for row in grouped.values() if row["status"] not in {"completed", "rejected"}),
            refund_amount=refund_amount,
            damage_cost=damage_cost,
            recovery_value=recovery_value,
            net_loss=_money(damage_cost - recovery_value),
            gross_loss=damage_cost,
            inventory_adjustment_value=_money(recovery_value - damage_cost),
            return_rate=_percent(Decimal(return_count), Decimal(invoice_count)),
            damage_rate=_percent(damaged_qty, returned_qty),
            recovery_rate=_percent(recovery_value, refund_amount),
            average_return_value=_money(refund_amount / Decimal(return_count)) if return_count else Decimal("0"),
            average_refund=_money(refund_amount / Decimal(return_count)) if return_count else Decimal("0"),
            average_processing_time_hours=avg_processing,
            largest_return=max((row["total_refund"] for row in grouped.values()), default=Decimal("0")),
            largest_loss=max((row["loss_value"] for row in grouped.values()), default=Decimal("0")),
            highest_refund=max((row["total_refund"] for row in grouped.values()), default=Decimal("0")),
        )

    async def trends(
        self,
        filters: ReturnReportFilters,
        grain: Literal["daily", "weekly", "monthly", "quarterly", "yearly"] = "daily",
    ) -> list[ReturnTrendPoint]:
        grouped = self._group_returns(await self._records(filters))
        buckets: dict[str, dict[str, Decimal | int]] = {}
        for row in grouped.values():
            key = _period_key(row["date"], grain)
            bucket = buckets.setdefault(
                key,
                {
                    "returns": 0,
                    "returned_qty": Decimal("0"),
                    "damaged_qty": Decimal("0"),
                    "restocked_qty": Decimal("0"),
                    "refund_amount": Decimal("0"),
                    "loss_value": Decimal("0"),
                    "recovery_value": Decimal("0"),
                },
            )
            bucket["returns"] = int(bucket["returns"]) + 1
            for metric in (
                "returned_qty",
                "damaged_qty",
                "restocked_qty",
                "refund_amount",
                "loss_value",
                "recovery_value",
            ):
                bucket[metric] = Decimal(str(bucket[metric])) + row[metric if metric != "refund_amount" else "total_refund"]
        return [
            ReturnTrendPoint(period=key, **values)
            for key, values in sorted(buckets.items())
        ]

    async def breakdowns(self, filters: ReturnReportFilters, top: int = 10) -> ReturnBreakdowns:
        records = await self._records(filters)
        return ReturnBreakdowns(
            reasons=self._breakdown(records, lambda r: _reason_for(r), lambda r: _reason_for(r), top),
            statuses=self._breakdown(records, lambda r: r.status, lambda r: r.status.replace("_", " ").title(), top),
            products=self._breakdown(records, lambda r: str(r.product_id or ""), lambda r: r.product_name or f"Product #{r.product_id}", top),
            damaged_products=self._breakdown(
                [r for r in records if _disposition(r) in DAMAGED_DISPOSITIONS],
                lambda r: str(r.product_id or ""),
                lambda r: r.product_name or f"Product #{r.product_id}",
                top,
            ),
            categories=self._breakdown(records, lambda r: r.category or "Uncategorized", lambda r: r.category or "Uncategorized", top),
            suppliers=self._breakdown(records, lambda r: str(r.supplier_id or r.supplier or "Unknown"), lambda r: r.supplier or "Unknown", top),
            employees=self._breakdown(records, lambda r: str(r.staff_id or ""), lambda r: r.employee or "Unassigned", top),
            customers=self._breakdown(records, lambda r: str(r.customer_id or r.customer_name or "Walk-in"), lambda r: r.customer_name or "Walk-in Customer", top),
            outlets=self._breakdown(records, lambda r: str(r.outlet_id or ""), lambda r: r.outlet or "Unknown Outlet", top),
        )

    async def table(
        self,
        filters: ReturnReportFilters,
        *,
        page: int,
        page_size: int,
        sort: str,
        direction: str,
    ) -> ReturnReportTable:
        total = await self._return_count(filters)
        records = await self._records(
            filters,
            page=page,
            page_size=page_size,
            sort=sort,
            direction=direction,
        )
        rows = self._rows_from_records(records)
        return ReturnReportTable(
            rows=rows,
            total=total,
            page=page,
            page_size=page_size,
            sort=sort,
            direction=direction,
        )

    async def insights(self, filters: ReturnReportFilters) -> list[ReturnInsight]:
        summary = await self.summary(filters)
        breakdowns = await self.breakdowns(filters, top=3)
        insights: list[ReturnInsight] = []
        if summary.damage_rate >= Decimal("30"):
            insights.append(
                ReturnInsight(
                    severity="warning",
                    title="High damage rate",
                    message=f"{summary.damage_rate}% of returned units are damaged or quarantined.",
                    metric="damage_rate",
                    value=summary.damage_rate,
                )
            )
        if breakdowns.suppliers:
            top_supplier = breakdowns.suppliers[0]
            insights.append(
                ReturnInsight(
                    severity="info",
                    title="Supplier concentration",
                    message=f"{top_supplier.label} contributes the highest return value in this period.",
                    metric="supplier_return_value",
                    value=top_supplier.refund_amount,
                )
            )
        if breakdowns.products:
            top_product = breakdowns.products[0]
            insights.append(
                ReturnInsight(
                    severity="info",
                    title="Most returned product",
                    message=f"{top_product.label} is the most frequently returned product.",
                    metric="product_return_qty",
                    value=top_product.quantity,
                )
            )
        if summary.net_loss > Decimal("0"):
            insights.append(
                ReturnInsight(
                    severity="danger",
                    title="Net return loss",
                    message=f"Estimated net loss is {summary.net_loss}. Review damaged returns and supplier recovery.",
                    metric="net_loss",
                    value=summary.net_loss,
                )
            )
        if not insights:
            insights.append(
                ReturnInsight(
                    severity="ok",
                    title="Returns are controlled",
                    message="No abnormal return pattern was detected for the selected filters.",
                )
            )
        return insights

    async def entity_analytics(self, filters: ReturnReportFilters, entity: str, top: int = 20) -> ReturnEntityAnalytics:
        breakdowns = await self.breakdowns(filters, top=top)
        mapping = {
            "product": breakdowns.products,
            "supplier": breakdowns.suppliers,
            "customer": breakdowns.customers,
            "employee": breakdowns.employees,
        }
        return ReturnEntityAnalytics(rows=mapping.get(entity, []))

    async def inventory(self, filters: ReturnReportFilters) -> ReturnInventoryAnalytics:
        records = await self._records(filters)
        restocked = damaged = frozen = Decimal("0")
        adjustment = Decimal("0")
        for record in records:
            disposition = _disposition(record)
            qty = record.quantity
            if disposition == InventoryDisposition.AVAILABLE:
                restocked += qty
                adjustment += record.buy_price * qty
            elif disposition in DAMAGED_DISPOSITIONS:
                damaged += qty
                frozen += qty
                adjustment -= record.buy_price * qty
        grouped = self._group_returns(records)
        return ReturnInventoryAnalytics(
            restocked=_qty(restocked),
            damaged=_qty(damaged),
            inspection_pending=sum(1 for row in grouped.values() if row["status"] == "approved"),
            replacement_pending=sum(1 for row in grouped.values() if row["resolution"] == "replacement"),
            inventory_frozen=_qty(frozen),
            inventory_released=_qty(restocked),
            inventory_adjustment_value=_money(adjustment),
        )

    async def export_csv(self, filters: ReturnReportFilters) -> str:
        records = await self._records(filters)
        rows = self._rows_from_records(records)
        stream = io.StringIO()
        writer = csv.writer(stream)
        writer.writerow(
            [
                "Return Invoice No",
                "Original Invoice No",
                "Date",
                "Customer",
                "Employee",
                "Outlet",
                "Return Type",
                "Product Count",
                "Returned Qty",
                "Damaged Qty",
                "Restocked Qty",
                "Total Refund",
                "Loss Value",
                "Status",
            ]
        )
        for row in rows:
            writer.writerow(
                [
                    row.return_invoice_no,
                    row.original_invoice_no,
                    row.date.isoformat(),
                    row.customer,
                    row.employee,
                    row.outlet,
                    row.return_type,
                    row.product_count,
                    row.returned_qty,
                    row.damaged_qty,
                    row.restocked_qty,
                    row.total_refund,
                    row.loss_value,
                    row.status,
                ]
            )
        return stream.getvalue()

    async def _invoice_count(self, filters: ReturnReportFilters) -> int:
        stmt = select(func.count(Invoice.id)).where(
            Invoice.business_profile_id == self.user.business_profile_id,
            Invoice.is_reverse.is_(False),
        )
        if filters.start_date:
            stmt = stmt.where(Invoice.date >= filters.start_date)
        if filters.end_date:
            stmt = stmt.where(Invoice.date <= filters.end_date)
        stmt = self._apply_invoice_role_scope(stmt)
        return int((await self.db.execute(stmt)).scalar_one() or 0)

    async def _return_count(self, filters: ReturnReportFilters) -> int:
        stmt = select(func.count(distinct(Return.id))).select_from(Return)
        stmt = self._apply_return_filters(stmt, filters, joined=False)
        return int((await self.db.execute(stmt)).scalar_one() or 0)

    async def _records(
        self,
        filters: ReturnReportFilters,
        *,
        page: int | None = None,
        page_size: int | None = None,
        sort: str = "date",
        direction: str = "desc",
    ) -> list[ReturnReportRecord]:
        original = Invoice
        reversal = aliased(Invoice)
        page_ids = None
        if page is not None and page_size is not None:
            id_stmt = select(Return.id).select_from(Return)
            id_stmt = self._apply_return_filters(id_stmt, filters, joined=False)
            id_stmt = id_stmt.group_by(Return.id)
            id_stmt = id_stmt.order_by(self._sort_column(sort, direction))
            id_stmt = id_stmt.offset((page - 1) * page_size).limit(page_size)
            page_ids = list((await self.db.execute(id_stmt)).scalars().all())
            if not page_ids:
                return []

        stmt = (
            select(
                Return.id,
                Return.return_number,
                Return.original_invoice_id,
                Return.reversal_invoice_id,
                original.invoice_number.label("original_invoice_no"),
                reversal.invoice_number.label("reversal_invoice_no"),
                Return.return_date,
                Return.customer_id,
                Customer.name.label("customer_name"),
                Customer.phone.label("customer_phone"),
                Return.staff_id,
                Staff.full_name.label("employee"),
                Staff.employee_code,
                Return.outlet_id,
                Outlet.name.label("outlet"),
                Return.reason,
                Return.resolution,
                Return.refund_method,
                Return.refund_amount,
                Return.refund_status,
                Return.status,
                Return.remarks.label("return_remarks"),
                Return.created_at,
                Return.updated_at,
                ReturnItem.id.label("item_id"),
                ReturnItem.product_id,
                Product.name.label("product_name"),
                Product.sku,
                Product.barcode,
                Product.category,
                Product.supplier_id,
                Supplier.name.label("supplier"),
                ReturnItem.quantity,
                ReturnItem.rate,
                ReturnItem.discount,
                ReturnItem.gst_rate,
                ReturnItem.line_refund,
                ReturnItem.damage_type,
                ReturnItem.remarks.label("item_remarks"),
                Product.buy_price,
                Product.sell_price,
                Product.stock_cached,
            )
            .select_from(Return)
            .outerjoin(ReturnItem, ReturnItem.return_id == Return.id)
            .outerjoin(Product, Product.id == ReturnItem.product_id)
            .outerjoin(Supplier, Supplier.id == Product.supplier_id)
            .outerjoin(original, original.id == Return.original_invoice_id)
            .outerjoin(reversal, reversal.id == Return.reversal_invoice_id)
            .outerjoin(Customer, Customer.id == Return.customer_id)
            .outerjoin(Staff, Staff.id == Return.staff_id)
            .outerjoin(Outlet, Outlet.id == Return.outlet_id)
        )
        stmt = self._apply_return_filters(stmt, filters, joined=True)
        if page_ids is not None:
            stmt = stmt.where(Return.id.in_(page_ids))
        stmt = stmt.order_by(self._sort_column(sort, direction), ReturnItem.id.asc())
        rows = (await self.db.execute(stmt)).all()
        return [self._record_from_row(row) for row in rows]

    def _apply_return_filters(
        self,
        stmt: Select,
        filters: ReturnReportFilters,
        *,
        joined: bool,
    ) -> Select:
        original = Invoice
        stmt = stmt.where(Return.business_profile_id == self.user.business_profile_id)
        stmt = self._apply_return_role_scope(stmt)
        if filters.start_date:
            stmt = stmt.where(Return.return_date >= filters.start_date)
        if filters.end_date:
            stmt = stmt.where(Return.return_date <= filters.end_date)
        if filters.status:
            stmt = stmt.where(Return.status == filters.status)
        if filters.employee_id:
            stmt = stmt.where(Return.staff_id == filters.employee_id)
        if filters.outlet_id:
            stmt = stmt.where(Return.outlet_id == filters.outlet_id)
        if filters.customer_id:
            stmt = stmt.where(Return.customer_id == filters.customer_id)
        needs_item_join = bool(
            filters.reason
            or filters.category
            or filters.supplier_id
            or filters.damage_only
            or filters.search
        )
        if needs_item_join and not joined:
            stmt = stmt.outerjoin(ReturnItem, ReturnItem.return_id == Return.id).outerjoin(
                Product,
                Product.id == ReturnItem.product_id,
            )
        if filters.reason:
            stmt = stmt.where(or_(Return.reason.ilike(f"%{filters.reason}%"), ReturnItem.damage_type.ilike(f"%{filters.reason}%")))
        if filters.min_amount is not None:
            stmt = stmt.where(Return.refund_amount >= filters.min_amount)
        if filters.max_amount is not None:
            stmt = stmt.where(Return.refund_amount <= filters.max_amount)
        if filters.pending_only:
            stmt = stmt.where(Return.status.in_(["submitted", "verified", "approved"]))
        if filters.refund_only:
            stmt = stmt.where(Return.resolution == "refund")
        if filters.category:
            stmt = stmt.where(Product.category == filters.category)
        if filters.supplier_id:
            stmt = stmt.where(Product.supplier_id == filters.supplier_id)
        if filters.damage_only:
            stmt = stmt.where(
                or_(
                    ReturnItem.damage_type.in_(["damaged", "expired", "manufacturing_defect", "quality_issue"]),
                    Return.reason.ilike("%damaged%"),
                    Return.reason.ilike("%expired%"),
                    Return.reason.ilike("%quality%"),
                    Return.reason.ilike("%defect%"),
                )
            )
        if filters.search:
            like = f"%{filters.search.strip()}%"
            if not joined:
                stmt = stmt.outerjoin(original, original.id == Return.original_invoice_id)
                stmt = stmt.outerjoin(Customer, Customer.id == Return.customer_id)
                stmt = stmt.outerjoin(Staff, Staff.id == Return.staff_id)
                stmt = stmt.outerjoin(Supplier, Supplier.id == Product.supplier_id)
            stmt = stmt.where(
                or_(
                    Return.return_number.ilike(like),
                    original.invoice_number.ilike(like),
                    Product.name.ilike(like),
                    Product.sku.ilike(like),
                    Product.barcode.ilike(like),
                    Product.category.ilike(like),
                    Supplier.name.ilike(like),
                    Customer.name.ilike(like),
                    Customer.phone.ilike(like),
                    Staff.full_name.ilike(like),
                    Staff.employee_code.ilike(like),
                    Return.remarks.ilike(like),
                    Return.reason.ilike(like),
                )
            )
        return stmt

    def _apply_return_role_scope(self, stmt: Select) -> Select:
        if self.user.role == Role.SALES_MANAGER:
            sp_ids = select(Staff.id).where(
                Staff.business_profile_id == self.user.business_profile_id,
                Staff.manager_id == self.user.id,
            )
            return stmt.where(Return.staff_id.in_(sp_ids))
        if self.user.role == Role.SALES_PERSON:
            return stmt.where(Return.staff_id == self.user.id)
        return stmt

    def _apply_invoice_role_scope(self, stmt: Select) -> Select:
        if self.user.role == Role.SALES_MANAGER:
            sp_ids = select(Staff.id).where(
                Staff.business_profile_id == self.user.business_profile_id,
                Staff.manager_id == self.user.id,
            )
            return stmt.where(Invoice.staff_id.in_(sp_ids))
        if self.user.role == Role.SALES_PERSON:
            return stmt.where(Invoice.staff_id == self.user.id)
        return stmt

    def _sort_column(self, sort: str, direction: str):
        columns = {
            "date": Return.return_date,
            "return_invoice_no": Return.return_number,
            "refund": Return.refund_amount,
            "status": Return.status,
            "created_at": Return.created_at,
        }
        column = columns.get(sort, Return.return_date)
        return asc(column) if direction == "asc" else desc(column)

    def _record_from_row(self, row) -> ReturnReportRecord:
        data = row._mapping
        return ReturnReportRecord(
            return_id=data["id"],
            return_number=data["return_number"],
            original_invoice_id=data["original_invoice_id"],
            reversal_invoice_id=data["reversal_invoice_id"],
            original_invoice_no=data["original_invoice_no"],
            reversal_invoice_no=data["reversal_invoice_no"],
            return_date=data["return_date"],
            customer_id=data["customer_id"],
            customer_name=data["customer_name"],
            customer_phone=data["customer_phone"],
            staff_id=data["staff_id"],
            employee=data["employee"],
            employee_code=data["employee_code"],
            outlet_id=data["outlet_id"],
            outlet=data["outlet"],
            reason=data["reason"],
            resolution=data["resolution"],
            refund_method=data["refund_method"],
            refund_amount=_money(data["refund_amount"]),
            refund_status=data["refund_status"],
            status=data["status"],
            return_remarks=data["return_remarks"],
            created_at=data["created_at"],
            updated_at=data["updated_at"],
            item_id=data["item_id"],
            product_id=data["product_id"],
            product_name=data["product_name"],
            sku=data["sku"],
            barcode=data["barcode"],
            category=data["category"],
            supplier_id=data["supplier_id"],
            supplier=data["supplier"],
            quantity=_qty(data["quantity"]),
            rate=_money(data["rate"]),
            discount=_money(data["discount"]),
            gst_rate=Decimal(str(data["gst_rate"] or 0)),
            line_refund=_money(data["line_refund"]),
            damage_type=data["damage_type"],
            item_remarks=data["item_remarks"],
            buy_price=_money(data["buy_price"]),
            sell_price=_money(data["sell_price"]),
            stock_cached=_qty(data["stock_cached"]),
        )

    def _group_returns(self, records: Iterable[ReturnReportRecord]) -> dict[int, dict[str, Any]]:
        grouped: dict[int, dict[str, Any]] = {}
        for record in records:
            row = grouped.setdefault(
                record.return_id,
                {
                    "id": record.return_id,
                    "return_invoice_no": record.return_number,
                    "original_invoice_no": record.original_invoice_no,
                    "reversal_invoice_no": record.reversal_invoice_no,
                    "date": record.return_date,
                    "customer": record.customer_name or "Walk-in Customer",
                    "employee": record.employee,
                    "employee_code": record.employee_code,
                    "outlet": record.outlet,
                    "return_type": record.reason or record.resolution,
                    "product_count": 0,
                    "returned_qty": Decimal("0"),
                    "damaged_qty": Decimal("0"),
                    "restocked_qty": Decimal("0"),
                    "total_refund": record.refund_amount,
                    "loss_value": Decimal("0"),
                    "recovery_value": Decimal("0"),
                    "status": record.status,
                    "refund_status": record.refund_status,
                    "resolution": record.resolution,
                    "created_at": record.created_at,
                    "updated_at": record.updated_at,
                    "items": [],
                },
            )
            if record.item_id is None:
                continue
            disposition = _disposition(record)
            is_restocked = disposition in SELLABLE_DISPOSITIONS
            is_damaged = disposition in DAMAGED_DISPOSITIONS
            damage_qty = record.quantity if is_damaged else Decimal("0")
            restocked_qty = record.quantity if is_restocked else Decimal("0")
            damage_cost = _money(record.buy_price * damage_qty)
            recovery_value = _money(record.buy_price * restocked_qty)
            row["product_count"] += 1
            row["returned_qty"] += record.quantity
            row["damaged_qty"] += damage_qty
            row["restocked_qty"] += restocked_qty
            row["loss_value"] += damage_cost
            row["recovery_value"] += recovery_value
            row["items"].append(
                ReturnReportItemDetail(
                    id=record.item_id,
                    product_id=record.product_id or 0,
                    product_name=record.product_name or f"Product #{record.product_id}",
                    sku=record.sku,
                    barcode=record.barcode,
                    category=record.category,
                    supplier=record.supplier,
                    returned_qty=record.quantity,
                    damaged_qty=damage_qty,
                    restocked_qty=restocked_qty,
                    selling_price=record.sell_price or record.rate,
                    cost_price=record.buy_price,
                    refund_amount=record.line_refund,
                    damage_cost=damage_cost,
                    reason=_reason_for(record),
                    remarks=record.item_remarks or record.return_remarks,
                    stock_status=disposition.value,
                )
            )
        return grouped

    def _rows_from_records(self, records: Iterable[ReturnReportRecord]) -> list[ReturnReportRow]:
        grouped = self._group_returns(records)
        return [
            ReturnReportRow(
                id=row["id"],
                return_invoice_no=row["return_invoice_no"],
                original_invoice_no=row["original_invoice_no"],
                reversal_invoice_no=row["reversal_invoice_no"],
                date=row["date"],
                customer=row["customer"],
                employee=row["employee"],
                employee_code=row["employee_code"],
                outlet=row["outlet"],
                return_type=row["return_type"],
                product_count=row["product_count"],
                returned_qty=_qty(row["returned_qty"]),
                damaged_qty=_qty(row["damaged_qty"]),
                restocked_qty=_qty(row["restocked_qty"]),
                total_refund=_money(row["total_refund"]),
                loss_value=_money(row["loss_value"]),
                recovery_value=_money(row["recovery_value"]),
                status=row["status"],
                refund_status=row["refund_status"],
                created_at=row["created_at"],
                items=row["items"],
            )
            for row in grouped.values()
        ]

    def _breakdown(self, records: Iterable[ReturnReportRecord], key_fn, label_fn, top: int) -> list[ReturnBreakdownItem]:
        buckets: dict[str, dict[str, Any]] = {}
        seen_returns: dict[str, set[int]] = {}
        for record in records:
            if record.item_id is None:
                continue
            key = str(key_fn(record) or "unknown")
            bucket = buckets.setdefault(
                key,
                {
                    "label": str(label_fn(record) or "Unknown"),
                    "quantity": Decimal("0"),
                    "refund_amount": Decimal("0"),
                    "loss_value": Decimal("0"),
                    "recovery_value": Decimal("0"),
                },
            )
            seen_returns.setdefault(key, set()).add(record.return_id)
            disposition = _disposition(record)
            bucket["quantity"] += record.quantity
            bucket["refund_amount"] += record.line_refund
            if disposition in DAMAGED_DISPOSITIONS:
                bucket["loss_value"] += record.buy_price * record.quantity
            if disposition in SELLABLE_DISPOSITIONS:
                bucket["recovery_value"] += record.buy_price * record.quantity
        rows = [
            ReturnBreakdownItem(
                key=key,
                label=value["label"],
                count=len(seen_returns.get(key, set())),
                quantity=_qty(value["quantity"]),
                refund_amount=_money(value["refund_amount"]),
                loss_value=_money(value["loss_value"]),
                recovery_value=_money(value["recovery_value"]),
            )
            for key, value in buckets.items()
        ]
        return sorted(rows, key=lambda item: (item.refund_amount, item.quantity), reverse=True)[:top]
