import os
from datetime import date
from decimal import Decimal
from pathlib import Path
import sys
import types

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

sys.modules.setdefault("boto3", types.SimpleNamespace(client=lambda *args, **kwargs: None))
botocore_module = types.ModuleType("botocore")
botocore_exceptions = types.ModuleType("botocore.exceptions")
botocore_exceptions.BotoCoreError = Exception
botocore_exceptions.ClientError = Exception
sys.modules.setdefault("botocore", botocore_module)
sys.modules.setdefault("botocore.exceptions", botocore_exceptions)

from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import BusinessProfile, Customer, Order, Outlet, UploadedFile  # noqa: E402
from app.security import create_access_token  # noqa: E402


@pytest.fixture()
def api_client():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestingSessionLocal() as db:
        seed = _seed_tenants(db)
    try:
        yield TestClient(app, base_url="http://localhost"), seed
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(engine)
        engine.dispose()


def _profile(profile_id: int, suffix: str) -> BusinessProfile:
    return BusinessProfile(
        id=profile_id,
        role="admin",
        access_code=f"ADM-{suffix}",
        legal_name=f"Tenant {suffix}",
        trade_name=f"Tenant {suffix}",
        logo_text="ERP",
        owner_name=f"Owner {suffix}",
        mobile="9876543210",
        email=f"tenant-{suffix}@example.test",
        password_hash="unused",
    )


def _outlet(outlet_id: int, profile_id: int, suffix: str) -> Outlet:
    return Outlet(
        id=outlet_id,
        business_profile_id=profile_id,
        outlet_code=f"OUT-{suffix}",
        role="outlet",
        access_code=f"OUT-ACCESS-{suffix}",
        legal_name=f"Outlet {suffix}",
        trade_name=f"Outlet {suffix}",
        logo_text="ERP",
        owner_name=f"Outlet Owner {suffix}",
        mobile="9876543210",
        email=f"outlet-{suffix}@example.test",
        password_hash="unused",
        name=f"Outlet {suffix}",
        manager_name=f"Manager {suffix}",
        is_active=True,
    )


def _token(profile_id: int, role: str = "admin", outlet_id: int | None = None) -> str:
    claims = {
        "sub": f"{role}:{profile_id}:{outlet_id or 'admin'}",
        "business_profile_id": profile_id,
        "role": role,
        "email": f"{role}-{profile_id}@example.test",
    }
    if outlet_id is not None:
        claims["outlet_id"] = outlet_id
    return create_access_token(claims)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _seed_tenants(db):
    profile_one = _profile(1, "ONE")
    profile_two = _profile(2, "TWO")
    outlet_one = _outlet(10, 1, "ONE")
    outlet_one_peer = _outlet(11, 1, "ONE-PEER")
    outlet_two = _outlet(20, 2, "TWO")
    customer_one = Customer(id=100, outlet_id=10, phone="9000000001", name="Tenant One Customer")
    customer_two = Customer(id=200, outlet_id=20, phone="9000000002", name="Tenant Two Customer")
    file_one = UploadedFile(
        id=300,
        business_profile_id=1,
        original_name="tenant-one.csv",
        stored_name="tenant-one.csv",
        file_url="/uploads/files/tenant-one.csv",
        file_path="/tmp/tenant-one.csv",
        file_type="csv",
        row_count=1,
        is_active=True,
        columns_json="[]",
        preview_json="[]",
        rows_json="[]",
    )
    file_two = UploadedFile(
        id=400,
        business_profile_id=2,
        original_name="tenant-two.csv",
        stored_name="tenant-two.csv",
        file_url="/uploads/files/tenant-two.csv",
        file_path="/tmp/tenant-two.csv",
        file_type="csv",
        row_count=1,
        is_active=True,
        columns_json="[]",
        preview_json="[]",
        rows_json="[]",
    )
    peer_order = Order(
        id=500,
        business_profile_id=1,
        order_number="ORD-PEER-1",
        type="sale",
        party_type="B2B",
        party_name="Peer outlet customer",
        outlet_id=outlet_one_peer.id,
        status="Draft",
        date=date.today(),
        payment_status="Unpaid",
    )
    db.add_all([
        profile_one,
        profile_two,
        outlet_one,
        outlet_one_peer,
        outlet_two,
        customer_one,
        customer_two,
        file_one,
        file_two,
        peer_order,
    ])
    db.commit()
    return {
        "tenant_one_token": _token(1),
        "tenant_two_token": _token(2),
        "outlet_one_token": _token(1, role="outlet", outlet_id=outlet_one.id),
        "profile_one": profile_one.id,
        "profile_two": profile_two.id,
        "outlet_one": outlet_one.id,
        "outlet_two": outlet_two.id,
        "customer_one": customer_one.id,
        "customer_two": customer_two.id,
        "file_one": file_one.id,
        "file_two": file_two.id,
    }


