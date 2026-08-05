"""Dashboard and reporting endpoints (read-only aggregations)."""
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import case, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, require_roles
from app.core.roles import Role
from app.db.session import get_db
from app.models.catalog import Product
from app.models.org import Staff
from app.models.sales import Customer, Invoice, InvoiceItem, Order, Return
from app.repositories.repos import (
    InvoiceRepository,
    PaymentRepository,
    ProductRepository,
)
from app.schemas.transactions import (
    BranchManagerDashboard,
    ManagerRevenuePerformance,
    PaymentMethodSummary,
    RevenueReport,
    SalesManagerDashboard,
    SalesPersonDashboard,
    StaffReportDTO,
)
from app.schemas.reports import (
    BestSellingProductInsight,
    LowStockProductInsight,
    ProductInsightsReport,
    ReturnBreakdowns,
    ReturnEntityAnalytics,
    ReturnInsight,
    ReturnInventoryAnalytics,
    ReturnReportSummary,
    ReturnReportTable,
    ReturnTrendPoint,
)
from app.services.return_reports import ReturnReportFilters, ReturnReportService
from shared_domain.finance import FinancialLedgerService

router = APIRouter(tags=["dashboards-reports"])
MAX_REPORT_DAYS = 90
financial_rules = FinancialLedgerService()


async def _scalar(db, stmt) -> int:
    return int((await db.execute(stmt)).scalar_one() or 0)


async def _revenue(db, condition) -> Decimal:
    total = _invoice_total()
    stmt = select(
        func.coalesce(func.sum(case((Invoice.is_reverse.is_(False), total), else_=0)), 0),
        func.coalesce(func.sum(case((Invoice.is_reverse.is_(True), total), else_=0)), 0),
    ).where(condition)
    gross, refunds = (await db.execute(stmt)).one()
    return financial_rules.net_revenue(
        gross_revenue=Decimal(str(gross or 0)),
        refunds=Decimal(str(refunds or 0)),
    )


def _invoice_total():
    return Invoice.taxable_value + Invoice.cgst + Invoice.sgst + Invoice.igst


def _zero(value) -> Decimal:
    return Decimal(str(value or 0))


def _initials(name: str) -> str:
    parts = [part for part in name.strip().split() if part]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0][:2].upper()
    return f"{parts[0][0]}{parts[-1][0]}".upper()


def _resolve_report_range(start_date: date | None, end_date: date | None) -> tuple[date, date]:
    resolved_end = end_date or date.today()
    resolved_start = start_date or (resolved_end - timedelta(days=MAX_REPORT_DAYS))
    _validate_report_range(resolved_start, resolved_end)
    return resolved_start, resolved_end


def _product_stock_status(stock: Decimal) -> str:
    if stock <= 0:
        return "out_of_stock"
    if stock < 5:
        return "low"
    if stock > 100:
        return "high"
    return "in_stock"


async def _managed_sales_person_ids(db: AsyncSession, user: CurrentUser) -> list[int]:
    rows = await db.execute(
        select(Staff.id).where(
            Staff.business_profile_id == user.business_profile_id,
            Staff.manager_id == user.id,
            Staff.role == Role.SALES_PERSON.value,
        )
    )
    return list(rows.scalars().all())


def _validate_report_range(start_date: date, end_date: date) -> None:
    if end_date < start_date:
        raise HTTPException(status_code=400, detail="endDate must be after startDate")
    if (end_date - start_date).days > MAX_REPORT_DAYS:
        raise HTTPException(status_code=400, detail=f"Report range cannot exceed {MAX_REPORT_DAYS} days")


