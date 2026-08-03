from datetime import date, datetime
from decimal import Decimal
import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        from_attributes=True,
        populate_by_name=True,
    )


class BusinessProfileBase(CamelModel):
    role: str = "admin"
    access_code: str | None = None
    legal_name: str
    trade_name: str
    logo_text: str = "ERP"
    logo_url: str | None = None
    logo_path: str | None = None
    owner_name: str
    mobile: str
    email: str
    gstin: str | None = None
    pan: str | None = None
    cin: str | None = None
    business_type: str | None = None
    tax_type: str = "Regular GST"
    currency: str = "INR"
    financial_year: str = "2026-2027"
    billing_address: str | None = None
    shipping_address: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = None
    bank_name: str | None = None
    account_number: str | None = None
    ifsc: str | None = None
    upi_id: str | None = None

    @field_validator("logo_text")
    @classmethod
    def logo_text_must_fit_database(cls, value: str) -> str:
        # Logo text is a display label and the database column is VARCHAR(20).
        # Trim it here so a longer company name can never make registration fail.
        return (value or "ERP").strip()[:20] or "ERP"

    @field_validator("mobile")
    @classmethod
    def mobile_must_be_valid(cls, value: str) -> str:
        digits = re.sub(r"\D", "", value or "")
        if not re.fullmatch(r"[6-9]\d{9}", digits):
            raise ValueError("Mobile number must be a valid 10 digit Indian mobile number")
        return digits

    @field_validator("email")
    @classmethod
    def email_must_be_normalized(cls, value: str) -> str:
        normalized = (value or "").strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", normalized):
            raise ValueError("Email must be valid")
        return normalized

    @field_validator("pincode")
    @classmethod
    def pincode_must_be_valid(cls, value: str | None) -> str | None:
        if value in {None, ""}:
            return value
        digits = re.sub(r"\D", "", value)
        if not re.fullmatch(r"\d{6}", digits):
            raise ValueError("Pincode must be 6 digits")
        return digits

    @field_validator("account_number")
    @classmethod
    def account_number_must_be_numeric(cls, value: str | None) -> str | None:
        if value in {None, ""}:
            return value
        digits = re.sub(r"\D", "", value)
        if not re.fullmatch(r"\d{6,18}", digits):
            raise ValueError("Bank account number must be 6 to 18 digits")
        return digits


class BusinessProfileCreate(BusinessProfileBase):
    password: str


class AdminRegisterCreate(BusinessProfileCreate):
    register_key: str


class BusinessProfileUpdate(BusinessProfileBase):
    password: str | None = None


class BusinessProfileOut(BusinessProfileBase):
    id: int
    created_at: datetime
    updated_at: datetime


class OutletBase(CamelModel):
    outlet_code: str
    role: str = "outlet"
    access_code: str | None = None
    password: str | None = None
    legal_name: str
    trade_name: str
    logo_text: str = "ERP"
    owner_name: str
    mobile: str
    email: str
    name: str
    manager_name: str | None = None
    gstin: str | None = None
    pan: str | None = None
    cin: str | None = None
    business_type: str | None = None
    tax_type: str = "Regular GST"
    currency: str = "INR"
    financial_year: str = "2026-2027"
    address: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = None
    bank_name: str | None = None
    account_number: str | None = None
    ifsc: str | None = None
    upi_id: str | None = None
    is_active: bool = True

    @field_validator("mobile")
    @classmethod
    def outlet_mobile_must_be_valid(cls, value: str) -> str:
        digits = re.sub(r"\D", "", value or "")
        if not re.fullmatch(r"[6-9]\d{9}", digits):
            raise ValueError("Mobile number must be a valid 10 digit Indian mobile number")
        return digits

    @field_validator("pincode")
    @classmethod
    def outlet_pincode_must_be_valid(cls, value: str | None) -> str | None:
        if value in {None, ""}:
            return value
        digits = re.sub(r"\D", "", value)
        if not re.fullmatch(r"\d{6}", digits):
            raise ValueError("Pincode must be 6 digits")
        return digits

    @field_validator("account_number")
    @classmethod
    def outlet_account_number_must_be_numeric(cls, value: str | None) -> str | None:
        if value in {None, ""}:
            return value
        digits = re.sub(r"\D", "", value)
        if not re.fullmatch(r"\d{6,18}", digits):
            raise ValueError("Bank account number must be 6 to 18 digits")
        return digits


class OutletCreate(OutletBase):
    pass


