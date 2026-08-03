from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import JSON, BigInteger, Boolean, Date, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class BusinessProfile(Base, TimestampMixin):
    __tablename__ = "business_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(20), default="admin", nullable=False)
    access_code: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    legal_name: Mapped[str] = mapped_column(String(200), nullable=False)
    trade_name: Mapped[str] = mapped_column(String(200), nullable=False)
    logo_text: Mapped[str] = mapped_column(String(20), default="ERP")
    logo_url: Mapped[str | None] = mapped_column(String(255))
    logo_path: Mapped[str | None] = mapped_column(String(255))
    owner_name: Mapped[str] = mapped_column(String(120), nullable=False)
    mobile: Mapped[str] = mapped_column(String(30), nullable=False)
    email: Mapped[str] = mapped_column(String(150), nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    gstin: Mapped[str | None] = mapped_column(String(30))
    pan: Mapped[str | None] = mapped_column(String(20))
    cin: Mapped[str | None] = mapped_column(String(40))
    business_type: Mapped[str | None] = mapped_column(String(100))
    tax_type: Mapped[str] = mapped_column(String(50), default="Regular GST")
    currency: Mapped[str] = mapped_column(String(10), default="INR")
    financial_year: Mapped[str] = mapped_column(String(20), default="2026-2027")
    billing_address: Mapped[str | None] = mapped_column(Text)
    shipping_address: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(String(80))
    state: Mapped[str | None] = mapped_column(String(80))
    pincode: Mapped[str | None] = mapped_column(String(20))
    bank_name: Mapped[str | None] = mapped_column(String(120))
    account_number: Mapped[str | None] = mapped_column(String(60))
    ifsc: Mapped[str | None] = mapped_column(String(30))
    upi_id: Mapped[str | None] = mapped_column(String(80))

    outlets: Mapped[list["Outlet"]] = relationship(
        back_populates="business_profile", cascade="all, delete-orphan"
    )


class Outlet(Base, TimestampMixin):
    __tablename__ = "outlets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    business_profile_id: Mapped[int] = mapped_column(
        ForeignKey("business_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    outlet_code: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="outlet", nullable=False)
    access_code: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    legal_name: Mapped[str] = mapped_column(String(200), nullable=False)
    trade_name: Mapped[str] = mapped_column(String(200), nullable=False)
    logo_text: Mapped[str] = mapped_column(String(20), default="ERP")
    owner_name: Mapped[str] = mapped_column(String(120), nullable=False)
    mobile: Mapped[str] = mapped_column(String(30), nullable=False)
    email: Mapped[str] = mapped_column(String(150), nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    manager_name: Mapped[str | None] = mapped_column(String(120))
    gstin: Mapped[str | None] = mapped_column(String(30))
    pan: Mapped[str | None] = mapped_column(String(20))
    cin: Mapped[str | None] = mapped_column(String(40))
    business_type: Mapped[str | None] = mapped_column(String(100))
    tax_type: Mapped[str] = mapped_column(String(50), default="Regular GST")
    currency: Mapped[str] = mapped_column(String(10), default="INR")
    financial_year: Mapped[str] = mapped_column(String(20), default="2026-2027")
    address: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(String(80))
    state: Mapped[str | None] = mapped_column(String(80))
    pincode: Mapped[str | None] = mapped_column(String(20))
    bank_name: Mapped[str | None] = mapped_column(String(120))
    account_number: Mapped[str | None] = mapped_column(String(60))
    ifsc: Mapped[str | None] = mapped_column(String(30))
    upi_id: Mapped[str | None] = mapped_column(String(80))
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)

    business_profile: Mapped[BusinessProfile] = relationship(back_populates="outlets")
    customers: Mapped[list["Customer"]] = relationship(
        back_populates="outlet", cascade="all, delete-orphan"
    )


class Customer(Base, TimestampMixin):
    __tablename__ = "customers"
    __table_args__ = (UniqueConstraint("outlet_id", "phone", name="uq_customers_outlet_phone"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    outlet_id: Mapped[int] = mapped_column(
        ForeignKey("outlets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(180))
    email: Mapped[str | None] = mapped_column(String(150))
    address: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(String(80))
    state: Mapped[str | None] = mapped_column(String(80))
    pincode: Mapped[str | None] = mapped_column(String(20))
    total_spent: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    purchase_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    loyalty_points: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_purchase_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    last_purchase_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    outlet: Mapped[Outlet] = relationship(back_populates="customers")


class Category(Base, TimestampMixin):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Supplier(Base, TimestampMixin):
    __tablename__ = "suppliers"
    __table_args__ = (UniqueConstraint("business_profile_id", "name", name="uq_suppliers_business_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    business_profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("business_profiles.id"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(180), index=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(30), index=True)
    # Kept during the API transition for older clients and existing records.
    mobile: Mapped[str | None] = mapped_column(String(30))
    email: Mapped[str | None] = mapped_column(String(150))
    address: Mapped[str | None] = mapped_column(Text)
    gstin: Mapped[str | None] = mapped_column(String(30))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Staff(Base, TimestampMixin):
    __tablename__ = "staff"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[int] = mapped_column(ForeignKey("business_profiles.id", ondelete="CASCADE"), nullable=False)
    outlet_id: Mapped[int | None] = mapped_column(ForeignKey("outlets.id", ondelete="SET NULL"), nullable=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    employee_code: Mapped[str] = mapped_column(String(40), nullable=False, unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(180), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(30))
    email: Mapped[str | None] = mapped_column(String(150))
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id", ondelete="SET NULL"), nullable=True)
    joining_date: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UploadedFile(Base, TimestampMixin):
    __tablename__ = "uploaded_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    business_profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("business_profiles.id"), nullable=True, index=True
    )
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_url: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_type: Mapped[str] = mapped_column(String(20), nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    columns_json: Mapped[str | None] = mapped_column(Text)
    preview_json: Mapped[str | None] = mapped_column(Text)
    rows_json: Mapped[str | None] = mapped_column(Text)


class Product(Base, TimestampMixin):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("business_profile_id", "sku", name="uq_products_business_sku"),
        UniqueConstraint("business_profile_id", "barcode", name="uq_products_business_barcode"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    business_profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("business_profiles.id"), nullable=True, index=True
    )
    sku: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(180), index=True, nullable=False)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True, index=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id"), nullable=True, index=True)
    category: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    supplier: Mapped[str] = mapped_column(String(180), nullable=False)
    qty_bought: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0, nullable=False)
    qty_sold: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0, nullable=False)
    unit_type: Mapped[str] = mapped_column(String(40), default="pieces", nullable=False)
    unit_label: Mapped[str] = mapped_column(String(60), default="Pieces", nullable=False)
    package_size: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    package_size_unit: Mapped[str | None] = mapped_column(String(40))
    package_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    quantity_options: Mapped[str | None] = mapped_column(Text)
    barcode: Mapped[str | None] = mapped_column(String(80), index=True)
    stock_cached: Mapped[Decimal] = mapped_column(Numeric(14, 3), default=0, nullable=False)
    mrp: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    buy_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    sell_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    gst_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=18, nullable=False)
    reorder_level: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    order_items: Mapped[list["OrderItem"]] = relationship(back_populates="product")
    quantities: Mapped[list["ProductQuantity"]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
    )
    discounts: Mapped[list["ProductDiscount"]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
    )
    qualities: Mapped[list["ProductQuality"]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
    )
    price_history: Mapped[list["ProductPrice"]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
    )
    ledger_entries: Mapped[list["InventoryLedger"]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
    )


class InventoryLedger(Base, TimestampMixin):
    __tablename__ = "inventory_ledger"
    TYPES = (
        "PURCHASE",
        "SALE",
        "RETURN",
        "DAMAGE",
        "ADJUSTMENT",
        "SUPPLIER_RETURN",
        "SUPPLIER_REPLACEMENT",
        "SUPPLIER_REJECT",
        "SUPPLIER_CREDIT",
        "SCRAP",
        "REPAIR",
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    business_profile_id: Mapped[int | None] = mapped_column(ForeignKey("business_profiles.id"), nullable=True, index=True)
    outlet_id: Mapped[int | None] = mapped_column(ForeignKey("outlets.id"), nullable=True, index=True)
    type: Mapped[str] = mapped_column(
        Enum(
            *TYPES,
            name="inventory_ledger_type",
            native_enum=True,
            create_constraint=False,
            create_type=False,
        ),
        nullable=False,
        index=True,
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(Text, unique=True, nullable=True)
    user_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    source: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    reference_type: Mapped[str | None] = mapped_column(String(40), index=True)
    reference_id: Mapped[str | None] = mapped_column(String(80), index=True)

    product: Mapped[Product] = relationship(back_populates="ledger_entries")


class ProductQuantity(Base, TimestampMixin):
    __tablename__ = "product_quantities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    business_profile_id: Mapped[int | None] = mapped_column(ForeignKey("business_profiles.id"), nullable=True, index=True)
    transaction_type: Mapped[str] = mapped_column(String(40), default="adjustment", nullable=False)
    quantity_change: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    old_stock: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    new_stock: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    sold_stock: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    effective_date: Mapped[date] = mapped_column(Date, server_default=func.current_date(), nullable=False)
    remaining_quantity: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    reference_order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True, index=True)
    note: Mapped[str | None] = mapped_column(Text)

    product: Mapped[Product] = relationship(back_populates="quantities")


class ProductQuality(Base, TimestampMixin):
    __tablename__ = "product_qualities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    business_profile_id: Mapped[int | None] = mapped_column(ForeignKey("business_profiles.id"), nullable=True, index=True)
    quality_status: Mapped[str] = mapped_column(String(60), default="new", nullable=False)
    transaction_type: Mapped[str] = mapped_column(String(40), default="quality_adjustment", nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    effective_date: Mapped[date] = mapped_column(Date, server_default=func.current_date(), nullable=False)
    note: Mapped[str | None] = mapped_column(Text)

    product: Mapped[Product] = relationship(back_populates="qualities")


class ProductPrice(Base, TimestampMixin):
    __tablename__ = "product_prices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    business_profile_id: Mapped[int | None] = mapped_column(ForeignKey("business_profiles.id"), nullable=True, index=True)
    effective_date: Mapped[date] = mapped_column(Date, server_default=func.current_date(), nullable=False)
    mrp: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    buy_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    sell_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    source: Mapped[str] = mapped_column(String(80), default="manual", nullable=False)
    note: Mapped[str | None] = mapped_column(Text)

    product: Mapped[Product] = relationship(back_populates="price_history")


class ProductDiscount(Base, TimestampMixin):
    __tablename__ = "product_discounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True)
    business_profile_id: Mapped[int | None] = mapped_column(ForeignKey("business_profiles.id"), nullable=True, index=True)
    discount_type: Mapped[str] = mapped_column(String(40), default="percentage", nullable=False)
    discount_value: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    min_quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0, nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    product: Mapped[Product] = relationship(back_populates="discounts")


class Return(Base, TimestampMixin):
    __tablename__ = "returns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[int | None] = mapped_column(ForeignKey("business_profiles.id"), nullable=True, index=True)
    return_number: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    original_invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), nullable=False)
    reversal_invoice_id: Mapped[int | None] = mapped_column(ForeignKey("invoices.id"), nullable=True)
    outlet_id: Mapped[int | None] = mapped_column(ForeignKey("outlets.id"), nullable=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True)
    staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"), nullable=True)
    return_date: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    resolution: Mapped[str] = mapped_column(String(20), default="refund", nullable=False)
    refund_method: Mapped[str | None] = mapped_column(String(30))
    refund_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    refund_status: Mapped[str] = mapped_column(String(30), default="pending", nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="submitted", nullable=False, index=True)
    remarks: Mapped[str | None] = mapped_column(Text)


class ReturnItem(Base, TimestampMixin):
    __tablename__ = "return_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    return_id: Mapped[int] = mapped_column(ForeignKey("returns.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    order_item_id: Mapped[int | None] = mapped_column(ForeignKey("order_items.id"), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    discount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    gst_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0, nullable=False)
    line_refund: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    damage_type: Mapped[str | None] = mapped_column(String(40))
    remarks: Mapped[str | None] = mapped_column(Text)


class DamagedInventory(Base, TimestampMixin):
    __tablename__ = "damaged_inventory"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[int | None] = mapped_column(ForeignKey("business_profiles.id"), nullable=True, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    outlet_id: Mapped[int | None] = mapped_column(ForeignKey("outlets.id"), nullable=True)
    return_id: Mapped[int | None] = mapped_column(ForeignKey("returns.id"), nullable=True)
    return_item_id: Mapped[int | None] = mapped_column(ForeignKey("return_items.id"), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    damage_type: Mapped[str | None] = mapped_column(String(40))
    disposition: Mapped[str] = mapped_column(String(30), default="quarantined", nullable=False)
    recorded_by: Mapped[int | None] = mapped_column(ForeignKey("staff.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text)
    available_quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0, nullable=False)
    inspected_quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0, nullable=False)
    returned_to_supplier_quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0, nullable=False)
    inspection_status: Mapped[str] = mapped_column(String(60), default="pending", nullable=False)
    current_workflow_status_id: Mapped[int | None] = mapped_column(ForeignKey("workflow_statuses.id"), nullable=True)
    lot_number: Mapped[str | None] = mapped_column(String(80))
    expiry_date: Mapped[date | None] = mapped_column(Date)
    purchase_reference_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    updated_by_staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"), nullable=True)
    photos: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class Order(Base, TimestampMixin):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    business_profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("business_profiles.id"), nullable=True, index=True
    )
    order_number: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    type: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    party_type: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    party_name: Mapped[str] = mapped_column(String(180), index=True, nullable=False)
    outlet_id: Mapped[int | None] = mapped_column(ForeignKey("outlets.id"), nullable=True, index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True, index=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(60), index=True, default="Draft", nullable=False)
    date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    payment_status: Mapped[str] = mapped_column(String(60), index=True, default="Unpaid", nullable=False)
    inventory_applied: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    payment_auto_delivered: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )
    invoices: Mapped[list["Invoice"]] = relationship(back_populates="order")
    customer: Mapped[Customer | None] = relationship()
    supplier: Mapped[Supplier | None] = relationship()


class OrderItem(Base, TimestampMixin):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    unit_type: Mapped[str] = mapped_column(String(40), default="pieces", nullable=False)
    unit_label: Mapped[str] = mapped_column(String(60), default="Pieces", nullable=False)
    package_count: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    package_size: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    package_size_unit: Mapped[str | None] = mapped_column(String(40))
    rate: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    gst_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)

    order: Mapped[Order] = relationship(back_populates="items")
    product: Mapped[Product] = relationship(back_populates="order_items")


class Invoice(Base, TimestampMixin):
    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    business_profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("business_profiles.id"), nullable=True, index=True
    )
    invoice_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    invoice_type: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    invoice_direction: Mapped[str] = mapped_column(
        String(40), index=True, default="outlet_to_customer", nullable=False
    )
    linked_invoice_id: Mapped[int | None] = mapped_column(ForeignKey("invoices.id"), nullable=True, index=True)
    outlet_id: Mapped[int | None] = mapped_column(ForeignKey("outlets.id"), nullable=True, index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), nullable=True, index=True)
    is_reverse: Mapped[bool] = mapped_column(default=False, nullable=False)
    party_type: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    party_name: Mapped[str] = mapped_column(String(180), index=True, nullable=False)
    date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    taxable_value: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    cgst: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    sgst: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    igst: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(60), index=True, default="Unpaid", nullable=False)
    paid_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    remaining_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    payment_percentage: Mapped[Decimal] = mapped_column(Numeric(7, 2), default=0, nullable=False)
    payment_status: Mapped[str] = mapped_column(String(30), index=True, default="Unpaid", nullable=False)
    last_payment_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    order: Mapped[Order | None] = relationship(back_populates="invoices")
    linked_invoice: Mapped["Invoice | None"] = relationship(
        remote_side="Invoice.id",
        back_populates="linked_invoices",
    )
    linked_invoices: Mapped[list["Invoice"]] = relationship(back_populates="linked_invoice")
    waybill: Mapped["Waybill | None"] = relationship(
        back_populates="invoice",
        cascade="all, delete-orphan",
        passive_deletes=True,
        uselist=False,
    )
    payments: Mapped[list["InvoicePayment"]] = relationship(
        back_populates="invoice",
        order_by="InvoicePayment.created_at",
    )


