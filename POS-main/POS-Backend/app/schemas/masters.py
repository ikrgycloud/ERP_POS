"""Request/response schemas for master-data resources."""
from datetime import date, datetime
from decimal import Decimal
import re
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, computed_field, field_validator

from app.core.roles import Role
from app.schemas.common import ORMModel


# ----------------------------- Staff -----------------------------
class StaffCreate(BaseModel):
    role: Role
    employee_code: str = Field(min_length=1, max_length=40)
    full_name: str = Field(min_length=2, max_length=80)
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    password: str = Field(min_length=8, max_length=64)
    outlet_id: Optional[int] = None
    joining_date: Optional[date] = None

    @field_validator("employee_code", mode="before")
    @classmethod
    def normalize_employee_code(cls, value):
        if isinstance(value, str):
            return value.strip().upper()
        return value

    @field_validator("employee_code")
    @classmethod
    def validate_employee_code(cls, value):
        if not re.fullmatch(r"[A-Z0-9_-]{2,40}", value):
            raise ValueError("Employee code may contain only letters, numbers, underscore, or hyphen")
        return value

    @field_validator("full_name", mode="before")
    @classmethod
    def normalize_full_name(cls, value):
        if isinstance(value, str):
            return " ".join(value.strip().split())
        return value

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value):
        if not value or not value.strip():
            raise ValueError("Employee name is required")
        return value

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone(cls, value):
        if value is None:
            return value
        if isinstance(value, str):
            value = value.strip()
            if value.startswith("+91"):
                value = value[3:]
            return value
        return value

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value):
        if value in (None, ""):
            return None
        if not re.fullmatch(r"[6-9]\d{9}", value):
            raise ValueError("Enter a valid 10 digit Indian mobile number")
        if len(set(value)) == 1 or value == "1234567890":
            raise ValueError("Enter a valid 10 digit Indian mobile number")
        return value

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value):
        if isinstance(value, str):
            value = value.strip().lower()
            return value or None
        return value

    @field_validator("password")
    @classmethod
    def validate_password(cls, value):
        checks = [
            re.search(r"[A-Z]", value),
            re.search(r"[a-z]", value),
            re.search(r"\d", value),
            re.search(r"[^A-Za-z0-9]", value),
        ]
        if not all(checks):
            raise ValueError("Password must include uppercase, lowercase, number, and special character")
        return value


class StaffUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    outlet_id: Optional[int] = None


class StaffOut(ORMModel):
    id: int
    role: str
    employee_code: str
    full_name: str
    phone: Optional[str]
    email: Optional[str]
    outlet_id: Optional[int]
    manager_id: Optional[int]
    joining_date: Optional[date]
    is_active: bool
    created_at: datetime

    @computed_field
    @property
    def phone_number(self) -> Optional[str]:
        return self.phone

    @computed_field
    @property
    def active(self) -> bool:
        return self.is_active

    @computed_field
    @property
    def status(self) -> str:
        return "active" if self.is_active else "inactive"


class StaffStatusUpdate(BaseModel):
    is_active: bool


class StaffPasswordReset(BaseModel):
    new_password: str = Field(min_length=8, max_length=64)

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value):
        return StaffCreate.validate_password(value)


class StaffReport(BaseModel):
    staff_id: int
    full_name: str
    invoice_count: int
    revenue: Decimal


# --------------------------- Category ---------------------------
class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = None


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class CategoryOut(ORMModel):
    id: int
    name: str
    description: Optional[str]
    is_active: bool