class OutletUpdate(OutletBase):
    password: str | None = None


class OutletOut(OutletBase):
    id: int
    business_profile_id: int
    created_at: datetime
    updated_at: datetime


class CustomerBase(CamelModel):
    phone: str
    name: str | None = None
    email: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = None
    notes: str | None = None


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(CustomerBase):
    phone: str | None = None


class CustomerOut(CustomerBase):
    id: int
    outlet_id: int
    total_spent: Decimal
    purchase_count: int
    loyalty_points: int
    last_purchase_amount: Decimal
    last_purchase_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CategoryBase(CamelModel):
    name: str
    description: str | None = None
    is_active: bool = True


class CategoryCreate(CategoryBase):
    pass


class CategoryOut(CategoryBase):
    id: int
    created_at: datetime
    updated_at: datetime


class SupplierBase(CamelModel):
    name: str
    phone: str | None = None
    mobile: str | None = None
    email: str | None = None
    address: str | None = None
    gstin: str | None = None
    is_active: bool = True

    @model_validator(mode="after")
    def normalize_contact_number(self) -> "SupplierBase":
        contact_number = (self.phone or self.mobile or "").strip() or None
        if contact_number:
            digits = re.sub(r"\D", "", contact_number)
            if len(digits) < 7 or len(digits) > 15:
                raise ValueError("Supplier phone must contain 7 to 15 digits")
        self.phone = contact_number
        self.mobile = contact_number
        return self


class SupplierCreate(SupplierBase):
    pass


class SupplierUpdate(SupplierBase):
    pass


class SupplierOut(SupplierBase):
    id: int
    business_profile_id: int | None = None
    created_at: datetime
    updated_at: datetime