class InvoicePayment(Base, TimestampMixin):
    """Append-only invoice payment ledger entry.

    Reversals are represented by a new row and a status change on the original;
    successful payment rows are never deleted or overwritten.
    """

    __tablename__ = "invoice_payments"
    __table_args__ = (
        UniqueConstraint("business_profile_id", "receipt_number", name="uq_invoice_payment_receipt_tenant"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    receipt_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), index=True, nullable=False)
    business_profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("business_profiles.id"), index=True, nullable=True
    )
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"), index=True, nullable=True)
    outlet_id: Mapped[int | None] = mapped_column(ForeignKey("outlets.id"), index=True, nullable=True)
    reversal_of_id: Mapped[int | None] = mapped_column(
        ForeignKey("invoice_payments.id"), unique=True, index=True, nullable=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(40), nullable=False)
    transaction_reference: Mapped[str | None] = mapped_column(String(120), index=True)
    transaction_type: Mapped[str] = mapped_column(String(30), default="payment", nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="successful", index=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    received_by: Mapped[str | None] = mapped_column(String(160))
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    invoice_total_snapshot: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    previous_paid_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    total_paid_after: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    remaining_after: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    payment_status_after: Mapped[str] = mapped_column(String(30), nullable=False)

    invoice: Mapped[Invoice] = relationship(back_populates="payments", foreign_keys=[invoice_id])
    reversal_of: Mapped["InvoicePayment | None"] = relationship(
        remote_side="InvoicePayment.id",
        foreign_keys=[reversal_of_id],
    )


class Waybill(Base, TimestampMixin):
    __tablename__ = "waybills"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    waybill_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    valid_until: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="Active", nullable=False)
    transport_mode: Mapped[str] = mapped_column(String(40), default="Unspecified", nullable=False)
    vehicle_number: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    from_name: Mapped[str] = mapped_column(String(180), default="", nullable=False)
    to_name: Mapped[str] = mapped_column(String(180), default="", nullable=False)

    invoice: Mapped[Invoice] = relationship(back_populates="waybill")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    business_profile_id: Mapped[int | None] = mapped_column(ForeignKey("business_profiles.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    entity_type: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    entity_id: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    details: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    key: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    endpoint: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_body: Mapped[dict | list | None] = mapped_column(JSON)
    status_code: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class DocumentSequence(Base, TimestampMixin):
    __tablename__ = "document_sequences"

    family: Mapped[str] = mapped_column(String(40), primary_key=True)
    next_value: Mapped[int] = mapped_column(BigInteger, default=1, nullable=False)


class WorkflowStatus(Base, TimestampMixin):
    __tablename__ = "workflow_statuses"
    __table_args__ = (
        UniqueConstraint("business_profile_id", "module", "code", name="uq_workflow_statuses_business_module_code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("business_profiles.id", ondelete="CASCADE"), nullable=True, index=True
    )
    module: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(80), nullable=False)
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_initial: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_terminal: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allowed_next: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)


class ApprovalLevel(Base, TimestampMixin):
    __tablename__ = "approval_levels"
    __table_args__ = (
        UniqueConstraint("business_profile_id", "module", "level_order", name="uq_approval_levels_business_module_order"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("business_profiles.id", ondelete="CASCADE"), nullable=True, index=True
    )
    module: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    workflow_status_id: Mapped[int | None] = mapped_column(ForeignKey("workflow_statuses.id"), nullable=True)
    level_order: Mapped[int] = mapped_column(Integer, nullable=False)
    role_code: Mapped[str] = mapped_column(String(80), nullable=False)
    approver_staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"), nullable=True)
    required_approvals: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)


class DamageCategory(Base, TimestampMixin):
    __tablename__ = "damage_categories"
    __table_args__ = (
        UniqueConstraint("business_profile_id", "code", name="uq_damage_categories_business_code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("business_profiles.id", ondelete="CASCADE"), nullable=True, index=True
    )
    code: Mapped[str] = mapped_column(String(80), nullable=False)
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    default_decision: Mapped[str] = mapped_column(String(80), nullable=False)
    requires_supplier_return: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)


class InspectionReport(Base, TimestampMixin):
    __tablename__ = "inspection_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[int | None] = mapped_column(
        ForeignKey("business_profiles.id", ondelete="CASCADE"), nullable=True, index=True
    )
    damaged_inventory_id: Mapped[int] = mapped_column(ForeignKey("damaged_inventory.id"), nullable=False, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    return_id: Mapped[int | None] = mapped_column(ForeignKey("returns.id"), nullable=True)
    return_item_id: Mapped[int | None] = mapped_column(ForeignKey("return_items.id"), nullable=True)
    inspected_by_staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"), nullable=True)
    inspected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    inspected_quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    outcome: Mapped[str] = mapped_column(String(80), nullable=False)
    decision: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    reason: Mapped[str | None] = mapped_column(Text)
    remarks: Mapped[str | None] = mapped_column(Text)
    photos: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)