def test_outlet_token_cannot_read_peer_outlet_orders(api_client):
    client, seed = api_client
    headers = _auth(seed["outlet_one_token"])

    response = client.get("/api/v1/orders", headers=headers)
    assert response.status_code == 200
    assert response.json() == []

    forbidden = client.get("/api/v1/orders?outletId=11", headers=headers)
    assert forbidden.status_code == 403


def test_dashboard_supporting_lists_work_for_admin_principal(api_client):
    client, seed = api_client
    headers = _auth(seed["tenant_one_token"])

    for path in ("/api/v1/products/inventory/damaged", "/api/v1/supplier-returns", "/api/v1/waybills"):
        response = client.get(path, headers=headers)
        assert response.status_code == 200


def test_authenticated_customer_list(api_client):
    client, seed = api_client

    response = client.get(
        f"/api/v1/business-profile/{seed['profile_one']}/outlets/{seed['outlet_one']}/customers",
        headers=_auth(seed["tenant_one_token"]),
    )

    assert response.status_code == 200
    assert [customer["id"] for customer in response.json()] == [seed["customer_one"]]


def test_unauthenticated_customer_list(api_client):
    client, seed = api_client

    response = client.get(
        f"/api/v1/business-profile/{seed['profile_one']}/outlets/{seed['outlet_one']}/customers",
    )

    assert response.status_code == 401


def test_supplier_phone_create_search_update_and_tenant_scope(api_client):
    client, seed = api_client
    tenant_one_headers = _auth(seed["tenant_one_token"])

    created = client.post(
        "/api/v1/suppliers",
        headers=tenant_one_headers,
        json={"name": "Acme Components", "phone": "+91 98765 43210", "email": "sales@acme.test"},
    )

    assert created.status_code == 201
    supplier = created.json()
    assert supplier["phone"] == "+91 98765 43210"
    assert supplier["mobile"] == "+91 98765 43210"

    searched = client.get("/api/v1/suppliers?search=98765", headers=tenant_one_headers)
    assert searched.status_code == 200
    assert [record["id"] for record in searched.json()] == [supplier["id"]]

    updated = client.put(
        f"/api/v1/suppliers/{supplier['id']}",
        headers=tenant_one_headers,
        json={**supplier, "phone": "+91 91234 56789", "mobile": None},
    )
    assert updated.status_code == 200
    assert updated.json()["phone"] == "+91 91234 56789"

    forbidden = client.put(
        f"/api/v1/suppliers/{supplier['id']}",
        headers=_auth(seed["tenant_two_token"]),
        json={**supplier, "name": "Cross tenant update"},
    )
    assert forbidden.status_code == 404


def test_product_name_is_unique_after_whitespace_and_case_normalization(api_client):
    client, seed = api_client
    headers = _auth(seed["tenant_one_token"])
    product = {
        "name": "Fossils Watches",
        "category": "Watches",
        "supplier": "Fossil",
        "qtyBought": 5,
        "qtySold": 0,
        "mrp": 15000,
        "buyPrice": 13500,
        "sellPrice": 18000,
        "gstRate": 12,
    }

    created = client.post("/api/v1/products", headers=headers, json=product)
    duplicate = client.post(
        "/api/v1/products",
        headers=headers,
        json={**product, "name": "  fossils   WATCHES  "},
    )

    assert created.status_code == 201
    assert duplicate.status_code == 409
    assert "PRODUCT_ALREADY_EXISTS" in duplicate.text
    listed = client.get("/api/v1/products", headers=headers)
    assert [item["name"] for item in listed.json()].count("Fossils Watches") == 1


def test_product_create_and_update_return_persisted_timestamps(api_client):
    client, seed = api_client
    headers = _auth(seed["tenant_one_token"])
    product = {
        "name": "Timestamped Product",
        "category": "Watches",
        "supplier": "Fossil",
        "qtyBought": 5,
        "qtySold": 0,
        "mrp": 15000,
        "buyPrice": 13500,
        "sellPrice": 18000,
        "gstRate": 12,
        "reorderLevel": 1,
    }

    created = client.post("/api/v1/products", headers=headers, json=product)

    assert created.status_code == 201
    created_body = created.json()
    assert created_body["createdAt"]
    assert created_body["updatedAt"]

    updated = client.put(
        f"/api/v1/products/{created_body['id']}",
        headers=headers,
        json={**created_body, "qtyBought": 6, "sellPrice": 18100},
    )

    assert updated.status_code == 200
    updated_body = updated.json()
    assert updated_body["qtyBought"] == "6.000"
    assert updated_body["sellPrice"] == "18100.00"
    assert updated_body["createdAt"]
    assert updated_body["updatedAt"]