def _return_report_filters(
    start_date: date | None = Query(default=None, alias="startDate"),
    end_date: date | None = Query(default=None, alias="endDate"),
    status: str | None = None,
    employee_id: int | None = Query(default=None, alias="employeeId"),
    outlet_id: int | None = Query(default=None, alias="outletId"),
    customer_id: int | None = Query(default=None, alias="customerId"),
    category: str | None = None,
    supplier_id: int | None = Query(default=None, alias="supplierId"),
    reason: str | None = None,
    damage_only: bool = Query(default=False, alias="damageOnly"),
    refund_only: bool = Query(default=False, alias="refundOnly"),
    pending_only: bool = Query(default=False, alias="pendingOnly"),
    search: str | None = None,
    min_amount: Decimal | None = Query(default=None, alias="minAmount"),
    max_amount: Decimal | None = Query(default=None, alias="maxAmount"),
) -> ReturnReportFilters:
    start_date, end_date = _resolve_report_range(start_date, end_date)
    return ReturnReportFilters(
        start_date=start_date,
        end_date=end_date,
        status=status,
        employee_id=employee_id,
        outlet_id=outlet_id,
        customer_id=customer_id,
        category=category,
        supplier_id=supplier_id,
        reason=reason,
        damage_only=damage_only,
        refund_only=refund_only,
        pending_only=pending_only,
        search=search,
        min_amount=min_amount,
        max_amount=max_amount,
    )


def _staff_report_from_row(row) -> StaffReportDTO:
    total_revenue = _zero(row.total_revenue)
    total_invoices = int(row.total_invoices or 0)
    return StaffReportDTO(
        id=row.id,
        manager_id=row.manager_id,
        employee_name=row.full_name,
        employee_id=row.employee_code,
        employee_code=row.employee_code,
        full_name=row.full_name,
        phone_number=row.phone,
        phone=row.phone,
        role=row.role,
        status="active" if row.is_active else "inactive",
        active=bool(row.is_active),
        avatar_initials=_initials(row.full_name),
        total_bills=total_invoices,
        total_invoices=total_invoices,
        total_revenue=total_revenue,
    )


async def _staff_report_rows(
    db: AsyncSession,
    *,
    business_profile_id: int,
    role: str,
    start_date: date | None = None,
    end_date: date | None = None,
    manager_ids: list[int] | None = None,
    manager_id: int | None = None,
) -> list[StaffReportDTO]:
    total = _invoice_total()

    invoice_agg = (
        select(
            Invoice.staff_id.label("staff_id"),
            func.count(case((Invoice.is_reverse.is_(False), Invoice.id))).label("total_invoices"),
            func.coalesce(func.sum(case((Invoice.is_reverse.is_(False), total), else_=0)), 0).label("gross_revenue"),
            func.coalesce(func.sum(case((Invoice.is_reverse.is_(True), total), else_=0)), 0).label("refunds"),
        )
        .where(Invoice.business_profile_id == business_profile_id)
    )
    if start_date is not None:
        invoice_agg = invoice_agg.where(Invoice.date >= start_date)
    if end_date is not None:
        invoice_agg = invoice_agg.where(Invoice.date <= end_date)
    invoice_agg = invoice_agg.group_by(Invoice.staff_id).subquery()

    stmt = (
        select(
            Staff.id,
            Staff.employee_code,
            Staff.full_name,
            Staff.phone,
            Staff.role,
            Staff.is_active,
            Staff.manager_id,
            func.coalesce(invoice_agg.c.total_invoices, 0).label("total_invoices"),
            func.coalesce(invoice_agg.c.gross_revenue, 0).label("gross_revenue"),
            func.coalesce(invoice_agg.c.refunds, 0).label("refunds"),
        )
        .outerjoin(invoice_agg, invoice_agg.c.staff_id == Staff.id)
        .where(
            Staff.business_profile_id == business_profile_id,
            Staff.role == role,
        )
    )
    if manager_id is not None:
        stmt = stmt.where(Staff.manager_id == manager_id)
    if manager_ids is not None:
        stmt = stmt.where(Staff.manager_id.in_(manager_ids))

    stmt = stmt.order_by(desc("gross_revenue"), Staff.full_name)
    rows = (await db.execute(stmt)).all()
    enriched = []
    for row in rows:
        total_revenue = financial_rules.net_revenue(
            gross_revenue=_zero(row.gross_revenue),
            refunds=_zero(row.refunds),
        )
        enriched.append(SimpleNamespace(**row._mapping, total_revenue=total_revenue))
    return [_staff_report_from_row(row) for row in enriched]