class PosStaffCreate(CamelModel):
    outlet_id: int
    role: str = "sales_person"
    employee_code: str
    full_name: str
    phone: str | None = None
    email: str | None = None
    password: str = Field(min_length=8, max_length=64)

    @field_validator("employee_code")
    @classmethod
    def pos_employee_code_must_be_valid(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not re.fullmatch(r"[A-Z0-9_-]{2,40}", normalized):
            raise ValueError("Employee code may use letters, numbers, hyphens, and underscores only")
        return normalized

    @field_validator("role")
    @classmethod
    def pos_role_must_be_supported(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"branch_manager", "sales_manager", "sales_person"}:
            raise ValueError("Role must be branch_manager, sales_manager, or sales_person")
        return normalized


class PosStaffOut(CamelModel):
    id: int
    business_profile_id: int
    outlet_id: int | None
    role: str
    employee_code: str
    full_name: str
    phone: str | None = None
    email: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class UploadedFileOut(CamelModel):
    id: int
    business_profile_id: int | None = None
    original_name: str
    stored_name: str
    file_url: str
    file_type: str
    row_count: int
    columns: list[str] = Field(default_factory=list)
    preview_rows: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class FileProductImportSubmit(CamelModel):
    rows: list[dict[str, Any]] | None = None
    row_overrides: list[dict[str, Any]] | None = None


class FileProductImportResult(CamelModel):
    created: int = 0
    updated: int = 0
    skipped: int = 0
    messages: list[str] = Field(default_factory=list)
    products: list["ProductOut"] = Field(default_factory=list)


class ProductBase(CamelModel):
    sku: str | None = None
    name: str
    category_id: int | None = None
    supplier_id: int | None = None
    category: str
    supplier: str
    qty_bought: Decimal = Field(default=0, ge=0)
    qty_sold: Decimal = Field(default=0, ge=0)
    unit_type: str = "pieces"
    unit_label: str = "Pieces"
    package_size: Decimal | None = None
    package_size_unit: str | None = None
    package_price: Decimal | None = None
    quantity_options: str | None = None
    barcode: str | None = None
    mrp: Decimal = Field(gt=0)
    buy_price: Decimal = Field(ge=0)
    sell_price: Decimal = Field(ge=0)
    gst_rate: Decimal = Field(default=18, ge=0)
    reorder_level: Decimal = Field(default=0, ge=0)

    @field_validator("qty_sold")
    @classmethod
    def sold_cannot_exceed_bought(cls, value: Decimal, info: Any) -> Decimal:
        qty_bought = info.data.get("qty_bought")
        if qty_bought is not None and value > qty_bought:
            raise ValueError("qtySold cannot be greater than qtyBought")
        return value


class ProductCreate(ProductBase):
    pass


class ProductUpdate(ProductBase):
    pass


class ProductOut(ProductBase):
    id: int
    business_profile_id: int | None = None
    sku: str
    remaining: Decimal
    revenue: Decimal
    profit: Decimal
    margin: Decimal
    inventory_value: Decimal
    quantity_history: list["ProductQuantityOut"] = Field(default_factory=list)
    qualities: list["ProductQualityOut"] = Field(default_factory=list)
    price_history: list["ProductPriceOut"] = Field(default_factory=list)
    discounts: list["ProductDiscountOut"] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class ProductQualityBase(CamelModel):
    product_id: int | None = None
    quality_status: str = "new"
    transaction_type: str = "quality_adjustment"
    quantity: Decimal
    effective_date: date = Field(default_factory=date.today)
    note: str | None = None


class ProductQualityCreate(ProductQualityBase):
    product_id: int


class ProductQualityUpdate(CamelModel):
    quality_status: str | None = None
    transaction_type: str | None = None
    quantity: Decimal | None = None
    effective_date: date | None = None
    note: str | None = None


class ProductQualityOut(ProductQualityBase):
    id: int
    product_id: int
    business_profile_id: int | None = None
    created_at: datetime
    updated_at: datetime


class ProductQuantityOut(CamelModel):
    id: int
    product_id: int
    business_profile_id: int | None = None
    transaction_type: str
    quantity_change: Decimal
    old_stock: Decimal | None = None
    new_stock: Decimal | None = None
    sold_stock: Decimal | None = None
    effective_date: date
    remaining_quantity: Decimal | None = None
    reference_order_id: int | None = None
    note: str | None = None
    created_at: datetime
    updated_at: datetime


class ProductPriceBase(CamelModel):
    product_id: int | None = None
    effective_date: date = Field(default_factory=date.today)
    mrp: Decimal = Field(gt=0)
    buy_price: Decimal = Field(ge=0)
    sell_price: Decimal = Field(ge=0)
    source: str = "manual"
    note: str | None = None


class ProductPriceCreate(ProductPriceBase):
    product_id: int


class ProductPriceUpdate(CamelModel):
    effective_date: date | None = None
    mrp: Decimal | None = None
    buy_price: Decimal | None = None
    sell_price: Decimal | None = None
    source: str | None = None
    note: str | None = None


class ProductPriceOut(ProductPriceBase):
    id: int
    product_id: int
    business_profile_id: int | None = None
    created_at: datetime
    updated_at: datetime


class ProductDiscountBase(CamelModel):
    product_id: int | None = None
    discount_type: str = "percentage"
    discount_value: Decimal = Field(ge=0)
    min_quantity: Decimal = Field(default=0, ge=0)
    start_date: date | None = None
    end_date: date | None = None
    is_active: bool = True
    description: str | None = None


class ProductDiscountCreate(ProductDiscountBase):
    product_id: int


class ProductDiscountUpdate(CamelModel):
    discount_type: str | None = None
    discount_value: Decimal | None = Field(ge=0)
    min_quantity: Decimal | None = Field(ge=0)
    start_date: date | None = None
    end_date: date | None = None
    is_active: bool | None = None
    description: str | None = None


class ProductDiscountOut(ProductDiscountBase):
    id: int
    product_id: int
    business_profile_id: int | None = None
    created_at: datetime
    updated_at: datetime


class ProductInventoryValueOut(CamelModel):
    product_id: int
    date: date
    quantity: Decimal
    price: Decimal
    inventory_value: Decimal
    price_source: str


class OrderItemBase(CamelModel):
    product_id: int
    quantity: Decimal = Field(gt=0)
    unit_type: str = "pieces"
    unit_label: str = "Pieces"
    package_count: Decimal | None = Field(default=None, gt=0)
    package_size: Decimal | None = Field(default=None, gt=0)
    package_size_unit: str | None = None
    rate: Decimal = Field(gt=0)
    gst_rate: Decimal = Field(default=18, ge=0, le=100)


class OrderItemCreate(OrderItemBase):
    pass


class OrderItemOut(OrderItemBase):
    id: int
    product_name: str | None = None
    sku: str | None = None
    line_subtotal: Decimal = Decimal("0")
    discount_amount: Decimal = Decimal("0")
    discount_pct: Decimal = Decimal("0")
    discount_label: str | None = None
    available_discount_pct: Decimal = Decimal("0")
    available_discount_label: str | None = None
    line_total: Decimal = Decimal("0")


class OrderBase(CamelModel):
    type: str
    party_type: str
    party_name: str
    outlet_id: int | None = None
    customer_id: int | None = None
    supplier_id: int | None = None
    status: str = "Draft"
    date: date
    payment_status: str = "Unpaid"
    business_profile_id: int | None = None

    @field_validator("type")
    @classmethod
    def order_type_must_be_supported(cls, value: str) -> str:
        normalized = (value or "").strip().lower()
        if normalized not in {"purchase", "sale"}:
            raise ValueError("Order type must be purchase or sale")
        return normalized

    @field_validator("party_type")
    @classmethod
    def party_type_must_be_supported(cls, value: str) -> str:
        legacy_party_types = {
            "CUSTOMER": "B2C",
            "CONSUMER": "B2C",
            "B2C_CUSTOMER": "B2C",
            "SUPPLIER": "B2B",
            "BUSINESS": "B2B",
            "OUTLET": "B2B",
            "ADMIN": "B2B",
        }
        normalized = (value or "").strip().upper()
        normalized = legacy_party_types.get(normalized, normalized)
        if normalized not in {"B2B", "B2C"}:
            raise ValueError("Party type must be B2B or B2C")
        return normalized

    @field_validator("party_name")
    @classmethod
    def party_name_is_required(cls, value: str) -> str:
        cleaned = (value or "").strip()
        if not cleaned:
            raise ValueError("Party name is required")
        return cleaned

    @field_validator("status")
    @classmethod
    def status_must_be_supported(cls, value: str, info: Any) -> str:
        cleaned = (value or "").strip()
        if cleaned.lower() == "completed":
            cleaned = "Received" if info.data.get("type") == "purchase" else "Delivered"
        allowed = (
            {"Draft", "Sent", "Received", "Cancelled"}
            if info.data.get("type") == "purchase"
            else {"Draft", "Packed", "Delivered", "Cancelled"}
        )
        if cleaned not in allowed:
            raise ValueError(f"Order status must be one of: {', '.join(sorted(allowed))}")
        return cleaned

    @field_validator("payment_status")
    @classmethod
    def payment_status_must_be_supported(cls, value: str) -> str:
        cleaned = (value or "").strip()
        allowed = {"Unpaid", "Partially Paid", "Paid"}
        if cleaned not in allowed:
            raise ValueError("Payment status must be Unpaid, Partially Paid, or Paid")
        return cleaned


class OrderCreate(OrderBase):
    items: list[OrderItemCreate] = Field(min_length=1)

    @model_validator(mode="after")
    def product_lines_must_be_unique(self) -> "OrderCreate":
        product_ids = [item.product_id for item in self.items]
        if len(product_ids) != len(set(product_ids)):
            raise ValueError("Each product can appear only once per order")
        return self


class OrderUpdate(OrderBase):
    items: list[OrderItemCreate] = Field(min_length=1)

    @model_validator(mode="after")
    def product_lines_must_be_unique(self) -> "OrderUpdate":
        product_ids = [item.product_id for item in self.items]
        if len(product_ids) != len(set(product_ids)):
            raise ValueError("Each product can appear only once per order")
        return self


class OrderQuoteCreate(CamelModel):
    type: str
    items: list[OrderItemCreate]

    @field_validator("type")
    @classmethod
    def order_type_must_be_supported(cls, value: str) -> str:
        normalized = (value or "").strip().lower()
        if normalized not in {"purchase", "sale"}:
            raise ValueError("Order type must be purchase or sale")
        return normalized

    @model_validator(mode="after")
    def product_lines_must_be_unique(self) -> "OrderQuoteCreate":
        product_ids = [item.product_id for item in self.items]
        if len(product_ids) != len(set(product_ids)):
            raise ValueError("Each product can appear only once per order")
        return self


class OrderQuoteOut(CamelModel):
    subtotal_value: Decimal = Decimal("0")
    discount_value: Decimal = Decimal("0")
    discount_amount: Decimal = Decimal("0")
    taxable_value: Decimal = Decimal("0")
    tax_value: Decimal = Decimal("0")
    grand_total: Decimal = Decimal("0")
    items: list[OrderItemOut]


class OrderOut(OrderBase):
    @field_validator("status")
    @classmethod
    def status_must_be_supported(cls, value: str, info: Any) -> str:
        """Accept statuses stored by earlier releases without relaxing write validation."""
        cleaned = (value or "").strip()
        if cleaned.lower() == "completed":
            return "Received" if info.data.get("type") == "purchase" else "Delivered"
        allowed = (
            {"Draft", "Sent", "Received", "Cancelled", "Expired"}
            if info.data.get("type") == "purchase"
            else {"Draft", "Packed", "Delivered", "Cancelled", "Expired"}
        )
        if cleaned not in allowed:
            raise ValueError(f"Order status must be one of: {', '.join(sorted(allowed))}")
        return cleaned

    id: int
    order_number: str
    customer_name: str | None = None
    customer_phone: str | None = None
    supplier_name: str | None = None
    supplier_email: str | None = None
    supplier_phone: str | None = None
    supplier_mobile: str | None = None
    inventory_applied: bool = False
    taxable_value: Decimal
    subtotal_value: Decimal = Decimal("0")
    discount_value: Decimal = Decimal("0")
    discount_amount: Decimal = Decimal("0")
    tax_value: Decimal
    grand_total: Decimal
    items: list[OrderItemOut]
    created_at: datetime
    updated_at: datetime


class InvoiceBase(CamelModel):
    order_id: int | None = None
    invoice_type: str
    invoice_direction: str = "outlet_to_customer"
    linked_invoice_id: int | None = None
    outlet_id: int | None = None
    customer_id: int | None = None
    is_reverse: bool = False
    party_type: str
    party_name: str
    date: date
    due_date: date
    taxable_value: Decimal = Field(ge=0)
    cgst: Decimal = Field(default=0, ge=0)
    sgst: Decimal = Field(default=0, ge=0)
    igst: Decimal = Field(default=0, ge=0)
    status: str = "Unpaid"
    business_profile_id: int | None = None


class InvoiceCreate(InvoiceBase):
    pass


class InvoiceUpdate(InvoiceBase):
    pass


class InvoiceGenerate(CamelModel):
    order_id: int
    due_date: date
    status: str = "Unpaid"
    intra_state: bool = True
    invoice_direction: str | None = None


class InvoiceReverse(CamelModel):
    invoice_id: int | None = None
    due_date: date = Field(default_factory=date.today)
    status: str = "Pending Approval"


class InvoiceOut(InvoiceBase):
    id: int
    invoice_number: str
    order_number: str | None = None
    party_category: str | None = None
    party_role: str | None = None
    party_phone: str | None = None
    customer_phone: str | None = None
    supplier_phone: str | None = None
    party_email: str | None = None
    customer_email: str | None = None
    supplier_email: str | None = None
    linked_invoice_number: str | None = None
    waybill_number: str | None = None
    waybill_valid_until: datetime | None = None
    grand_total: Decimal
    paid_amount: Decimal = Decimal("0.00")
    remaining_amount: Decimal = Decimal("0.00")
    payment_percentage: Decimal = Decimal("0.00")
    payment_status: str = "Unpaid"
    last_payment_date: datetime | None = None
    payment_count: int = 0
    source: str = "ERP"
    created_at: datetime
    updated_at: datetime


class InvoicePaymentCreate(CamelModel):
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    payment_method: str = Field(min_length=1, max_length=40)
    transaction_reference: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=2000)
    received_by: str | None = Field(default=None, max_length=160)
    status: str = "successful"
    transaction_type: str = "payment"

    @field_validator("payment_method")
    @classmethod
    def validate_method(cls, value: str) -> str:
        normalized = value.strip().lower().replace(" ", "_")
        allowed = {"cash", "upi", "card", "bank_transfer", "wallet", "cheque", "other"}
        if normalized not in allowed:
            raise ValueError(f"Payment method must be one of: {', '.join(sorted(allowed))}")
        return normalized

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"successful", "pending", "failed"}:
            raise ValueError("Status must be successful, pending, or failed")
        return normalized

    @field_validator("transaction_type")
    @classmethod
    def validate_transaction_type(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"payment", "refund", "credit_adjustment", "debit_adjustment"}:
            raise ValueError("Unsupported payment transaction type")
        return normalized


