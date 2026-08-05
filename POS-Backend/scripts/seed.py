"""Seed the database with a business, one outlet, and the three roles.

Usage:  python -m scripts.seed
Initializes the database schema first when needed (dev convenience).
"""
import asyncio
from datetime import date

from app.core.config import settings
from app.core.security import hash_password
from app.db.init import DatabaseInitializer
from app.db.session import AsyncSessionLocal, engine
from app.models.catalog import Category, Product, Supplier
from app.models.org import BusinessProfile, Outlet, Staff


async def seed() -> None:
    await DatabaseInitializer(engine, settings.DATABASE_URL).initialize()

    async with AsyncSessionLocal() as db:
        bp = BusinessProfile(
            role="admin", access_code="BP-0001", legal_name="Demo Retail Pvt Ltd",
            trade_name="Demo Retail", owner_name="Owner", mobile="9000000000",
            email="owner@demo.test", password_hash=hash_password("admin123"),
            gstin="27AAAAA0000A1Z5", tax_type="Regular GST",
        )
        db.add(bp)
        await db.flush()

        outlet = Outlet(
            business_profile_id=bp.id, outlet_code="OUT-0001", access_code="OUT-AC-0001",
            legal_name="Demo Retail Pvt Ltd", trade_name="Demo Retail",
            owner_name="Owner", mobile="9000000000", email="outlet@demo.test",
            name="Main Branch", is_active=True,
        )
        db.add(outlet)
        await db.flush()

        bm = Staff(
            business_profile_id=bp.id, outlet_id=outlet.id, role="branch_manager",
            employee_code="BM001", full_name="Branch Manager", phone="9000000001",
            email="bm@demo.test", password_hash=hash_password("bm123"),
            joining_date=date.today(), is_active=True,
        )
        db.add(bm)
        await db.flush()

        sm = Staff(
            business_profile_id=bp.id, outlet_id=outlet.id, role="sales_manager",
            employee_code="SM001", full_name="Sales Manager", phone="9000000002",
            email="sm@demo.test", password_hash=hash_password("sm123"),
            manager_id=bm.id, joining_date=date.today(), is_active=True,
        )
        db.add(sm)
        await db.flush()

        sp = Staff(
            business_profile_id=bp.id, outlet_id=outlet.id, role="sales_person",
            employee_code="SP001", full_name="Sales Person", phone="9000000003",
            email="sp@demo.test", password_hash=hash_password("sp123"),
            manager_id=sm.id, joining_date=date.today(), is_active=True,
        )
        db.add(sp)

        cat = Category(name="Groceries", description="Everyday items")
        sup = Supplier(business_profile_id=bp.id, name="Acme Distributors")
        db.add_all([cat, sup])
        await db.flush()

        db.add_all([
            Product(
                business_profile_id=bp.id, sku="SKU-MILK", name="Milk 500ml",
                category_id=cat.id, supplier_id=sup.id, category="Groceries",
                supplier="Acme Distributors", barcode="8901234567890",
                mrp=50, buy_price=40, sell_price=50, gst_rate=5,
                qty_bought=200, stock_cached=200, reorder_level=20,
            ),
            Product(
                business_profile_id=bp.id, sku="SKU-BREAD", name="Bread",
                category_id=cat.id, supplier_id=sup.id, category="Groceries",
                supplier="Acme Distributors", barcode="8901234567891",
                mrp=40, buy_price=30, sell_price=40, gst_rate=5,
                qty_bought=150, stock_cached=150, reorder_level=15,
            ),
        ])
        await db.commit()

    print("Seed complete.")
    print("  Branch Manager -> BM001 / bm123")
    print("  Sales Manager  -> SM001 / sm123")
    print("  Sales Person   -> SP001 / sp123")


if __name__ == "__main__":
    asyncio.run(seed())
