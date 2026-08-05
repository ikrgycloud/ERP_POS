"""Schemas for analytics/reporting APIs."""
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, Field


class ReturnReportSummary(BaseModel):
    total_return_invoices: int = 0
    total_returned_items: Decimal = Decimal("0")
    total_damaged_items: Decimal = Decimal("0")
    total_restocked_items: Decimal = Decimal("0")
    total_destroyed_items: Decimal = Decimal("0")
    total_vendor_returns: Decimal = Decimal("0")
    total_repairs: Decimal = Decimal("0")
    replacement_orders: int = 0
    pending_approval: int = 0
    pending_inspection: int = 0
    pending_refund: int = 0
    pending_inventory_update: int = 0
    refund_amount: Decimal = Decimal("0")
    replacement_cost: Decimal = Decimal("0")
    damage_cost: Decimal = Decimal("0")
    recovery_value: Decimal = Decimal("0")
    net_loss: Decimal = Decimal("0")
    gross_loss: Decimal = Decimal("0")
    inventory_adjustment_value: Decimal = Decimal("0")
    return_rate: Decimal = Decimal("0")
    damage_rate: Decimal = Decimal("0")
    recovery_rate: Decimal = Decimal("0")
    average_return_value: Decimal = Decimal("0")
    average_refund: Decimal = Decimal("0")
    average_processing_time_hours: Decimal = Decimal("0")
    largest_return: Decimal = Decimal("0")
    largest_loss: Decimal = Decimal("0")
    highest_refund: Decimal = Decimal("0")


class ReturnTrendPoint(BaseModel):
    period: str
    returns: int = 0
    returned_qty: Decimal = Decimal("0")
    damaged_qty: Decimal = Decimal("0")
    restocked_qty: Decimal = Decimal("0")
    refund_amount: Decimal = Decimal("0")
    loss_value: Decimal = Decimal("0")
    recovery_value: Decimal = Decimal("0")


class ReturnBreakdownItem(BaseModel):
    key: str
    label: str
    count: int = 0
    quantity: Decimal = Decimal("0")
    refund_amount: Decimal = Decimal("0")
    loss_value: Decimal = Decimal("0")
    recovery_value: Decimal = Decimal("0")


class ReturnBreakdowns(BaseModel):
    reasons: list[ReturnBreakdownItem] = []
    statuses: list[ReturnBreakdownItem] = []
    products: list[ReturnBreakdownItem] = []
    damaged_products: list[ReturnBreakdownItem] = []
    categories: list[ReturnBreakdownItem] = []
    suppliers: list[ReturnBreakdownItem] = []
    employees: list[ReturnBreakdownItem] = []
    customers: list[ReturnBreakdownItem] = []
    outlets: list[ReturnBreakdownItem] = []


class ReturnReportItemDetail(BaseModel):
    id: int
    product_id: int
    product_name: str
    sku: Optional[str] = None
    barcode: Optional[str] = None
    category: Optional[str] = None
    supplier: Optional[str] = None
    returned_qty: Decimal = Decimal("0")
    damaged_qty: Decimal = Decimal("0")
    restocked_qty: Decimal = Decimal("0")
    selling_price: Decimal = Decimal("0")
    cost_price: Decimal = Decimal("0")
    refund_amount: Decimal = Decimal("0")
    damage_cost: Decimal = Decimal("0")
    reason: Optional[str] = None
    remarks: Optional[str] = None
    batch_number: Optional[str] = None
    expiry_date: Optional[date] = None
    warehouse: Optional[str] = None
    stock_status: str = "unknown"


class ReturnReportRow(BaseModel):
    id: int
    return_invoice_no: str
    original_invoice_no: Optional[str] = None
    reversal_invoice_no: Optional[str] = None
    date: date
    customer: Optional[str] = None
    employee: Optional[str] = None
    employee_code: Optional[str] = None
    outlet: Optional[str] = None
    return_type: Optional[str] = None
    product_count: int = 0
    returned_qty: Decimal = Decimal("0")
    damaged_qty: Decimal = Decimal("0")
    restocked_qty: Decimal = Decimal("0")
    total_refund: Decimal = Decimal("0")
    loss_value: Decimal = Decimal("0")
    recovery_value: Decimal = Decimal("0")
    status: str
    refund_status: str
    created_at: datetime
    items: list[ReturnReportItemDetail] = []


class ReturnReportTable(BaseModel):
    rows: list[ReturnReportRow]
    total: int
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)
    sort: str
    direction: str


class ReturnInsight(BaseModel):
    severity: str
    title: str
    message: str
    metric: Optional[str] = None
    value: Optional[Decimal | int | str] = None


class ReturnEntityAnalytics(BaseModel):
    rows: list[ReturnBreakdownItem]


class ReturnInventoryAnalytics(BaseModel):
    restocked: Decimal = Decimal("0")
    damaged: Decimal = Decimal("0")
    destroyed: Decimal = Decimal("0")
    vendor_return: Decimal = Decimal("0")
    repair: Decimal = Decimal("0")
    inspection_pending: int = 0
    replacement_pending: int = 0
    inventory_frozen: Decimal = Decimal("0")
    inventory_released: Decimal = Decimal("0")
    inventory_adjustment_value: Decimal = Decimal("0")


class ReturnReportExport(BaseModel):
    format: str
    generated_at: datetime
    filters: dict[str, Any]


class LowStockProductInsight(BaseModel):
    product_id: int
    name: str
    sku: Optional[str] = None
    barcode: Optional[str] = None
    category: Optional[str] = None
    stock: Decimal = Decimal("0")
    reorder_level: Decimal = Decimal("0")
    sell_price: Decimal = Decimal("0")
    status: str


class BestSellingProductInsight(BaseModel):
    product_id: int
    name: str
    sku: Optional[str] = None
    barcode: Optional[str] = None
    category: Optional[str] = None
    quantity_sold: Decimal = Decimal("0")
    revenue: Decimal = Decimal("0")
    invoices: int = 0
    stock: Decimal = Decimal("0")


class ProductInsightsReport(BaseModel):
    low_stock: list[LowStockProductInsight] = []
    best_sellers: list[BestSellingProductInsight] = []