class InvoicePaymentOut(CamelModel):
    id: int
    receipt_number: str
    invoice_id: int
    customer_id: int | None = None
    outlet_id: int | None = None
    reversal_of_id: int | None = None
    amount: Decimal
    payment_method: str
    transaction_reference: str | None = None
    transaction_type: str
    status: str
    notes: str | None = None
    received_by: str | None = None
    paid_at: datetime
    reversed_at: datetime | None = None
    invoice_total_snapshot: Decimal
    previous_paid_amount: Decimal
    total_paid_after: Decimal
    remaining_after: Decimal
    payment_status_after: str
    created_at: datetime
    updated_at: datetime


class InvoicePaymentSummary(CamelModel):
    invoice_id: int
    invoice_number: str
    grand_total: Decimal
    paid_amount: Decimal
    remaining_amount: Decimal
    payment_percentage: Decimal
    payment_status: str
    invoice_status: str
    last_payment_date: datetime | None = None
    payment_count: int


class InvoicePaymentResult(CamelModel):
    payment: InvoicePaymentOut
    summary: InvoicePaymentSummary


class WaybillBase(CamelModel):
    transport_mode: str = "Unspecified"
    vehicle_number: str = ""
    from_name: str = ""
    to_name: str = ""
    valid_until: datetime
    status: str = "Active"