class SupplierReturn(Base, TimestampMixin):
    __tablename__ = "supplier_returns"
    __table_args__ = (
        UniqueConstraint("business_profile_id", "rtv_number", name="uq_supplier_returns_business_rtv_number"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[int] = mapped_column(
        ForeignKey("business_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), nullable=False, index=True)
    outlet_id: Mapped[int | None] = mapped_column(ForeignKey("outlets.id"), nullable=True, index=True)
    rtv_number: Mapped[str] = mapped_column(String(60), nullable=False)
    purchase_order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    purchase_invoice_id: Mapped[int | None] = mapped_column(ForeignKey("invoices.id"), nullable=True)
    current_status_id: Mapped[int | None] = mapped_column(ForeignKey("workflow_statuses.id"), nullable=True, index=True)
    approval_status: Mapped[str] = mapped_column(String(40), default="pending", nullable=False)
    shipment_status: Mapped[str] = mapped_column(String(40), default="not_ready", nullable=False)
    replacement_status: Mapped[str] = mapped_column(String(40), default="not_expected", nullable=False)
    credit_status: Mapped[str] = mapped_column(String(40), default="not_expected", nullable=False)
    created_by_staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reason: Mapped[str | None] = mapped_column(Text)
    remarks: Mapped[str | None] = mapped_column(Text)
    supplier_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    document_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)

    supplier: Mapped[Supplier] = relationship()
    current_status: Mapped[WorkflowStatus | None] = relationship()
    items: Mapped[list["SupplierReturnItem"]] = relationship(back_populates="supplier_return", cascade="all, delete-orphan")


class SupplierReturnItem(Base, TimestampMixin):
    __tablename__ = "supplier_return_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_return_id: Mapped[int] = mapped_column(
        ForeignKey("supplier_returns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    business_profile_id: Mapped[int] = mapped_column(
        ForeignKey("business_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    damaged_inventory_id: Mapped[int] = mapped_column(ForeignKey("damaged_inventory.id"), nullable=False, index=True)
    inspection_report_id: Mapped[int | None] = mapped_column(ForeignKey("inspection_reports.id"), nullable=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    return_id: Mapped[int | None] = mapped_column(ForeignKey("returns.id"), nullable=True)
    return_item_id: Mapped[int | None] = mapped_column(ForeignKey("return_items.id"), nullable=True)
    current_status_id: Mapped[int | None] = mapped_column(ForeignKey("workflow_statuses.id"), nullable=True, index=True)
    quantity_requested: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    quantity_approved: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0, nullable=False)
    quantity_shipped: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0, nullable=False)
    quantity_supplier_received: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0, nullable=False)
    quantity_supplier_accepted: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0, nullable=False)
    quantity_supplier_rejected: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0, nullable=False)
    quantity_replaced: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0, nullable=False)
    quantity_credited: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0, nullable=False)
    quantity_refunded: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0, nullable=False)
    unit_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    reason: Mapped[str | None] = mapped_column(Text)
    remarks: Mapped[str | None] = mapped_column(Text)
    product_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    source_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)

    supplier_return: Mapped[SupplierReturn] = relationship(back_populates="items")
    product: Mapped[Product] = relationship()
    current_status: Mapped[WorkflowStatus | None] = relationship()


