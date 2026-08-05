"""Test fixtures: in-memory SQLite, seeded data, and an httpx client."""
from datetime import date
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("ENVIRONMENT", "testing")
os.environ.setdefault("TRUSTED_HOSTS", "localhost,testserver")
os.environ.setdefault("CORS_ORIGINS", "http://localhost,http://testserver")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-production-32chars")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.security import hash_password
from app.core.token_store import clear_revoked_tokens
from app.db.session import Base, get_db
from app.main import app
from app.models.catalog import Category, Product, Supplier
from app.models.org import BusinessProfile, Outlet, Staff

TEST_DB = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine(TEST_DB, echo=False)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def session_factory(engine):
    return async_sessionmaker(bind=engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def seeded(session_factory):
    async with session_factory() as db:
        bp = BusinessProfile(
            role="admin", access_code="BP1", legal_name="T", trade_name="T",
            owner_name="O", mobile="9", email="o@t.test",
            password_hash=hash_password("x"),
        )
        db.add(bp)
        await db.flush()
        outlet = Outlet(
            business_profile_id=bp.id, outlet_code="O1", access_code="OA1",
            legal_name="T", trade_name="T", owner_name="O", mobile="9",
            email="ol@t.test", name="Main",
        )
        db.add(outlet)
        await db.flush()
        bm = Staff(business_profile_id=bp.id, outlet_id=outlet.id, role="branch_manager",
                   employee_code="BM001", full_name="BM", password_hash=hash_password("bm123"))
        db.add(bm)
        await db.flush()
        sm = Staff(business_profile_id=bp.id, outlet_id=outlet.id, role="sales_manager",
                   employee_code="SM001", full_name="SM", password_hash=hash_password("sm123"), manager_id=bm.id)
        db.add(sm)
        await db.flush()
        sp = Staff(business_profile_id=bp.id, outlet_id=outlet.id, role="sales_person",
                   employee_code="SP001", full_name="SP", password_hash=hash_password("sp123"), manager_id=sm.id)
        db.add(sp)
        cat = Category(name="Groceries")
        sup = Supplier(business_profile_id=bp.id, name="Acme")
        db.add_all([cat, sup])
        await db.flush()
        db.add(Product(
            business_profile_id=bp.id, sku="SKU-MILK", name="Milk 500ml",
            category="Groceries", supplier="Acme", barcode="BC-MILK",
            mrp=50, buy_price=40, sell_price=50, gst_rate=5, qty_bought=100,
            stock_cached=100, reorder_level=10,
        ))
        await db.commit()
    return session_factory


@pytest_asyncio.fixture
async def client(seeded):
    clear_revoked_tokens()

    async def _get_db():
        async with seeded() as s:
            try:
                yield s
                await s.commit()
            except Exception:
                await s.rollback()
                raise

    app.dependency_overrides[get_db] = _get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://localhost") as c:
        c.test_session_factory = seeded
        yield c
    app.dependency_overrides.clear()
    clear_revoked_tokens()


async def login(client, code, pw):
    r = await client.post("/api/v1/auth/login", json={"employee_code": code, "password": pw})
    assert r.status_code == 200, r.text
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    if code.upper().startswith("SP"):
        shift = await client.post(
            "/api/v1/pos/enterprise/shifts/open",
            headers=headers,
            json={"opening_cash": 0, "note": "test shift"},
        )
        assert shift.status_code in {200, 201}, shift.text
    return headers
