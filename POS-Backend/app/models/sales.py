"""ORM models — sales, invoicing, returns."""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    event,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base, TimestampMixin


class Customer(Base, TimestampMixin):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    outlet_id: Mapped[int] = mapped_column(
        ForeignKey("outlets.id", ondelete="CASCADE"), nullable=False
    )
    phone: Mapped[Optional[str]] = mapped_column(String(30), index=True)
    name: Mapped[Optional[str]] = mapped_column(String(180))
    email: Mapped[Optional[str]] = mapped_column(String(150))
    address: Mapped[Optional[str]] = mapped_column(Text)
    city: Mapped[Optional[str]] = mapped_column(String(80))
    state: Mapped[Optional[str]] = mapped_column(String(80))
    pincode: Mapped[Optional[str]] = mapped_column(String(20))
    total_spent: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    purchase_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    loyalty_points: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_purchase_amount: Mapped[float] = mapped_column(
        Numeric(12, 2), nullable=False, default=0
    )
    last_purchase_at: Mapped[Optional[date]] = mapped_column(Date)
    notes: Mapped[Optional[str]] = mapped_column(Text)


class Order(Base, TimestampMixin):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("business_profiles.id")
    )
    order_number: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    party_type: Mapped[str] = mapped_column(String(20), nullable=False)
    party_name: Mapped[str] = mapped_column(String(180), nullable=False)
    outlet_id: Mapped[Optional[int]] = mapped_column(ForeignKey("outlets.id"))
    customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id"))
    supplier_id: Mapped[Optional[int]] = mapped_column(ForeignKey("suppliers.id"))
    staff_id: Mapped[Optional[int]] = mapped_column(ForeignKey("staff.id"), index=True)
    status: Mapped[str] = mapped_column(String(60), nullable=False, default="Draft")
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    terminal_id: Mapped[Optional[str]] = mapped_column(String(120), index=True)
    lease_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    payment_status: Mapped[str] = mapped_column(String(60), nullable=False, default="Unpaid")
    inventory_applied: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan", lazy="selectin"
    )


class OrderItem(Base, TimestampMixin):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    quantity: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False)
    unit_type: Mapped[str] = mapped_column(String(40), nullable=False, default="pieces")
    unit_label: Mapped[str] = mapped_column(String(60), nullable=False, default="Pieces")
    package_count: Mapped[Optional[float]] = mapped_column(Numeric(12, 3))
    package_size: Mapped[Optional[float]] = mapped_column(Numeric(12, 3))
    package_size_unit: Mapped[Optional[str]] = mapped_column(String(40))
    rate: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    gst_rate: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)

    order: Mapped["Order"] = relationship(back_populates="items")


class Invoice(Base, TimestampMixin):
    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("business_profiles.id")
    )
    invoice_number: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    order_id: Mapped[Optional[int]] = mapped_column(ForeignKey("orders.id"), index=True)
    invoice_type: Mapped[str] = mapped_column(String(30), nullable=False)
    invoice_direction: Mapped[str] = mapped_column(
        String(40), nullable=False, default="outlet_to_customer"
    )
    linked_invoice_id: Mapped[Optional[int]] = mapped_column(ForeignKey("invoices.id"))
    outlet_id: Mapped[Optional[int]] = mapped_column(ForeignKey("outlets.id"))
    customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id"))
    staff_id: Mapped[Optional[int]] = mapped_column(ForeignKey("staff.id"), index=True)
    is_reverse: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    party_type: Mapped[str] = mapped_column(String(20), nullable=False)
    party_name: Mapped[str] = mapped_column(String(180), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    taxable_value: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    cgst: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    sgst: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    igst: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(60), nullable=False, default="Unpaid")
    payment_method: Mapped[Optional[str]] = mapped_column(String(30))
    # Shared ERP payment snapshot fields. POS writes them at checkout so ERP
    # can display the sale as paid without a second manual collection.
    paid_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    remaining_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    payment_percentage: Mapped[float] = mapped_column(Numeric(7, 2), nullable=False, default=0)
    payment_status: Mapped[str] = mapped_column(String(30), nullable=False, default="Unpaid")
    last_payment_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    items: Mapped[list["InvoiceItem"]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan", lazy="selectin"
    )

    @property
    def grand_total(self) -> float:
        return (
            float(self.taxable_value)
            + float(self.cgst)
            + float(self.sgst)
            + float(self.igst)
        )