class SupplierReturnStatusHistory(Base):
    __tablename__ = "supplier_return_status_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_return_id: Mapped[int] = mapped_column(
        ForeignKey("supplier_returns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    supplier_return_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("supplier_return_items.id", ondelete="CASCADE"), nullable=True, index=True
    )
    old_status_id: Mapped[int | None] = mapped_column(ForeignKey("workflow_statuses.id"), nullable=True)
    new_status_id: Mapped[int | None] = mapped_column(ForeignKey("workflow_statuses.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    changed_by_staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)


class SupplierReturnApprovalHistory(Base):
    __tablename__ = "supplier_return_approval_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_return_id: Mapped[int] = mapped_column(
        ForeignKey("supplier_returns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    supplier_return_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("supplier_return_items.id", ondelete="CASCADE"), nullable=True, index=True
    )
    approval_level_id: Mapped[int | None] = mapped_column(ForeignKey("approval_levels.id"), nullable=True, index=True)
    approver_staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"), nullable=True)
    decision: Mapped[str] = mapped_column(String(40), nullable=False)
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)


class SupplierReturnShipment(Base, TimestampMixin):
    __tablename__ = "supplier_return_shipments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_return_id: Mapped[int] = mapped_column(
        ForeignKey("supplier_returns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    carrier_name: Mapped[str | None] = mapped_column(String(160))
    transport_mode: Mapped[str | None] = mapped_column(String(80))
    tracking_number: Mapped[str | None] = mapped_column(String(120), index=True)
    vehicle_number: Mapped[str | None] = mapped_column(String(80))
    driver_name: Mapped[str | None] = mapped_column(String(120))
    driver_phone: Mapped[str | None] = mapped_column(String(40))
    shipment_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expected_delivery_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    actual_delivery_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(60), default="draft", nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)


class SupplierReturnDocument(Base, TimestampMixin):
    __tablename__ = "supplier_return_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_return_id: Mapped[int] = mapped_column(
        ForeignKey("supplier_returns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    supplier_return_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("supplier_return_items.id", ondelete="CASCADE"), nullable=True, index=True
    )
    document_type: Mapped[str] = mapped_column(String(80), nullable=False)
    document_number: Mapped[str | None] = mapped_column(String(120))
    file_url: Mapped[str | None] = mapped_column(String(500))
    file_path: Mapped[str | None] = mapped_column(String(500))
    uploaded_by_staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"), nullable=True)
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)