# ------------------------------ Dashboards ------------------------------
@router.get("/dashboard/branch-manager", response_model=BranchManagerDashboard)
async def bm_dashboard(db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(require_roles(Role.BRANCH_MANAGER))):
    today = date.today()
    return BranchManagerDashboard(
        sales_managers=await _scalar(db, select(func.count(Staff.id)).where(Staff.business_profile_id == user.business_profile_id, Staff.role == "sales_manager")),
        sales_persons=await _scalar(db, select(func.count(Staff.id)).where(Staff.business_profile_id == user.business_profile_id, Staff.role == "sales_person")),
        products=await _scalar(db, select(func.count(Product.id)).where(Product.business_profile_id == user.business_profile_id)),
        customers=await _scalar(db, select(func.count(Customer.id)).join(Staff, Staff.outlet_id == Customer.outlet_id).where(Staff.id == user.id)),
        today_sales=Decimal(await _scalar(db, select(func.count(Invoice.id)).where(Invoice.business_profile_id == user.business_profile_id, Invoice.date == today, Invoice.is_reverse.is_(False)))),
        today_revenue=await _revenue(db, (Invoice.business_profile_id == user.business_profile_id) & (Invoice.date == today)),
        low_stock=await _scalar(
            db,
            select(func.count(Product.id)).where(
                Product.business_profile_id == user.business_profile_id,
                Product.stock_cached < 5,
            ),
        ),
        pending_orders=await _scalar(db, select(func.count(Order.id)).where(Order.business_profile_id == user.business_profile_id, Order.status == "Draft")),
    )


@router.get("/dashboard/sales-manager", response_model=SalesManagerDashboard)
async def sm_dashboard(db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(require_roles(Role.SALES_MANAGER))):
    today = date.today()
    month_start = today.replace(day=1)
    sp_ids_stmt = select(Staff.id).where(
        Staff.business_profile_id == user.business_profile_id,
        Staff.manager_id == user.id,
    )
    sp_ids = [r for r in (await db.execute(sp_ids_stmt)).scalars().all()]
    if not sp_ids:
        sp_ids = [-1]
    total_sp = await _scalar(
        db,
        select(func.count(Staff.id)).where(
            Staff.business_profile_id == user.business_profile_id,
            Staff.manager_id == user.id,
        ),
    )
    active_sp = await _scalar(
        db,
        select(func.count(Staff.id)).where(
            Staff.business_profile_id == user.business_profile_id,
            Staff.manager_id == user.id,
            Staff.is_active.is_(True),
        ),
    )
    return SalesManagerDashboard(
        total_sales_persons=total_sp,
        active_sales_persons=active_sp,
        today_invoices=await _scalar(db, select(func.count(Invoice.id)).where(Invoice.business_profile_id == user.business_profile_id, Invoice.staff_id.in_(sp_ids), Invoice.date == today, Invoice.is_reverse.is_(False))),
        today_revenue=await _revenue(db, (Invoice.business_profile_id == user.business_profile_id) & Invoice.staff_id.in_(sp_ids) & (Invoice.date == today)),
        monthly_invoices=await _scalar(db, select(func.count(Invoice.id)).where(Invoice.business_profile_id == user.business_profile_id, Invoice.staff_id.in_(sp_ids), Invoice.date >= month_start, Invoice.is_reverse.is_(False))),
        monthly_revenue=await _revenue(db, (Invoice.business_profile_id == user.business_profile_id) & Invoice.staff_id.in_(sp_ids) & (Invoice.date >= month_start)),
        returns=await _scalar(db, select(func.count(Return.id)).where(Return.business_profile_id == user.business_profile_id, Return.staff_id.in_(sp_ids))),
        top_performer=None,
    )