class WaybillUpdate(CamelModel):
    transport_mode: str | None = None
    vehicle_number: str | None = None
    from_name: str | None = None
    to_name: str | None = None
    valid_until: datetime | None = None
    status: str | None = None


class WaybillOut(WaybillBase):
    id: int
    waybill_number: str
    invoice_id: int
    invoice_number: str | None = None
    party_name: str | None = None
    invoice_direction: str | None = None
    order_id: int | None = None
    order_number: str | None = None
    order_type: str | None = None
    order_party_type: str | None = None
    order_party_name: str | None = None
    order_status: str | None = None
    order_payment_status: str | None = None
    order_date: date | None = None
    order_taxable_value: Decimal = Decimal("0")
    order_tax_value: Decimal = Decimal("0")
    order_grand_total: Decimal = Decimal("0")
    order_items: list[OrderItemOut] = Field(default_factory=list)
    generated_at: datetime
    is_expired: bool = False
    remaining_hours: int = 0


class AuditLogOut(CamelModel):
    id: int
    business_profile_id: int | None = None
    action: str
    entity_type: str
    entity_id: str
    details: str | None
    created_at: datetime


class DashboardSummary(CamelModel):
    total_revenue: Decimal
    total_profit: Decimal
    inventory_value: Decimal
    low_stock_count: int
    purchase_orders: int
    sales_orders: int
    receivables: Decimal
    payables: Decimal
    reverse_invoices: int = 0
    admin_to_outlet_invoices: int = 0
    customer_invoices: int = 0