class InvoiceItem(Base, TimestampMixin):
    __tablename__ = "invoice_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_item_id: Mapped[Optional[int]] = mapped_column(ForeignKey("order_items.id"), index=True)
    product_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    product_name: Mapped[str] = mapped_column(String(180), nullable=False)
    barcode: Mapped[Optional[str]] = mapped_column(String(80))
    sku: Mapped[Optional[str]] = mapped_column(String(80))
    category: Mapped[Optional[str]] = mapped_column(String(100))
    quantity: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False)
    unit_price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    discount_pct: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    discount_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    tax_rate: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    tax_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    total: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    mrp: Mapped[Optional[float]] = mapped_column(Numeric(12, 2))

    invoice: Mapped["Invoice"] = relationship(back_populates="items")


class Payment(Base, TimestampMixin):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("business_profiles.id")
    )
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False
    )
    outlet_id: Mapped[Optional[int]] = mapped_column(ForeignKey("outlets.id"))
    staff_id: Mapped[Optional[int]] = mapped_column(ForeignKey("staff.id"), index=True)
    method: Mapped[str] = mapped_column(String(30), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    direction: Mapped[str] = mapped_column(String(10), nullable=False, default="in")
    reference_no: Mapped[Optional[str]] = mapped_column(String(120))


class InvoicePayment(Base, TimestampMixin):
    """ERP's immutable payment ledger, written alongside a POS checkout."""
    __tablename__ = "invoice_payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    receipt_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), nullable=False, index=True)
    business_profile_id: Mapped[Optional[int]] = mapped_column(ForeignKey("business_profiles.id"))
    customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id"))
    outlet_id: Mapped[Optional[int]] = mapped_column(ForeignKey("outlets.id"))
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(40), nullable=False)
    transaction_reference: Mapped[Optional[str]] = mapped_column(String(120))
    transaction_type: Mapped[str] = mapped_column(String(30), nullable=False, default="payment")
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="successful")
    notes: Mapped[Optional[str]] = mapped_column(Text)
    received_by: Mapped[Optional[str]] = mapped_column(String(160))
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    invoice_total_snapshot: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    previous_paid_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    total_paid_after: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    remaining_after: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    payment_status_after: Mapped[str] = mapped_column(String(30), nullable=False)