@router.get("/dashboard/sales-person", response_model=SalesPersonDashboard)
async def sp_dashboard(db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(require_roles(Role.SALES_PERSON))):
    today = date.today()
    month_start = today.replace(day=1)
    return SalesPersonDashboard(
        today_bills=await _scalar(db, select(func.count(Invoice.id)).where(Invoice.business_profile_id == user.business_profile_id, Invoice.staff_id == user.id, Invoice.date == today, Invoice.is_reverse.is_(False))),
        today_revenue=await _revenue(db, (Invoice.business_profile_id == user.business_profile_id) & (Invoice.staff_id == user.id) & (Invoice.date == today)),
        monthly_bills=await _scalar(db, select(func.count(Invoice.id)).where(Invoice.business_profile_id == user.business_profile_id, Invoice.staff_id == user.id, Invoice.date >= month_start, Invoice.is_reverse.is_(False))),
        monthly_revenue=await _revenue(db, (Invoice.business_profile_id == user.business_profile_id) & (Invoice.staff_id == user.id) & (Invoice.date >= month_start)),
        invoice_count=await InvoiceRepository(db).count_for_staff(user.id),
    )


# ------------------------------ Reports ------------------------------
@router.get("/reports/revenue", response_model=RevenueReport)
async def revenue_report(
    start_date: date | None = Query(default=None, alias="startDate"),
    end_date: date | None = Query(default=None, alias="endDate"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER)),
):
    start_date, end_date = _resolve_report_range(start_date, end_date)
    if user.role == Role.SALES_MANAGER:
        return RevenueReport(
            scope="sales_manager",
            staff=await _staff_report_rows(
                db,
                business_profile_id=user.business_profile_id,
                role=Role.SALES_PERSON.value,
                start_date=start_date,
                end_date=end_date,
                manager_id=user.id,
            ),
        )

    managers = (
        (
            await db.execute(
                select(Staff)
                .where(
                    Staff.business_profile_id == user.business_profile_id,
                    Staff.role == Role.SALES_MANAGER.value,
                )
                .order_by(Staff.full_name)
            )
        )
        .scalars()
        .all()
    )
    manager_ids = [manager.id for manager in managers]
    staff_rows = await _staff_report_rows(
        db,
        business_profile_id=user.business_profile_id,
        role=Role.SALES_PERSON.value,
        start_date=start_date,
        end_date=end_date,
        manager_ids=manager_ids,
    ) if manager_ids else []

    by_manager = {
        manager.id: ManagerRevenuePerformance(
            manager=StaffReportDTO(
                id=manager.id,
                manager_id=manager.manager_id,
                employee_name=manager.full_name,
                employee_id=manager.employee_code,
                employee_code=manager.employee_code,
                full_name=manager.full_name,
                phone_number=manager.phone,
                phone=manager.phone,
                role=manager.role,
                status="active" if manager.is_active else "inactive",
                active=manager.is_active,
                avatar_initials=_initials(manager.full_name),
                total_bills=0,
                total_invoices=0,
                total_revenue=Decimal("0"),
            ),
            team_revenue=Decimal("0"),
            invoice_count=0,
            sales_persons=[],
        )
        for manager in managers
    }

    for performance in staff_rows:
        manager_id = performance.manager_id
        if manager_id not in by_manager:
            continue
        by_manager[manager_id].sales_persons.append(performance)
        by_manager[manager_id].team_revenue += performance.total_revenue
        by_manager[manager_id].invoice_count += performance.total_invoices

    return RevenueReport(scope="branch_manager", managers=list(by_manager.values()))