def test_repeated_product_restock_updates_available_stock(api_client):
    client, seed = api_client
    headers = _auth(seed["tenant_one_token"])
    product = {
        "name": "Repeated Restock Product",
        "category": "Watches",
        "supplier": "Fossil",
        "qtyBought": 2,
        "qtySold": 0,
        "mrp": 100,
        "buyPrice": 60,
        "sellPrice": 90,
        "gstRate": 12,
        "reorderLevel": 3,
    }

    created = client.post("/api/v1/products", headers=headers, json=product)
    assert created.status_code == 201
    current = created.json()
    assert Decimal(str(current["remaining"])) == Decimal("2")

    first = client.put(
        f"/api/v1/products/{current['id']}",
        headers=headers,
        json={**current, "qtyBought": 3},
    )
    assert first.status_code == 200
    current = first.json()
    assert Decimal(str(current["remaining"])) == Decimal("3")

    second = client.put(
        f"/api/v1/products/{current['id']}",
        headers=headers,
        json={**current, "qtyBought": 4},
    )
    assert second.status_code == 200
    current = second.json()
    assert Decimal(str(current["remaining"])) == Decimal("4")

    listed = client.get("/api/v1/products", headers=headers)
    assert listed.status_code == 200
    listed_product = next(item for item in listed.json() if item["id"] == current["id"])
    assert Decimal(str(listed_product["remaining"])) == Decimal("4")

    low_stock = client.get("/api/v1/products?lowStock=true", headers=headers)
    assert low_stock.status_code == 200
    assert current["id"] not in [item["id"] for item in low_stock.json()]


def test_product_list_uses_cached_stock_without_ledger_reconciliation(api_client, monkeypatch):
    client, seed = api_client
    headers = _auth(seed["tenant_one_token"])
    product = {
        "name": "Cached Stock List Product",
        "category": "Watches",
        "supplier": "Fossil",
        "qtyBought": 8,
        "qtySold": 1,
        "mrp": 100,
        "buyPrice": 60,
        "sellPrice": 90,
        "gstRate": 12,
        "reorderLevel": 2,
    }

    created = client.post("/api/v1/products", headers=headers, json=product)
    assert created.status_code == 201

    def fail_if_reconciled(*_args, **_kwargs):
        raise AssertionError("Product list must not reconcile ledger stock")

    monkeypatch.setattr("app.api.products.product_metrics_from_ledger", fail_if_reconciled)

    listed = client.get("/api/v1/products", headers=headers)

    assert listed.status_code == 200
    listed_product = next(item for item in listed.json() if item["id"] == created.json()["id"])
    assert Decimal(str(listed_product["remaining"])) == Decimal("7")


def test_health_does_not_call_notification_worker_readiness(api_client, monkeypatch):
    client, _seed = api_client

    def fail_if_called():
        raise AssertionError("Health endpoint must not run deep notification readiness checks")

    monkeypatch.setattr("app.main.notification_worker.readiness", fail_if_called)

    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "uptimeSeconds" in body
    assert body["database"] in {"ok", "error"}


def test_cross_tenant_customer_access(api_client):
    client, seed = api_client

    response = client.get(
        f"/api/v1/business-profile/{seed['profile_two']}/outlets/{seed['outlet_two']}/customers",
        headers=_auth(seed["tenant_one_token"]),
    )

    assert response.status_code == 403


def test_customer_update_by_another_tenant_is_blocked(api_client):
    client, seed = api_client

    response = client.put(
        f"/api/v1/business-profile/{seed['profile_two']}/outlets/{seed['outlet_two']}/customers/{seed['customer_two']}",
        headers=_auth(seed["tenant_one_token"]),
        json={"name": "Changed", "phone": "9000000002"},
    )

    assert response.status_code == 403


def test_customer_delete_by_another_tenant_is_blocked(api_client):
    client, seed = api_client

    response = client.delete(
        f"/api/v1/business-profile/{seed['profile_two']}/outlets/{seed['outlet_two']}/customers/{seed['customer_two']}",
        headers=_auth(seed["tenant_one_token"]),
    )

    assert response.status_code == 403


def test_file_delete_success(api_client):
    client, seed = api_client

    response = client.delete(
        f"/api/v1/files/{seed['file_one']}",
        headers=_auth(seed["tenant_one_token"]),
    )

    assert response.status_code == 200
    assert response.json() == {"message": "File deleted"}


def test_file_delete_unauthorized(api_client):
    client, seed = api_client

    response = client.delete(f"/api/v1/files/{seed['file_one']}")

    assert response.status_code == 401


def test_file_delete_cross_tenant_is_hidden(api_client):
    client, seed = api_client

    response = client.delete(
        f"/api/v1/files/{seed['file_two']}",
        headers=_auth(seed["tenant_one_token"]),
    )

    assert response.status_code == 404


def test_category_create_authenticated(api_client):
    client, seed = api_client

    response = client.post(
        "/api/v1/categories",
        headers=_auth(seed["tenant_one_token"]),
        json={"name": "Secure Category", "description": "Created by an authenticated user", "isActive": True},
    )

    assert response.status_code == 201
    assert response.json()["name"] == "Secure Category"


def test_category_create_unauthenticated(api_client):
    client, _seed = api_client

    response = client.post(
        "/api/v1/categories",
        json={"name": "Public Write Attempt", "isActive": True},
    )

    assert response.status_code == 401