class InventoryValueTimelinePoint(CamelModel):
    date: date
    inventory_value: Decimal
    change_value: Decimal
    inbound_value: Decimal = Decimal("0")
    outbound_value: Decimal = Decimal("0")
    movement_count: int = 0


class ApiMessage(CamelModel):
    message: str


class LoginRequest(CamelModel):
    email: str
    password: str


class LoginResponse(CamelModel):
    message: str
    role: str
    business_profile: BusinessProfileOut
    outlet: OutletOut | None = None
    access_token: str
    token_type: str = "bearer"


class SupplierReturnLineCreate(CamelModel):
    damaged_inventory_id: int
    product_id: int
    quantity: Decimal = Field(gt=0)
    reason: str | None = None


class SupplierReturnCreate(CamelModel):
    supplier_id: int
    outlet_id: int | None = None
    reason: str | None = None
    remarks: str | None = None
    lines: list[SupplierReturnLineCreate] = Field(min_length=1)


class SupplierReturnDispatch(CamelModel):
    carrier_name: str | None = None
    transport_mode: str | None = None
    tracking_number: str | None = None
    vehicle_number: str | None = None
    driver_name: str | None = None
    driver_phone: str | None = None
    remarks: str | None = None


class SupplierReturnItemOut(CamelModel):
    id: int
    damaged_inventory_id: int
    product_id: int
    product_name: str | None = None
    sku: str | None = None
    quantity_requested: Decimal
    quantity_approved: Decimal
    quantity_shipped: Decimal
    quantity_supplier_accepted: Decimal
    quantity_supplier_rejected: Decimal
    quantity_replaced: Decimal
    quantity_credited: Decimal
    unit_cost: Decimal | None = None
    reason: str | None = None
    version: int


class SupplierReturnOut(CamelModel):
    id: int
    business_profile_id: int
    supplier_id: int
    supplier_name: str | None = None
    outlet_id: int | None = None
    rtv_number: str
    status: str
    approval_status: str
    shipment_status: str
    replacement_status: str
    credit_status: str
    reason: str | None = None
    remarks: str | None = None
    version: int
    created_at: datetime
    updated_at: datetime
    notifications: dict[str, Any] = Field(default_factory=dict)
    items: list[SupplierReturnItemOut] = Field(default_factory=list)