@router.get("/reports/products/insights", response_model=ProductInsightsReport)
async def product_insights_report(
    start_date: date | None = Query(default=None, alias="startDate"),
    end_date: date | None = Query(default=None, alias="endDate"),
    top: int = Query(default=8, ge=1, le=25),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER)),
):
    start_date, end_date = _resolve_report_range(start_date, end_date)

    low_rows = (
        await db.execute(
            select(
                Product.id,
                Product.name,
                Product.sku,
                Product.barcode,
                Product.category,
                Product.stock_cached,
                Product.reorder_level,
                Product.sell_price,
            )
            .where(
                Product.business_profile_id == user.business_profile_id,
                Product.is_active.is_(True),
                Product.stock_cached < 5,
            )
            .order_by(Product.stock_cached.asc(), Product.name.asc())
            .limit(top)
        )
    ).all()
    low_stock = [
        LowStockProductInsight(
            product_id=row.id,
            name=row.name,
            sku=row.sku,
            barcode=row.barcode,
            category=row.category,
            stock=_zero(row.stock_cached),
            reorder_level=_zero(row.reorder_level),
            sell_price=_zero(row.sell_price),
            status=_product_stock_status(_zero(row.stock_cached)),
        )
        for row in low_rows
    ]

    quantity_sold = func.coalesce(func.sum(InvoiceItem.quantity), 0)
    revenue = func.coalesce(func.sum(InvoiceItem.total), 0)
    best_stmt = (
        select(
            InvoiceItem.product_id.label("product_id"),
            func.max(InvoiceItem.product_name).label("name"),
            func.max(InvoiceItem.sku).label("sku"),
            func.max(InvoiceItem.barcode).label("barcode"),
            func.max(InvoiceItem.category).label("category"),
            quantity_sold.label("quantity_sold"),
            revenue.label("revenue"),
            func.count(func.distinct(Invoice.id)).label("invoices"),
            func.coalesce(func.max(Product.stock_cached), 0).label("stock"),
        )
        .join(Invoice, Invoice.id == InvoiceItem.invoice_id)
        .outerjoin(Product, Product.id == InvoiceItem.product_id)
        .where(
            Invoice.business_profile_id == user.business_profile_id,
            Invoice.is_reverse.is_(False),
            Invoice.date >= start_date,
            Invoice.date <= end_date,
        )
        .group_by(InvoiceItem.product_id)
        .order_by(desc("quantity_sold"), desc("revenue"))
        .limit(top)
    )
    if user.role == Role.SALES_MANAGER:
        sales_person_ids = await _managed_sales_person_ids(db, user)
        if not sales_person_ids:
            return ProductInsightsReport(low_stock=low_stock, best_sellers=[])
        best_stmt = best_stmt.where(Invoice.staff_id.in_(sales_person_ids))

    best_rows = (await db.execute(best_stmt)).all()
    best_sellers = [
        BestSellingProductInsight(
            product_id=row.product_id,
            name=row.name,
            sku=row.sku,
            barcode=row.barcode,
            category=row.category,
            quantity_sold=_zero(row.quantity_sold),
            revenue=_zero(row.revenue),
            invoices=int(row.invoices or 0),
            stock=_zero(row.stock),
        )
        for row in best_rows
    ]
    return ProductInsightsReport(low_stock=low_stock, best_sellers=best_sellers)


@router.get("/reports/payments", response_model=list[PaymentMethodSummary])
async def payments_report(
    start_date: date | None = Query(default=None, alias="startDate"),
    end_date: date | None = Query(default=None, alias="endDate"),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER)),
):
    start_date, end_date = _resolve_report_range(start_date, end_date)
    return await PaymentRepository(db).summary_by_method(user.business_profile_id, start_date, end_date)


@router.get("/reports/returns")
async def returns_report(
    start_date: date | None = Query(default=None, alias="startDate"),
    end_date: date | None = Query(default=None, alias="endDate"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER)),
):
    start_date, end_date = _resolve_report_range(start_date, end_date)
    stmt = select(Return.staff_id, func.count(Return.id), func.coalesce(func.sum(Return.refund_amount), 0)).where(
        Return.business_profile_id == user.business_profile_id,
        Return.return_date >= start_date,
        Return.return_date <= end_date,
    )
    if user.role == Role.SALES_MANAGER:
        sp_ids = [
            r
            for r in (
                await db.execute(
                    select(Staff.id).where(
                        Staff.business_profile_id == user.business_profile_id,
                        Staff.manager_id == user.id,
                    )
                )
            ).scalars().all()
        ] or [-1]
        stmt = stmt.where(Return.staff_id.in_(sp_ids))
    stmt = stmt.group_by(Return.staff_id)
    rows = (await db.execute(stmt)).all()
    return [{"staff_id": s, "returns": c, "return_value": float(v)} for s, c, v in rows]