class SupplierReturnResponse(Base, TimestampMixin):
    __tablename__ = "supplier_return_responses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_return_id: Mapped[int] = mapped_column(
        ForeignKey("supplier_returns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    supplier_return_item_id: Mapped[int] = mapped_column(
        ForeignKey("supplier_return_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    response_type: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    supplier_reference: Mapped[str | None] = mapped_column(String(120))
    responded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    recorded_by_staff_id: Mapped[int | None] = mapped_column(ForeignKey("staff.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)


class SupplierReturnReplacement(Base, TimestampMixin):
    __tablename__ = "supplier_return_replacements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_return_id: Mapped[int] = mapped_column(
        ForeignKey("supplier_returns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    supplier_return_item_id: Mapped[int] = mapped_column(
        ForeignKey("supplier_return_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    replacement_product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    invoice_id: Mapped[int | None] = mapped_column(ForeignKey("invoices.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)


class SupplierReturnCreditNote(Base, TimestampMixin):
    __tablename__ = "supplier_return_credit_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_return_id: Mapped[int] = mapped_column(
        ForeignKey("supplier_returns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    supplier_return_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("supplier_return_items.id", ondelete="CASCADE"), nullable=True, index=True
    )
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), nullable=False, index=True)
    credit_note_number: Mapped[str] = mapped_column(String(120), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(40), default="pending", nullable=False)
    invoice_id: Mapped[int | None] = mapped_column(ForeignKey("invoices.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)


class DomainEventRecord(Base):
    __tablename__ = "domain_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_id: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    aggregate_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    aggregate_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    business_profile_id: Mapped[int | None] = mapped_column(ForeignKey("business_profiles.id"), nullable=True, index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class NotificationOutbox(Base, TimestampMixin):
    __tablename__ = "notification_outbox"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_notification_outbox_idempotency_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    parent_outbox_id: Mapped[int | None] = mapped_column(
        ForeignKey("notification_outbox.id", ondelete="SET NULL"), nullable=True, index=True
    )
    idempotency_key: Mapped[str] = mapped_column(String(180), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    aggregate_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    aggregate_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    business_profile_id: Mapped[int | None] = mapped_column(ForeignKey("business_profiles.id"), nullable=True, index=True)
    channel: Mapped[str] = mapped_column(String(20), default="event", nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="queued", nullable=False, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    last_error: Mapped[str | None] = mapped_column(Text)
    provider_response: Mapped[dict | None] = mapped_column(JSON)
    dead_lettered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lock_owner: Mapped[str | None] = mapped_column(String(120))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NotificationHistory(Base):
    __tablename__ = "notification_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    outbox_id: Mapped[int | None] = mapped_column(
        ForeignKey("notification_outbox.id", ondelete="SET NULL"), nullable=True, index=True
    )
    business_profile_id: Mapped[int | None] = mapped_column(ForeignKey("business_profiles.id"), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    aggregate_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    aggregate_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    channel: Mapped[str] = mapped_column(String(20), default="event", nullable=False, index=True)
    provider: Mapped[str | None] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    attempt: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    correlation_id: Mapped[str | None] = mapped_column(String(120), index=True)
    message_id: Mapped[str | None] = mapped_column(String(120), index=True)
    request_payload: Mapped[dict | None] = mapped_column(JSON)
    channel_summary: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    provider_response: Mapped[dict | None] = mapped_column(JSON)
    error_message: Mapped[str | None] = mapped_column(Text)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
