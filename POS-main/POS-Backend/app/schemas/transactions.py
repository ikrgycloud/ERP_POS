"""Request/response schemas for the transactional flow."""
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, Field, computed_field, model_validator

from app.schemas.common import ORMModel
from app.schemas.notifications import NotificationStatus


# --------------------------- Cart / Billing ---------------------------
class CartStart(BaseModel):
    customer_phone: Optional[str] = None
    customer_id: Optional[int] = None


class CartScan(BaseModel):
    barcode: str = Field(min_length=1, max_length=80)
    quantity: Decimal = Field(default=Decimal("1"), gt=0)


class CartLineUpdate(BaseModel):
    product_id: Optional[int] = None
    quantity: Optional[Decimal] = Field(default=None, gt=0)


class CartCustomerUpdate(BaseModel):
    customer_id: Optional[int] = None


class CartLine(BaseModel):
    order_item_id: int
    product_id: int
    product_name: str
    quantity: Decimal
    rate: Decimal
    discount_pct: Decimal
    discount_type: Optional[str] = None
    discount_value: Optional[Decimal] = None
    discount_label: Optional[str] = None
    gst_rate: Decimal
    line_total: Decimal


class CartTotals(BaseModel):
    subtotal: Decimal
    discount: Decimal
    taxable_value: Decimal
    cgst: Decimal
    sgst: Decimal
    igst: Decimal
    grand_total: Decimal


class CartView(BaseModel):
    order_id: int
    order_number: str
    status: str = "Draft"
    expires_at: Optional[datetime] = None
    terminal_id: Optional[str] = None
    lease_expires_at: Optional[datetime] = None
    lines: List[CartLine]
    totals: CartTotals


class CheckoutPayment(BaseModel):
    method: str = Field(min_length=1, max_length=30)
    amount: Decimal = Field(gt=0)
    reference_no: Optional[str] = Field(default=None, max_length=120)


class CheckoutRequest(BaseModel):
    payment_method: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=30,
        examples=["cash", "upi", "card", "wallet", "cheque", "split"],
    )
    payments: Optional[List[CheckoutPayment]] = None
    cash_received: Optional[Decimal] = Field(default=None, ge=0)
    upi_reference: Optional[str] = Field(default=None, max_length=120)
    card_reference: Optional[str] = Field(default=None, max_length=120)
    cheque_reference: Optional[str] = Field(default=None, max_length=120)
    allow_partial: bool = False
    inter_state: bool = False

    @model_validator(mode="after")
    def normalize_payment_method(self):
        if not self.payments and not self.payment_method:
            raise ValueError("payment_method is required")
        return self


# ----------------------------- Invoice -----------------------------
class InvoiceItemOut(ORMModel):
    id: int
    invoice_id: int
    order_item_id: Optional[int]
    product_id: int
    product_name: str
    barcode: Optional[str]
    sku: Optional[str]
    category: Optional[str]
    quantity: Decimal
    unit_price: Decimal
    discount_pct: Decimal
    discount_amount: Decimal
    tax_rate: Decimal
    tax_amount: Decimal
    total: Decimal
    mrp: Optional[Decimal]


class InvoiceOut(ORMModel):
    id: int
    invoice_number: str
    order_id: Optional[int]
    invoice_type: str
    is_reverse: bool
    linked_invoice_id: Optional[int]
    outlet_id: Optional[int]
    customer_id: Optional[int]
    customer_phone: Optional[str] = None
    staff_id: Optional[int]
    party_name: str
    date: date
    due_date: date
    taxable_value: Decimal
    cgst: Decimal
    sgst: Decimal
    igst: Decimal
    status: str
    payment_method: Optional[str]
    created_at: datetime
    items: List[InvoiceItemOut] = []
    notification_status: Optional[NotificationStatus] = None
    public_invoice_url: Optional[str] = None
    amount_paid: Optional[Decimal] = None
    balance_due: Optional[Decimal] = None
    change_due: Optional[Decimal] = None
    payments: List["PaymentOut"] = []

    @computed_field
    @property
    def lines(self) -> List[InvoiceItemOut]:
        return self.items


