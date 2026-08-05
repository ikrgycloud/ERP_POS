"""ORM models — catalog & inventory."""
from datetime import date
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    Enum,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base, TimestampMixin


class Category(Base, TimestampMixin):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    description: Mapped[Optional[str]] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Supplier(Base, TimestampMixin):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("business_profiles.id")
    )
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    mobile: Mapped[Optional[str]] = mapped_column(String(30))
    email: Mapped[Optional[str]] = mapped_column(String(150))
    address: Mapped[Optional[str]] = mapped_column(Text)
    gstin: Mapped[Optional[str]] = mapped_column(String(30))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Product(Base, TimestampMixin):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("business_profile_id", "sku", name="uq_products_business_sku"),
        UniqueConstraint("business_profile_id", "barcode", name="uq_products_business_barcode"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("business_profiles.id")
    )
    sku: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    category_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categories.id"))
    supplier_id: Mapped[Optional[int]] = mapped_column(ForeignKey("suppliers.id"))
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    supplier: Mapped[str] = mapped_column(String(180), nullable=False)
    qty_bought: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    qty_sold: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    unit_type: Mapped[str] = mapped_column(String(40), nullable=False, default="pieces")
    unit_label: Mapped[str] = mapped_column(String(60), nullable=False, default="Pieces")
    package_size: Mapped[Optional[float]] = mapped_column(Numeric(12, 3))
    package_size_unit: Mapped[Optional[str]] = mapped_column(String(40))
    package_price: Mapped[Optional[float]] = mapped_column(Numeric(12, 2))
    quantity_options: Mapped[Optional[str]] = mapped_column(Text)
    mrp: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    buy_price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    sell_price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    stock_cached: Mapped[float] = mapped_column(Numeric(14, 3), nullable=False, default=0)
    gst_rate: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=18)
    reorder_level: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # POS extension columns
    barcode: Mapped[Optional[str]] = mapped_column(String(80), index=True)
    # Units damaged while still in the shop's sellable stock (breakage,
    # expiry on shelf). These were never sold, so they reduce sellable stock.
    damaged_qty: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    expired_qty: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    quarantine_qty: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    reserved_qty: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    qty_returned: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    # Units a customer returned damaged. These already left sellable stock via
    # qty_sold, so they must NOT be subtracted again -- they are tracked only
    # for damage/inventory-loss reporting.
    returned_damaged_qty: Mapped[float] = mapped_column(
        Numeric(12, 3), nullable=False, default=0
    )

    @property
    def stock_on_hand(self) -> float:
        """Units currently sellable on the shelf.

        Returned-damaged units are excluded from this sum: they were already
        removed when sold, and they never re-enter sellable stock.
        """
        return float(self.stock_cached)

    @property
    def total_damaged(self) -> float:
        """All damaged units, whichever side of the counter they broke on."""
        return float(self.damaged_qty) + float(self.returned_damaged_qty)


class InventoryLedger(Base, TimestampMixin):
    __tablename__ = "inventory_ledger"
    TYPES = (
        "PURCHASE",
        "SALE",
        "RETURN",
        "DAMAGE",
        "EXPIRED",
        "QUARANTINE",
        "ADJUSTMENT",
        "SUPPLIER_RETURN",
        "SUPPLIER_REPLACEMENT",
        "SUPPLIER_REJECT",
        "SUPPLIER_CREDIT",
        "SCRAP",
        "REPAIR",
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    business_profile_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("business_profiles.id"), index=True
    )
    outlet_id: Mapped[Optional[int]] = mapped_column(ForeignKey("outlets.id"), index=True)
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
    quantity: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False)
    old_stock: Mapped[Optional[float]] = mapped_column(Numeric(14, 3))
    new_stock: Mapped[Optional[float]] = mapped_column(Numeric(14, 3))
    idempotency_key: Mapped[Optional[str]] = mapped_column(Text, unique=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(80), index=True)
    source: Mapped[Optional[str]] = mapped_column(String(40), index=True)
    reason: Mapped[Optional[str]] = mapped_column(String(80), index=True)
    reference_type: Mapped[Optional[str]] = mapped_column(String(40), index=True)
    reference_id: Mapped[Optional[str]] = mapped_column(String(80), index=True)


class IdempotencyKey(Base, TimestampMixin):
    __tablename__ = "idempotency_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    endpoint: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_body: Mapped[Optional[dict]] = mapped_column(JSON)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ProductQuantity(Base, TimestampMixin):
    __tablename__ = "product_quantities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    business_profile_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("business_profiles.id")
    )
    transaction_type: Mapped[str] = mapped_column(
        String(40), nullable=False, default="adjustment"
    )
    quantity_change: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False)
    remaining_quantity: Mapped[Optional[float]] = mapped_column(Numeric(12, 3))
    reference_order_id: Mapped[Optional[int]] = mapped_column(ForeignKey("orders.id"))
    note: Mapped[Optional[str]] = mapped_column(Text)


class ProductDiscount(Base, TimestampMixin):
    __tablename__ = "product_discounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    business_profile_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("business_profiles.id")
    )
    discount_type: Mapped[str] = mapped_column(
        String(40), nullable=False, default="percentage"
    )
    discount_value: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    min_quantity: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False, default=0)
    start_date: Mapped[Optional[date]] = mapped_column(Date)
    end_date: Mapped[Optional[date]] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    description: Mapped[Optional[str]] = mapped_column(Text)


class DamagedInventory(Base, TimestampMixin):
    __tablename__ = "damaged_inventory"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("business_profiles.id")
    )
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    outlet_id: Mapped[Optional[int]] = mapped_column(ForeignKey("outlets.id"))
    return_id: Mapped[Optional[int]] = mapped_column(ForeignKey("returns.id"))
    return_item_id: Mapped[Optional[int]] = mapped_column(ForeignKey("return_items.id"))
    quantity: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False)
    damage_type: Mapped[Optional[str]] = mapped_column(String(40))
    disposition: Mapped[str] = mapped_column(
        String(30), nullable=False, default="quarantined"
    )
    recorded_by: Mapped[Optional[int]] = mapped_column(ForeignKey("staff.id"))
    remarks: Mapped[Optional[str]] = mapped_column(Text)