@router.get("/reports/returns/summary", response_model=ReturnReportSummary)
async def return_report_summary(
    filters: ReturnReportFilters = Depends(_return_report_filters),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return await ReturnReportService(db, user).summary(filters)


@router.get("/reports/returns/trends", response_model=list[ReturnTrendPoint])
async def return_report_trends(
    grain: str = Query(default="daily", pattern="^(daily|weekly|monthly|quarterly|yearly)$"),
    filters: ReturnReportFilters = Depends(_return_report_filters),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return await ReturnReportService(db, user).trends(filters, grain)  # type: ignore[arg-type]


@router.get("/reports/returns/breakdowns", response_model=ReturnBreakdowns)
async def return_report_breakdowns(
    top: int = Query(default=10, ge=1, le=50),
    filters: ReturnReportFilters = Depends(_return_report_filters),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return await ReturnReportService(db, user).breakdowns(filters, top=top)


@router.get("/reports/returns/table", response_model=ReturnReportTable)
async def return_report_table(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, alias="pageSize", ge=1, le=100),
    sort: str = Query(default="date"),
    direction: str = Query(default="desc", pattern="^(asc|desc)$"),
    filters: ReturnReportFilters = Depends(_return_report_filters),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return await ReturnReportService(db, user).table(
        filters,
        page=page,
        page_size=page_size,
        sort=sort,
        direction=direction,
    )


@router.get("/reports/returns/insights", response_model=list[ReturnInsight])
async def return_report_insights(
    filters: ReturnReportFilters = Depends(_return_report_filters),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return await ReturnReportService(db, user).insights(filters)


@router.get("/reports/returns/product-health", response_model=ReturnEntityAnalytics)
async def return_report_product_health(
    top: int = Query(default=20, ge=1, le=100),
    filters: ReturnReportFilters = Depends(_return_report_filters),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return await ReturnReportService(db, user).entity_analytics(filters, "product", top=top)


@router.get("/reports/returns/supplier", response_model=ReturnEntityAnalytics)
async def return_report_supplier(
    top: int = Query(default=20, ge=1, le=100),
    filters: ReturnReportFilters = Depends(_return_report_filters),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return await ReturnReportService(db, user).entity_analytics(filters, "supplier", top=top)


@router.get("/reports/returns/customer", response_model=ReturnEntityAnalytics)
async def return_report_customer(
    top: int = Query(default=20, ge=1, le=100),
    filters: ReturnReportFilters = Depends(_return_report_filters),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return await ReturnReportService(db, user).entity_analytics(filters, "customer", top=top)


@router.get("/reports/returns/employee", response_model=ReturnEntityAnalytics)
async def return_report_employee(
    top: int = Query(default=20, ge=1, le=100),
    filters: ReturnReportFilters = Depends(_return_report_filters),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return await ReturnReportService(db, user).entity_analytics(filters, "employee", top=top)


@router.get("/reports/returns/inventory", response_model=ReturnInventoryAnalytics)
async def return_report_inventory(
    filters: ReturnReportFilters = Depends(_return_report_filters),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return await ReturnReportService(db, user).inventory(filters)


@router.get("/reports/returns/export")
async def return_report_export(
    format: str = Query(default="csv", pattern="^(csv)$"),
    filters: ReturnReportFilters = Depends(_return_report_filters),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    if format != "csv":
        raise HTTPException(status_code=400, detail="Only CSV export is currently enabled")
    content = await ReturnReportService(db, user).export_csv(filters)
    filename = f"return-report-{date.today().isoformat()}.csv"
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