class InvoicePublicLink(Base, TimestampMixin):
    __tablename__ = "invoice_public_links"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_invoice_public_links_token_hash"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    business_profile_id: Mapped[int] = mapped_column(
        ForeignKey("business_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    opened_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    open_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class InvoiceNotification(Base, TimestampMixin):
    __tablename__ = "invoice_notifications"
    __table_args__ = (
        UniqueConstraint("invoice_id", "channel", name="uq_invoice_notifications_invoice_channel"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id"), index=True)
    business_profile_id: Mapped[int] = mapped_column(
        ForeignKey("business_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    outlet_id: Mapped[Optional[int]] = mapped_column(ForeignKey("outlets.id"), index=True)
    channel: Mapped[str] = mapped_column(String(20), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued", index=True)
    twilio_sid: Mapped[Optional[str]] = mapped_column(String(80))
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    failed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class NotificationOutbox(Base, TimestampMixin):
    __tablename__ = "notification_outbox"
    __table_args__ = (
        UniqueConstraint("invoice_id", "channel", name="uq_notification_outbox_invoice_channel"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    parent_outbox_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("notification_outbox.id", ondelete="SET NULL"), index=True
    )
    idempotency_key: Mapped[str] = mapped_column(String(180), nullable=False, unique=True, index=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, default="invoice_notification", index=True)
    aggregate_type: Mapped[str] = mapped_column(String(80), nullable=False, default="invoice", index=True)
    aggregate_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    notification_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("invoice_notifications.id", ondelete="SET NULL"), index=True
    )
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id"), index=True)
    business_profile_id: Mapped[int] = mapped_column(
        ForeignKey("business_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    outlet_id: Mapped[Optional[int]] = mapped_column(ForeignKey("outlets.id"), index=True)
    channel: Mapped[str] = mapped_column(String(20), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(32))
    public_url: Mapped[Optional[str]] = mapped_column(String(500))
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued", index=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=6)
    next_attempt_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    last_error: Mapped[Optional[str]] = mapped_column(Text)
    provider_response: Mapped[Optional[dict]] = mapped_column(JSON)
    dead_lettered_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    locked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    lock_owner: Mapped[Optional[str]] = mapped_column(String(120))
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


def _notification_outbox_key(target: NotificationOutbox) -> str:
    aggregate_id = target.aggregate_id or (
        str(target.invoice_id) if target.invoice_id is not None else None
    )
    channel = target.channel or "unknown"
    if aggregate_id:
        return f"invoice:{aggregate_id}:{channel}"
    if target.notification_id is not None:
        return f"notification:{target.notification_id}:{channel}"
    return f"notification-outbox:{channel}:{datetime.utcnow().timestamp()}"


@event.listens_for(NotificationOutbox, "before_insert")
def _populate_notification_outbox_required_fields(mapper, connection, target):
    if not target.aggregate_id and target.invoice_id is not None:
        target.aggregate_id = str(target.invoice_id)
    if not target.idempotency_key:
        target.idempotency_key = _notification_outbox_key(target)
    if not target.event_type:
        target.event_type = "invoice_notification"
    if not target.aggregate_type:
        target.aggregate_type = "invoice"
    if target.payload is None:
        target.payload = {}
    if not target.max_attempts:
        target.max_attempts = 6


class NotificationHistory(Base):
    __tablename__ = "notification_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    notification_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("invoice_notifications.id", ondelete="SET NULL"), index=True
    )
    outbox_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("notification_outbox.id", ondelete="SET NULL"), index=True
    )
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id"), index=True)
    business_profile_id: Mapped[int] = mapped_column(
        ForeignKey("business_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    outlet_id: Mapped[Optional[int]] = mapped_column(ForeignKey("outlets.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, default="invoice_notification", index=True)
    aggregate_type: Mapped[str] = mapped_column(String(80), nullable=False, default="invoice", index=True)
    aggregate_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    channel: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    channel_summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    provider_response: Mapped[Optional[dict]] = mapped_column(JSON)
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Return(Base, TimestampMixin):
    __tablename__ = "returns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("business_profiles.id")
    )
    return_number: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    original_invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id"), nullable=False
    )
    reversal_invoice_id: Mapped[Optional[int]] = mapped_column(ForeignKey("invoices.id"))
    outlet_id: Mapped[Optional[int]] = mapped_column(ForeignKey("outlets.id"))
    customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id"))
    staff_id: Mapped[Optional[int]] = mapped_column(ForeignKey("staff.id"))
    return_date: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(Text)
    resolution: Mapped[str] = mapped_column(String(20), nullable=False, default="refund")
    refund_method: Mapped[Optional[str]] = mapped_column(String(30))
    refund_amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    refund_status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending")
    status: Mapped[str] = mapped_column(
        String(40), nullable=False, default="submitted", index=True
    )
    remarks: Mapped[Optional[str]] = mapped_column(Text)

    items: Mapped[list["ReturnItem"]] = relationship(
        back_populates="return_", cascade="all, delete-orphan", lazy="selectin"
    )
    evidence: Mapped[list["ReturnEvidence"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin"
    )

    @property
    def evidence_count(self) -> int:
        return len(self.evidence or [])

    @property
    def evidence_required(self) -> bool:
        evidence_markers = {
            "damaged",
            "damage",
            "expired",
            "expiry",
            "manufacturing_defect",
            "manufacturing",
            "quality_issue",
            "quality",
            "delivery_issue",
            "delivery",
            "leaking",
            "leak",
            "broken",
            "other",
        }
        values = [self.reason or ""]
        values.extend(item.damage_type or "" for item in self.items or [])
        for value in values:
            normalized = value.strip().lower().replace("-", "_").replace(" ", "_")
            if normalized in evidence_markers:
                return True
            if any(marker in normalized for marker in evidence_markers - {"other"}):
                return True
        return False


class ReturnItem(Base, TimestampMixin):
    __tablename__ = "return_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    return_id: Mapped[int] = mapped_column(
        ForeignKey("returns.id", ondelete="CASCADE"), nullable=False
    )
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    order_item_id: Mapped[Optional[int]] = mapped_column(ForeignKey("order_items.id"))
    quantity: Mapped[float] = mapped_column(Numeric(12, 3), nullable=False)
    rate: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    discount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    gst_rate: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=0)
    line_refund: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    damage_type: Mapped[Optional[str]] = mapped_column(String(40))
    remarks: Mapped[Optional[str]] = mapped_column(Text)

    return_: Mapped["Return"] = relationship(back_populates="items")


class ReturnEvidence(Base, TimestampMixin):
    __tablename__ = "return_evidence"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    return_id: Mapped[int] = mapped_column(
        ForeignKey("returns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    business_profile_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("business_profiles.id"), index=True
    )
    outlet_id: Mapped[Optional[int]] = mapped_column(ForeignKey("outlets.id"), index=True)
    uploaded_by_staff_id: Mapped[Optional[int]] = mapped_column(ForeignKey("staff.id"), index=True)
    token_hash: Mapped[Optional[str]] = mapped_column(String(128), index=True)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_url: Mapped[str] = mapped_column(String(500), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Waybill(Base, TimestampMixin):
    __tablename__ = "waybills"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    waybill_number: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    generated_at: Mapped[date] = mapped_column(Date, nullable=False)
    valid_until: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="Active")
    transport_mode: Mapped[str] = mapped_column(
        String(40), nullable=False, default="Unspecified"
    )
    vehicle_number: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    from_name: Mapped[str] = mapped_column(String(180), nullable=False, default="")
    to_name: Mapped[str] = mapped_column(String(180), nullable=False, default="")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[Optional[int]] = mapped_column(ForeignKey("business_profiles.id"), index=True)
    outlet_id: Mapped[Optional[int]] = mapped_column(ForeignKey("outlets.id"), index=True)
    staff_id: Mapped[Optional[int]] = mapped_column(ForeignKey("staff.id"), index=True)
    terminal_id: Mapped[Optional[str]] = mapped_column(String(120), index=True)
    severity: Mapped[str] = mapped_column(String(20), nullable=False, default="info")
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(80), nullable=False)
    details: Mapped[Optional[str]] = mapped_column(Text)
    details_json: Mapped[Optional[dict]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ApprovalRequest(Base, TimestampMixin):
    __tablename__ = "approval_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[int] = mapped_column(ForeignKey("business_profiles.id"), nullable=False, index=True)
    outlet_id: Mapped[Optional[int]] = mapped_column(ForeignKey("outlets.id"), index=True)
    order_id: Mapped[Optional[int]] = mapped_column(ForeignKey("orders.id"), index=True)
    invoice_id: Mapped[Optional[int]] = mapped_column(ForeignKey("invoices.id"), index=True)
    requested_by_staff_id: Mapped[int] = mapped_column(ForeignKey("staff.id"), nullable=False, index=True)
    approved_by_staff_id: Mapped[Optional[int]] = mapped_column(ForeignKey("staff.id"), index=True)
    terminal_id: Mapped[Optional[str]] = mapped_column(String(120), index=True)
    approval_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    reason: Mapped[Optional[str]] = mapped_column(Text)
    payload: Mapped[Optional[dict]] = mapped_column(JSON)
    decision_note: Mapped[Optional[str]] = mapped_column(Text)
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)


class ShiftSession(Base, TimestampMixin):
    __tablename__ = "shift_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[int] = mapped_column(ForeignKey("business_profiles.id"), nullable=False, index=True)
    outlet_id: Mapped[Optional[int]] = mapped_column(ForeignKey("outlets.id"), index=True)
    staff_id: Mapped[int] = mapped_column(ForeignKey("staff.id"), nullable=False, index=True)
    terminal_id: Mapped[Optional[str]] = mapped_column(String(120), index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open", index=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    opening_cash: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    closing_cash: Mapped[Optional[float]] = mapped_column(Numeric(12, 2))
    expected_cash: Mapped[Optional[float]] = mapped_column(Numeric(12, 2))
    variance: Mapped[Optional[float]] = mapped_column(Numeric(12, 2))
    note: Mapped[Optional[str]] = mapped_column(Text)


class CashDrawerEvent(Base, TimestampMixin):
    __tablename__ = "cash_drawer_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[int] = mapped_column(ForeignKey("business_profiles.id"), nullable=False, index=True)
    outlet_id: Mapped[Optional[int]] = mapped_column(ForeignKey("outlets.id"), index=True)
    staff_id: Mapped[int] = mapped_column(ForeignKey("staff.id"), nullable=False, index=True)
    shift_id: Mapped[Optional[int]] = mapped_column(ForeignKey("shift_sessions.id"), index=True)
    terminal_id: Mapped[Optional[str]] = mapped_column(String(120), index=True)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    amount: Mapped[Optional[float]] = mapped_column(Numeric(12, 2))
    reason: Mapped[Optional[str]] = mapped_column(Text)
    metadata_json: Mapped[Optional[dict]] = mapped_column(JSON)


class DocumentSequence(Base, TimestampMixin):
    __tablename__ = "document_sequences"

    family: Mapped[str] = mapped_column(String(30), primary_key=True)
    next_value: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