# --------------------------- Supplier ---------------------------
class SupplierCreate(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    mobile: Optional[str] = None
    email: Optional[EmailStr] = None
    address: Optional[str] = None
    gstin: Optional[str] = None


class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[EmailStr] = None
    address: Optional[str] = None
    gstin: Optional[str] = None
    is_active: Optional[bool] = None


class SupplierOut(ORMModel):
    id: int
    name: str
    mobile: Optional[str]
    email: Optional[str]
    address: Optional[str]
    gstin: Optional[str]
    is_active: bool


# --------------------------- Product ----------------------------
class ProductCreate(BaseModel):
    sku: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=180)
    category: str = Field(min_length=1, max_length=100)
    supplier: str = Field(min_length=1, max_length=180)
    category_id: Optional[int] = None
    supplier_id: Optional[int] = None
    barcode: Optional[str] = None
    mrp: Decimal = Field(gt=0)
    buy_price: Decimal = Field(ge=0)
    sell_price: Decimal = Field(gt=0)
    gst_rate: Decimal = Field(default=Decimal("18"), ge=0, le=100)
    qty_bought: Decimal = Field(default=Decimal("0"), ge=0)
    reorder_level: Decimal = Field(default=Decimal("0"), ge=0)
    unit_type: str = "pieces"
    unit_label: str = "Pieces"


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    supplier: Optional[str] = None
    category_id: Optional[int] = None
    supplier_id: Optional[int] = None
    barcode: Optional[str] = None
    mrp: Optional[Decimal] = None
    buy_price: Optional[Decimal] = None
    sell_price: Optional[Decimal] = None
    gst_rate: Optional[Decimal] = None
    reorder_level: Optional[Decimal] = None
    is_active: Optional[bool] = None


class ProductOut(ORMModel):
    id: int
    sku: str
    name: str
    barcode: Optional[str]
    category: str
    supplier: str
    mrp: Decimal
    sell_price: Decimal
    gst_rate: Decimal
    qty_bought: Decimal
    qty_sold: Decimal
    qty_returned: Decimal = Decimal("0")
    stock_cached: Decimal = Decimal("0")
    damaged_qty: Decimal
    returned_damaged_qty: Decimal = Decimal("0")
    expired_qty: Decimal = Decimal("0")
    quarantine_qty: Decimal = Decimal("0")
    reserved_qty: Decimal = Decimal("0")
    reorder_level: Decimal
    is_active: bool


class ScanResult(BaseModel):
    """Billing Step 3 — what the counter sees after a scan."""
    product_id: int
    product_name: str
    quantity: Decimal = Decimal("1")
    current_stock: Decimal
    price: Decimal
    discount_pct: Decimal
    gst_rate: Decimal
    total: Decimal


# --------------------------- Customer ---------------------------
class CustomerCreate(BaseModel):
    phone: str = Field(min_length=10, max_length=10)
    name: str = Field(min_length=2, max_length=50)
    email: Optional[EmailStr] = None
    address: Optional[str] = None

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone(cls, value):
        if isinstance(value, str):
            value = "".join(ch for ch in value if ch.isdigit())
        return value

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value):
        if not value.isdigit() or len(value) != 10:
            raise ValueError("Enter valid 10 digit mobile number")
        return value

    @field_validator("name", mode="before")
    @classmethod
    def normalize_name(cls, value):
        if isinstance(value, str):
            value = " ".join(value.strip().split())
        return value

    @field_validator("name")
    @classmethod
    def validate_name(cls, value):
        if not value.replace(" ", "").isalpha():
            raise ValueError("Customer name may contain only letters and spaces")
        return value

    @field_validator("email", "address", mode="before")
    @classmethod
    def blank_to_none(cls, value):
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value

class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    address: Optional[str] = None


class CustomerOut(ORMModel):
    id: int
    outlet_id: int
    phone: Optional[str]
    name: Optional[str]
    email: Optional[str]
    total_spent: Decimal
    purchase_count: int
    loyalty_points: int


# --------------------------- Discount ---------------------------
class DiscountCreate(BaseModel):
    discount_type: str = "percentage"
    discount_value: Decimal = Field(ge=0)
    min_quantity: Decimal = Field(default=Decimal("0"), ge=0)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    description: Optional[str] = None


class DiscountOut(ORMModel):
    id: int
    product_id: int
    discount_type: str
    discount_value: Decimal
    min_quantity: Decimal
    is_active: bool


# ----------------------- Stock adjustment -----------------------
class StockAdjustment(BaseModel):
    quantity_change: Decimal
    transaction_type: str = Field(default="adjustment", min_length=1, max_length=40)
    note: Optional[str] = None


class ProductQuantityOut(ORMModel):
    id: int
    product_id: int
    transaction_type: str
    quantity_change: Decimal
    remaining_quantity: Optional[Decimal]
    note: Optional[str]
    created_at: datetime