# ----------------------------- Payment -----------------------------
class PaymentCreate(BaseModel):
    invoice_id: int
    method: str
    amount: Decimal
    direction: str = "in"
    reference_no: Optional[str] = None


class PaymentOut(ORMModel):
    id: int
    invoice_id: int
    method: str
    amount: Decimal
    direction: str
    reference_no: Optional[str]
    created_at: datetime


class PaymentMethodSummary(BaseModel):
    method: str
    total: Decimal


class StaffReportDTO(BaseModel):
    id: int
    manager_id: Optional[int] = None
    employee_name: str
    employee_id: str
    employee_code: str
    full_name: str
    phone_number: Optional[str]
    phone: Optional[str]
    role: str
    status: str
    active: bool
    avatar_initials: str
    total_bills: int
    total_invoices: int
    total_revenue: Decimal


class ManagerRevenuePerformance(BaseModel):
    manager: StaffReportDTO
    team_revenue: Decimal
    invoice_count: int
    sales_persons: List[StaffReportDTO]


class RevenueReport(BaseModel):
    scope: str
    staff: List[StaffReportDTO] = []
    managers: List[ManagerRevenuePerformance] = []


# ----------------------------- Returns -----------------------------
class ReturnLookup(BaseModel):
    invoice_number: Optional[str] = None
    barcode: Optional[str] = None
    customer_phone: Optional[str] = None


class ReturnItemIn(BaseModel):
    invoice_item_id: Optional[int] = None
    product_id: Optional[int] = None
    order_item_id: Optional[int] = None
    quantity: Decimal = Field(gt=0)
    damage_type: Optional[str] = None
    remarks: Optional[str] = None


class ReturnCreate(BaseModel):
    original_invoice_id: int
    reason: Optional[str] = None
    resolution: str = "refund"
    refund_method: Optional[str] = None
    remarks: Optional[str] = None
    items: List[ReturnItemIn] = Field(min_length=1)


class ReturnItemOut(ORMModel):
    id: int
    product_id: int
    quantity: Decimal
    rate: Decimal
    discount: Decimal
    gst_rate: Decimal
    line_refund: Decimal
    damage_type: Optional[str]
    remarks: Optional[str]


class ReturnEvidenceOut(ORMModel):
    id: int
    return_id: int
    original_name: str
    file_url: str
    content_type: str
    file_size: int
    note: Optional[str]
    uploaded_at: datetime


class ReturnEvidenceUploadLink(BaseModel):
    return_id: int
    return_number: str
    upload_url: str
    expires_at: datetime


class ReturnEvidenceUploadInfo(BaseModel):
    return_id: int
    return_number: str
    status: str
    expires_at: datetime
    max_upload_bytes: int


class ReturnOut(ORMModel):
    id: int
    return_number: str
    original_invoice_id: int
    reversal_invoice_id: Optional[int]
    outlet_id: Optional[int]
    customer_id: Optional[int]
    staff_id: Optional[int]
    return_date: date
    reason: Optional[str]
    resolution: str
    refund_method: Optional[str]
    refund_amount: Decimal
    refund_status: str
    status: str
    evidence_required: bool = False
    evidence_count: int = 0
    items: List[ReturnItemOut] = []
    evidence: List[ReturnEvidenceOut] = []
    created_at: datetime


class ReturnStatusUpdate(BaseModel):
    status: str = Field(min_length=1, max_length=40)


# ---------------------------- Dashboards ----------------------------
class BranchManagerDashboard(BaseModel):
    sales_managers: int
    sales_persons: int
    products: int
    customers: int
    today_sales: Decimal
    today_revenue: Decimal
    low_stock: int
    pending_orders: int


class SalesManagerDashboard(BaseModel):
    total_sales_persons: int
    active_sales_persons: int
    today_invoices: int
    today_revenue: Decimal
    monthly_invoices: int
    monthly_revenue: Decimal
    returns: int
    top_performer: Optional[str]


class SalesPersonDashboard(BaseModel):
    today_bills: int
    today_revenue: Decimal
    monthly_bills: int
    monthly_revenue: Decimal
    invoice_count: int
