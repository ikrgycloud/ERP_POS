"""ORM models — organisation & staff."""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base, TimestampMixin


class BusinessProfile(Base, TimestampMixin):
    __tablename__ = "business_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="admin")
    access_code: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    legal_name: Mapped[str] = mapped_column(String(200), nullable=False)
    trade_name: Mapped[str] = mapped_column(String(200), nullable=False)
    logo_text: Mapped[str] = mapped_column(String(20), nullable=False, default="ERP")
    logo_url: Mapped[Optional[str]] = mapped_column(String(255))
    logo_path: Mapped[Optional[str]] = mapped_column(String(255))
    invoice_company_name: Mapped[Optional[str]] = mapped_column(String(200))
    owner_name: Mapped[str] = mapped_column(String(120), nullable=False)
    mobile: Mapped[str] = mapped_column(String(30), nullable=False)
    email: Mapped[str] = mapped_column(String(150), nullable=False)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255))
    gstin: Mapped[Optional[str]] = mapped_column(String(30))
    pan: Mapped[Optional[str]] = mapped_column(String(20))
    cin: Mapped[Optional[str]] = mapped_column(String(40))
    business_type: Mapped[Optional[str]] = mapped_column(String(100))
    tax_type: Mapped[str] = mapped_column(String(50), nullable=False, default="Regular GST")
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="INR")
    financial_year: Mapped[str] = mapped_column(String(20), nullable=False, default="2026-2027")
    billing_address: Mapped[Optional[str]] = mapped_column(Text)
    shipping_address: Mapped[Optional[str]] = mapped_column(Text)
    city: Mapped[Optional[str]] = mapped_column(String(80))
    state: Mapped[Optional[str]] = mapped_column(String(80))
    pincode: Mapped[Optional[str]] = mapped_column(String(20))
    bank_name: Mapped[Optional[str]] = mapped_column(String(120))
    account_number: Mapped[Optional[str]] = mapped_column(String(60))
    ifsc: Mapped[Optional[str]] = mapped_column(String(30))
    upi_id: Mapped[Optional[str]] = mapped_column(String(80))


class Outlet(Base, TimestampMixin):
    __tablename__ = "outlets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[int] = mapped_column(
        ForeignKey("business_profiles.id", ondelete="CASCADE"), nullable=False
    )
    outlet_code: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="outlet")
    access_code: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    legal_name: Mapped[str] = mapped_column(String(200), nullable=False)
    trade_name: Mapped[str] = mapped_column(String(200), nullable=False)
    logo_text: Mapped[str] = mapped_column(String(20), nullable=False, default="ERP")
    owner_name: Mapped[str] = mapped_column(String(120), nullable=False)
    mobile: Mapped[str] = mapped_column(String(30), nullable=False)
    email: Mapped[str] = mapped_column(String(150), nullable=False)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    manager_name: Mapped[Optional[str]] = mapped_column(String(120))
    gstin: Mapped[Optional[str]] = mapped_column(String(30))
    pan: Mapped[Optional[str]] = mapped_column(String(20))
    cin: Mapped[Optional[str]] = mapped_column(String(40))
    business_type: Mapped[Optional[str]] = mapped_column(String(100))
    tax_type: Mapped[str] = mapped_column(String(50), nullable=False, default="Regular GST")
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="INR")
    financial_year: Mapped[str] = mapped_column(String(20), nullable=False, default="2026-2027")
    address: Mapped[Optional[str]] = mapped_column(Text)
    city: Mapped[Optional[str]] = mapped_column(String(80))
    state: Mapped[Optional[str]] = mapped_column(String(80))
    pincode: Mapped[Optional[str]] = mapped_column(String(20))
    bank_name: Mapped[Optional[str]] = mapped_column(String(120))
    account_number: Mapped[Optional[str]] = mapped_column(String(60))
    ifsc: Mapped[Optional[str]] = mapped_column(String(30))
    upi_id: Mapped[Optional[str]] = mapped_column(String(80))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Staff(Base, TimestampMixin):
    __tablename__ = "staff"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[int] = mapped_column(
        ForeignKey("business_profiles.id", ondelete="CASCADE"), nullable=False
    )
    outlet_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("outlets.id", ondelete="SET NULL")
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    employee_code: Mapped[str] = mapped_column(
        String(40), nullable=False, unique=True, index=True
    )
    full_name: Mapped[str] = mapped_column(String(180), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(30))
    email: Mapped[Optional[str]] = mapped_column(String(150))
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    manager_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("staff.id", ondelete="SET NULL"), index=True
    )
    joining_date: Mapped[Optional[date]] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    manager: Mapped[Optional["Staff"]] = relationship(remote_side=[id])


class Terminal(Base, TimestampMixin):
    __tablename__ = "pos_terminals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    business_profile_id: Mapped[int] = mapped_column(
        ForeignKey("business_profiles.id", ondelete="CASCADE"), nullable=False, index=True
    )
    outlet_id: Mapped[int] = mapped_column(
        ForeignKey("outlets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    terminal_id: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    secret_hash: Mapped[Optional[str]] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
