"""End-to-end: login, RBAC, billing checkout, return + reversal."""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from urllib.parse import urlparse

from app.core.config import settings
from app.models.catalog import InventoryLedger, ProductDiscount
from app.models.sales import Order
from tests.conftest import login

pytestmark = pytest.mark.asyncio

VALID_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
    b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4"
    b"\x89\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00"
    b"\x05\xfe\x02\xfeA\xe2\xa1\x85\x00\x00\x00\x00IEND"
    b"\xaeB`\x82"
)


async def upload_return_evidence(client, headers, return_id, name="damage.png", note="Evidence"):
    link = await client.post(f"/api/v1/returns/{return_id}/evidence-link", headers=headers)
    assert link.status_code == 200, link.text
    upload_url = link.json()["upload_url"]
    token = urlparse(upload_url).path.rsplit("/", 1)[-1]
    upload = await client.post(
        f"/api/v1/returns/public/evidence/{token}",
        files={"file": (name, VALID_PNG_BYTES, "image/png")},
        data={"note": note},
    )
    assert upload.status_code == 201, upload.text
    return upload.json()


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


async def test_rbac_sales_person_cannot_create_staff(client):
    sp = await login(client, "SP001", "sp123")
    r = await client.post("/api/v1/staff", headers=sp, json={
        "role": "sales_person", "employee_code": "X", "full_name": "X", "password": "secret",
    })
    assert r.status_code == 403


async def test_sales_manager_creates_sales_person_only(client):
    sm = await login(client, "SM001", "sm123")
    # allowed
    r = await client.post("/api/v1/staff", headers=sm, json={
        "role": "sales_person",
        "employee_code": "SP100",
        "full_name": "New SP",
        "phone": "9876543210",
        "password": "Secret@123",
    })
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["phone"] == "9876543210"
    assert created["phone_number"] == "9876543210"
    assert created["status"] == "active"
    assert created["active"] is True

    # Regression: a salesperson created by a sales manager must be able to use
    # those credentials immediately, including case-insensitive employee codes.
    new_staff_login = await client.post(
        "/api/v1/auth/login",
        json={"employee_code": "sp100", "password": "Secret@123"},
    )
    assert new_staff_login.status_code == 200, new_staff_login.text
    login_payload = new_staff_login.json()
    assert login_payload["access_token"]
    new_staff_me = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {login_payload['access_token']}"},
    )
    assert new_staff_me.status_code == 200, new_staff_me.text
    assert new_staff_me.json()["employee_code"] == "SP100"
    assert new_staff_me.json()["role"] == "sales_person"
    # forbidden: SM cannot create SM
    r2 = await client.post("/api/v1/staff", headers=sm, json={
        "role": "sales_manager", "employee_code": "SM100", "full_name": "Nope", "password": "Secret@123",
    })
    assert r2.status_code == 403

    disabled = await client.patch(
        f"/api/v1/staff/{created['id']}/status",
        headers=sm,
        json={"is_active": False},
    )
    assert disabled.status_code == 200, disabled.text
    assert disabled.json()["status"] == "inactive"

    deleted = await client.delete(f"/api/v1/staff/{created['id']}", headers=sm)
    assert deleted.status_code == 200, deleted.text


async def test_billing_and_reversal_flow(client):
    sp = await login(client, "SP001", "sp123")

    # scan lookup
    r = await client.get("/api/v1/products/barcode/BC-MILK?quantity=2", headers=sp)
    assert r.status_code == 200, r.text
    assert r.json()["product_name"] == "Milk 500ml"

    # start cart
    r = await client.post("/api/v1/pos/cart", headers=sp, json={})
    order_id = r.json()["order_id"]

    # scan add x2
    r = await client.post(f"/api/v1/pos/cart/{order_id}/scan", headers=sp,
                          json={"barcode": "BC-MILK", "quantity": 2})
    assert r.status_code == 200, r.text
    line = r.json()
    assert line["line_total"] == "100.00"

    # totals: 2 * 50 = 100 taxable, 5% GST = 5 -> cgst 2.5 sgst 2.5 grand 105
    r = await client.get(f"/api/v1/pos/cart/{order_id}/totals", headers=sp)
    totals = r.json()["totals"]
    assert totals["taxable_value"] == "100.00"
    assert totals["cgst"] == "2.50"
    assert totals["sgst"] == "2.50"
    assert totals["grand_total"] == "105.00"

    # checkout
    r = await client.post(f"/api/v1/pos/cart/{order_id}/checkout", headers=sp,
                          json={"payment_method": "cash"})
    assert r.status_code == 200, r.text
    inv = r.json()
    invoice_id = inv["id"]
    assert inv["is_reverse"] is False
    assert "/invoice/view/" in inv["public_invoice_url"]
    assert inv["items"][0]["product_name"] == "Milk 500ml"
    assert inv["items"][0]["barcode"] == "BC-MILK"
    assert inv["items"][0]["sku"] == "SKU-MILK"
    assert inv["items"][0]["category"] == "Groceries"
    assert inv["items"][0]["quantity"] == "2.000"
    assert inv["items"][0]["unit_price"] == "50.00"
    assert inv["items"][0]["tax_rate"] == "5.00"
    assert inv["items"][0]["mrp"] == "50.00"

    stale_cart = await client.get(f"/api/v1/pos/cart/{order_id}/totals", headers=sp)
    assert stale_cart.status_code == 400
    assert "Cart is no longer editable" in stale_cart.text

    # submit a return for 1 unit
    r = await client.post("/api/v1/returns", headers=sp, json={
        "original_invoice_id": invoice_id,
        "reason": "damaged",
        "resolution": "refund",
        "refund_method": "cash",
        "items": [{
            "product_id": inv["order_id"] and 1 or 1,  # milk is product id 1
            "quantity": 1, "rate": 50, "discount": 0, "gst_rate": 5,
            "damage_type": "leaking",
        }],
    })
    assert r.status_code == 201, r.text
    ret = r.json()
    return_id = ret["id"]
    assert ret["status"] == "submitted"

    uploaded = await upload_return_evidence(client, sp, return_id, note="Leaking pack")
    assert uploaded["return_id"] == return_id

    # advance lifecycle as BM: verified -> approved -> process
    bm = await login(client, "BM001", "bm123")
    for st in ("verified", "approved"):
        r = await client.patch(f"/api/v1/returns/{return_id}/status", headers=bm, json={"status": st})
        assert r.status_code == 200, r.text

    r = await client.post(f"/api/v1/returns/{return_id}/process", headers=bm)
    assert r.status_code == 200, r.text
    processed = r.json()
    assert processed["status"] == "completed"
    assert processed["reversal_invoice_id"] is not None
    # refund = 50 taxable + 5% = 52.50
    assert processed["refund_amount"] == "52.50"
    assert processed["refund_status"] == "completed"

    product = await client.get("/api/v1/products/1", headers=bm)
    assert product.status_code == 200, product.text
    product_payload = product.json()
    assert product_payload["stock_cached"] == "98.000"
    assert product_payload["qty_returned"] == "1.000"
    assert product_payload["damaged_qty"] == "1.000"


async def test_discount_create_rejects_overlapping_active_range(client):
    bm = await login(client, "BM001", "bm123")
    payload = {
        "discount_type": "percentage",
        "discount_value": 10,
        "min_quantity": 0,
        "start_date": date.today().isoformat(),
        "end_date": date.today().isoformat(),
        "description": "Morning offer",
    }

    created = await client.post("/api/v1/products/1/discounts", headers=bm, json=payload)
    assert created.status_code == 201, created.text

    overlap = await client.post(
        "/api/v1/products/1/discounts",
        headers=bm,
        json={**payload, "discount_value": 20, "description": "Overlapping offer"},
    )
    assert overlap.status_code == 409
    assert "overlaps" in overlap.text


async def test_pos_scan_uses_best_discount_for_legacy_overlaps(client, seeded):
    async with seeded() as db:
        db.add_all(
            [
                ProductDiscount(
                    product_id=1,
                    business_profile_id=1,
                    discount_type="percentage",
                    discount_value=Decimal("10"),
                    min_quantity=Decimal("0"),
                    start_date=date.today(),
                    end_date=date.today(),
                    is_active=True,
                ),
                ProductDiscount(
                    product_id=1,
                    business_profile_id=1,
                    discount_type="fixed",
                    discount_value=Decimal("15"),
                    min_quantity=Decimal("0"),
                    start_date=date.today(),
                    end_date=date.today(),
                    is_active=True,
                ),
            ]
        )
        await db.commit()

    sp = await login(client, "SP001", "sp123")
    response = await client.get("/api/v1/products/barcode/BC-MILK?quantity=1", headers=sp)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["discount_pct"] == "30.00"
    assert body["total"] == "35.00"


async def test_manager_product_insights_show_low_stock_and_best_sellers(client):
    sp = await login(client, "SP001", "sp123")

    cart = await client.post("/api/v1/pos/cart", headers=sp, json={})
    assert cart.status_code == 201, cart.text
    order_id = cart.json()["order_id"]

    scan = await client.post(
        f"/api/v1/pos/cart/{order_id}/scan",
        headers=sp,
        json={"barcode": "BC-MILK", "quantity": 96},
    )
    assert scan.status_code == 200, scan.text

    checkout = await client.post(
        f"/api/v1/pos/cart/{order_id}/checkout",
        headers=sp,
        json={"payment_method": "cash"},
    )
    assert checkout.status_code == 200, checkout.text

    bm = await login(client, "BM001", "bm123")
    branch_report = await client.get("/api/v1/reports/products/insights?top=5", headers=bm)
    assert branch_report.status_code == 200, branch_report.text
    branch_payload = branch_report.json()

    low_stock = branch_payload["low_stock"]
    best_sellers = branch_payload["best_sellers"]
    assert low_stock[0]["name"] == "Milk 500ml"
    assert low_stock[0]["stock"] == "4.000"
    assert low_stock[0]["status"] == "low"
    assert best_sellers[0]["name"] == "Milk 500ml"
    assert best_sellers[0]["quantity_sold"] == "96.000"
    assert best_sellers[0]["invoices"] == 1

    sm = await login(client, "SM001", "sm123")
    team_report = await client.get("/api/v1/reports/products/insights?top=5", headers=sm)
    assert team_report.status_code == 200, team_report.text
    team_payload = team_report.json()
    assert team_payload["low_stock"][0]["name"] == "Milk 500ml"
    assert team_payload["best_sellers"][0]["name"] == "Milk 500ml"


async def test_checkout_public_invoice_url_uses_configured_public_base(client, monkeypatch):
    monkeypatch.setattr(settings, "INVOICE_PUBLIC_BASE_URL", "https://pos.example.com")
    monkeypatch.setattr(settings, "INVOICE_LINK_EXPIRY_HOURS", 24)
    sp = await login(client, "SP001", "sp123")
    cart = await client.post("/api/v1/pos/cart", headers=sp, json={})
    assert cart.status_code == 201, cart.text
    order_id = cart.json()["order_id"]

    scan = await client.post(
        f"/api/v1/pos/cart/{order_id}/scan",
        headers=sp,
        json={"barcode": "BC-MILK", "quantity": 1},
    )
    assert scan.status_code == 200, scan.text

    checkout = await client.post(
        f"/api/v1/pos/cart/{order_id}/checkout",
        headers=sp,
        json={"payment_method": "cash"},
    )
    assert checkout.status_code == 200, checkout.text
    public_url = checkout.json()["public_invoice_url"]
    assert public_url.startswith("https://pos.example.com/invoice/view/")

    token = public_url.rsplit("/", 1)[-1]
    public_invoice = await client.get(f"/api/v1/public/invoices/{token}")
    assert public_invoice.status_code == 200, public_invoice.text
    public_payload = public_invoice.json()
    assert public_payload["invoice_number"] == checkout.json()["invoice_number"]
    assert public_payload["qr_value"].startswith("https://pos.example.com/invoice/view/")
    assert public_payload["expires_at"]


async def test_numeric_barcode_scans_as_barcode_not_product_id(client):
    bm = await login(client, "BM001", "bm123")
    sp = await login(client, "SP001", "sp123")

    created = await client.post(
        "/api/v1/products",
        headers=bm,
        json={
            "sku": "SKU-NUMERIC-BARCODE",
            "name": "Numeric Barcode Product",
            "category": "Groceries",
            "supplier": "Acme",
            "barcode": "2900000000001",
            "mrp": 80,
            "buy_price": 60,
            "sell_price": 75,
            "gst_rate": 5,
            "qty_bought": 25,
            "reorder_level": 5,
        },
    )
    assert created.status_code == 201, created.text
    product = created.json()

    listed = await client.get("/api/v1/products?q=2900000000001", headers=sp)
    assert listed.status_code == 200, listed.text
    assert any(row["id"] == product["id"] for row in listed.json())

    cart = await client.post("/api/v1/pos/cart", headers=sp, json={})
    order_id = cart.json()["order_id"]
    scanned = await client.post(
        f"/api/v1/pos/cart/{order_id}/scan",
        headers=sp,
        json={"barcode": "2900000000001", "quantity": 2},
    )
    assert scanned.status_code == 200, scanned.text
    line = scanned.json()
    assert line["product_id"] == product["id"]
    assert line["product_name"] == "Numeric Barcode Product"


async def test_pos_active_draft_resume_and_idempotent_start_cart(client):
    sp = await login(client, "SP001", "sp123")

    active = await client.get("/api/v1/pos/cart/active", headers=sp)
    assert active.status_code == 200, active.text
    assert active.json() is None

    first = await client.post("/api/v1/pos/cart", headers=sp, json={})
    assert first.status_code == 201, first.text
    order_id = first.json()["order_id"]

    duplicate = await client.post("/api/v1/pos/cart", headers=sp, json={})
    assert duplicate.status_code == 201, duplicate.text
    assert duplicate.json()["order_id"] == order_id

    scan = await client.post(
        f"/api/v1/pos/cart/{order_id}/scan",
        headers=sp,
        json={"barcode": "BC-MILK", "quantity": 1},
    )
    assert scan.status_code == 200, scan.text

    resumed_after_navigation = await client.get("/api/v1/pos/cart/active", headers=sp)
    assert resumed_after_navigation.status_code == 200, resumed_after_navigation.text
    resumed_payload = resumed_after_navigation.json()
    assert resumed_payload["order_id"] == order_id
    assert len(resumed_payload["lines"]) == 1

    resumed_after_refresh = await client.get("/api/v1/pos/cart/active", headers=sp)
    assert resumed_after_refresh.status_code == 200, resumed_after_refresh.text
    assert resumed_after_refresh.json()["order_id"] == order_id

    checkout = await client.post(
        f"/api/v1/pos/cart/{order_id}/checkout",
        headers=sp,
        json={"payment_method": "cash"},
    )
    assert checkout.status_code == 200, checkout.text

    completed_active = await client.get("/api/v1/pos/cart/active", headers=sp)
    assert completed_active.status_code == 200, completed_active.text
    assert completed_active.json() is None

    stale_totals = await client.get(f"/api/v1/pos/cart/{order_id}/totals", headers=sp)
    assert stale_totals.status_code == 400
    assert "Cart is no longer editable" in stale_totals.text

    stale_scan = await client.post(
        f"/api/v1/pos/cart/{order_id}/scan",
        headers=sp,
        json={"barcode": "BC-MILK", "quantity": 1},
    )
    assert stale_scan.status_code == 400
    assert "Cart is no longer editable" in stale_scan.text

    fresh = await client.post("/api/v1/pos/cart", headers=sp, json={})
    assert fresh.status_code == 201, fresh.text
    fresh_id = fresh.json()["order_id"]
    assert fresh_id != order_id

    duplicate_fresh = await client.post("/api/v1/pos/cart", headers=sp, json={})
    assert duplicate_fresh.status_code == 201, duplicate_fresh.text
    assert duplicate_fresh.json()["order_id"] == fresh_id


async def test_pos_duplicate_scan_merges_and_quantity_update_validates_stock(client):
    bm = await login(client, "BM001", "bm123")
    discount = await client.post(
        "/api/v1/products/1/discounts",
        headers=bm,
        json={
            "discount_type": "percentage",
            "discount_value": 10,
            "min_quantity": 3,
        },
    )
    assert discount.status_code == 201, discount.text

    sp = await login(client, "SP001", "sp123")
    cart = await client.post("/api/v1/pos/cart", headers=sp, json={})
    assert cart.status_code == 201, cart.text
    order_id = cart.json()["order_id"]

    line = None
    for _ in range(3):
        scanned = await client.post(
            f"/api/v1/pos/cart/{order_id}/scan",
            headers=sp,
            json={"barcode": "BC-MILK", "quantity": 1},
        )
        assert scanned.status_code == 200, scanned.text
        line = scanned.json()

    assert line["quantity"] == "3.000"

    totals = await client.get(f"/api/v1/pos/cart/{order_id}/totals", headers=sp)
    assert totals.status_code == 200, totals.text
    payload = totals.json()
    assert len(payload["lines"]) == 1
    assert payload["lines"][0]["product_name"] == "Milk 500ml"
    assert payload["lines"][0]["quantity"] == "3.000"
    assert payload["totals"]["subtotal"] == "150.00"
    assert payload["totals"]["discount"] == "15.00"
    assert payload["totals"]["taxable_value"] == "135.00"
    assert payload["totals"]["cgst"] == "3.38"
    assert payload["totals"]["sgst"] == "3.37"
    assert payload["totals"]["grand_total"] == "141.75"

    item_id = payload["lines"][0]["order_item_id"]
    updated = await client.patch(
        f"/api/v1/pos/cart/{order_id}/items/{item_id}",
        headers=sp,
        json={"quantity": 4},
    )
    assert updated.status_code == 200, updated.text
    updated_payload = updated.json()
    assert updated_payload["lines"][0]["quantity"] == "4.000"
    assert updated_payload["totals"]["subtotal"] == "200.00"
    assert updated_payload["totals"]["discount"] == "20.00"
    assert updated_payload["totals"]["taxable_value"] == "180.00"
    assert updated_payload["totals"]["grand_total"] == "189.00"

    blocked = await client.patch(
        f"/api/v1/pos/cart/{order_id}/items/{item_id}",
        headers=sp,
        json={"quantity": 101},
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "INSUFFICIENT_STOCK"

    removed = await client.delete(f"/api/v1/pos/cart/{order_id}/items/{item_id}", headers=sp)
    assert removed.status_code == 200, removed.text
    removed_payload = removed.json()
    assert removed_payload["lines"] == []
    assert removed_payload["totals"]["subtotal"] == "0.00"
    assert removed_payload["totals"]["discount"] == "0.00"
    assert removed_payload["totals"]["taxable_value"] == "0.00"
    assert removed_payload["totals"]["grand_total"] == "0.00"


async def test_pos_scan_applies_fixed_product_discount(client):
    bm = await login(client, "BM001", "bm123")
    discount = await client.post(
        "/api/v1/products/1/discounts",
        headers=bm,
        json={
            "discount_type": "fixed",
            "discount_value": 5,
            "min_quantity": 1,
            "start_date": date.today().isoformat(),
            "end_date": date.today().isoformat(),
        },
    )
    assert discount.status_code == 201, discount.text

    sp = await login(client, "SP001", "sp123")
    cart = await client.post("/api/v1/pos/cart", headers=sp, json={})
    assert cart.status_code == 201, cart.text
    order_id = cart.json()["order_id"]

    scanned = await client.post(
        f"/api/v1/pos/cart/{order_id}/scan",
        headers=sp,
        json={"barcode": "BC-MILK", "quantity": 2},
    )
    assert scanned.status_code == 200, scanned.text
    assert scanned.json()["discount_pct"] == "10.00"
    assert scanned.json()["discount_type"] == "fixed"
    assert scanned.json()["discount_label"] == "Rs 5.00 off"

    totals = await client.get(f"/api/v1/pos/cart/{order_id}/totals", headers=sp)
    assert totals.status_code == 200, totals.text
    payload = totals.json()
    assert payload["lines"][0]["discount_pct"] == "10.00"
    assert payload["lines"][0]["discount_label"] == "Rs 5.00 off"
    assert payload["totals"]["subtotal"] == "100.00"
    assert payload["totals"]["discount"] == "10.00"
    assert payload["totals"]["taxable_value"] == "90.00"
    assert payload["totals"]["grand_total"] == "94.50"


async def test_pos_draft_can_be_cancelled_and_recovered(client):
    sp = await login(client, "SP001", "sp123")
    cart = await client.post("/api/v1/pos/cart", headers=sp, json={})
    assert cart.status_code == 201, cart.text
    order_id = cart.json()["order_id"]

    cancelled = await client.post(f"/api/v1/pos/cart/{order_id}/cancel", headers=sp)
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "Cancelled"

    active = await client.get("/api/v1/pos/cart/active", headers=sp)
    assert active.status_code == 200, active.text
    assert active.json() is None

    stale_scan = await client.post(
        f"/api/v1/pos/cart/{order_id}/scan",
        headers=sp,
        json={"barcode": "BC-MILK", "quantity": 1},
    )
    assert stale_scan.status_code == 400
    assert stale_scan.json()["error"]["code"] == "CART_NOT_EDITABLE"

    recovered = await client.post("/api/v1/pos/cart", headers=sp, json={})
    assert recovered.status_code == 201, recovered.text
    assert recovered.json()["order_id"] != order_id


async def test_pos_draft_can_be_voided_and_recovered(client):
    sp = await login(client, "SP001", "sp123")
    cart = await client.post("/api/v1/pos/cart", headers=sp, json={})
    assert cart.status_code == 201, cart.text
    order_id = cart.json()["order_id"]

    voided = await client.post(f"/api/v1/pos/cart/{order_id}/void", headers=sp)
    assert voided.status_code == 200, voided.text
    assert voided.json()["status"] == "Cancelled"

    recovered = await client.post("/api/v1/pos/cart", headers=sp, json={})
    assert recovered.status_code == 201, recovered.text
    assert recovered.json()["order_id"] != order_id


async def test_pos_expired_draft_is_not_restored_and_recovery_creates_new_cart(client, seeded):
    sp = await login(client, "SP001", "sp123")
    cart = await client.post("/api/v1/pos/cart", headers=sp, json={})
    assert cart.status_code == 201, cart.text
    order_id = cart.json()["order_id"]

    async with seeded() as db:
        order = await db.get(Order, order_id)
        order.expires_at = datetime.utcnow() - timedelta(minutes=1)
        await db.commit()

    stale_totals = await client.get(f"/api/v1/pos/cart/{order_id}/totals", headers=sp)
    assert stale_totals.status_code == 400
    assert stale_totals.json()["error"]["code"] == "CART_NOT_EDITABLE"

    active = await client.get("/api/v1/pos/cart/active", headers=sp)
    assert active.status_code == 200, active.text
    assert active.json() is None

    async with seeded() as db:
        order = await db.get(Order, order_id)
        assert order.status == "Expired"

    recovered = await client.post("/api/v1/pos/cart", headers=sp, json={})
    assert recovered.status_code == 201, recovered.text
    assert recovered.json()["order_id"] != order_id


async def test_pos_attach_customer_handles_timezone_aware_cart_expiry(client, seeded):
    sp = await login(client, "SP001", "sp123")
    customer = await client.post(
        "/api/v1/customers",
        headers=sp,
        json={"phone": "9000007777", "name": "Aware Expiry Guest"},
    )
    assert customer.status_code == 201, customer.text

    cart = await client.post("/api/v1/pos/cart", headers=sp, json={})
    assert cart.status_code == 201, cart.text
    order_id = cart.json()["order_id"]

    async with seeded() as db:
        order = await db.get(Order, order_id)
        order.expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
        await db.commit()

    attach = await client.patch(
        f"/api/v1/pos/cart/{order_id}/customer",
        headers=sp,
        json={"customer_id": customer.json()["id"]},
    )
    assert attach.status_code == 200, attach.text
    async with seeded() as db:
        order = await db.get(Order, order_id)
        assert order.customer_id == customer.json()["id"]


async def test_pos_cleanup_expires_abandoned_drafts(client, seeded):
    sp = await login(client, "SP001", "sp123")
    cart = await client.post("/api/v1/pos/cart", headers=sp, json={})
    assert cart.status_code == 201, cart.text
    order_id = cart.json()["order_id"]

    async with seeded() as db:
        order = await db.get(Order, order_id)
        order.expires_at = datetime.utcnow() - timedelta(minutes=5)
        await db.commit()

    cleanup = await client.post("/api/v1/pos/cart/cleanup", headers=sp)
    assert cleanup.status_code == 200, cleanup.text
    assert cleanup.json()["expired"] == 1

    async with seeded() as db:
        order = await db.get(Order, order_id)
        assert order.status == "Expired"

    active = await client.get("/api/v1/pos/cart/active", headers=sp)
    assert active.status_code == 200, active.text
    assert active.json() is None


async def test_pos_same_cashier_same_terminal_renews_cart_lease(client, seeded):
    sp = await login(client, "SP001", "sp123")
    terminal = {"X-Terminal-Id": "TERM-A"}
    headers = {**sp, **terminal}

    cart = await client.post("/api/v1/pos/cart", headers=headers, json={})
    assert cart.status_code == 201, cart.text
    order_id = cart.json()["order_id"]

    active = await client.get("/api/v1/pos/cart/active", headers=headers)
    assert active.status_code == 200, active.text
    assert active.json()["order_id"] == order_id
    assert active.json()["terminal_id"] == "TERM-A"

    async with seeded() as db:
        order = await db.get(Order, order_id)
        first_lease = order.lease_expires_at
        order.lease_expires_at = datetime.utcnow() - timedelta(seconds=1)
        await db.commit()

    reconnected = await client.get("/api/v1/pos/cart/active", headers=headers)
    assert reconnected.status_code == 200, reconnected.text
    assert reconnected.json()["order_id"] == order_id

    async with seeded() as db:
        order = await db.get(Order, order_id)
        assert order.terminal_id == "TERM-A"
        assert order.lease_expires_at > first_lease


async def test_pos_multiple_browsers_cannot_edit_same_active_cart(client):
    sp = await login(client, "SP001", "sp123")
    terminal_a = {**sp, "X-Terminal-Id": "TERM-A"}
    terminal_b = {**sp, "X-Terminal-Id": "TERM-B"}

    cart = await client.post("/api/v1/pos/cart", headers=terminal_a, json={})
    assert cart.status_code == 201, cart.text
    order_id = cart.json()["order_id"]

    blocked = await client.get("/api/v1/pos/cart/active", headers=terminal_b)
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "CART_LEASE_HELD"
    assert blocked.json()["message"] == "This cart is already active on Terminal TERM-A"
    assert blocked.json()["details"]["order_id"] == order_id
    assert blocked.json()["details"]["terminal_id"] == "TERM-A"
    assert blocked.json()["details"]["retry_after_seconds"] > 0

    stale_edit = await client.post(
        f"/api/v1/pos/cart/{order_id}/scan",
        headers=terminal_b,
        json={"barcode": "BC-MILK", "quantity": 1},
    )
    assert stale_edit.status_code == 409
    assert stale_edit.json()["error"]["code"] == "CART_LEASE_HELD"


async def test_pos_cart_lease_has_dedicated_renewal_endpoint(client, seeded):
    sp = await login(client, "SP001", "sp123")
    headers = {**sp, "X-Terminal-Id": "TERM-A"}

    cart = await client.post("/api/v1/pos/cart", headers=headers, json={})
    assert cart.status_code == 201, cart.text
    order_id = cart.json()["order_id"]

    async with seeded() as db:
        order = await db.get(Order, order_id)
        first_lease = order.lease_expires_at

    renewed = await client.post(
        f"/api/v1/pos/cart/{order_id}/lease/renew",
        headers=headers,
    )
    assert renewed.status_code == 200, renewed.text
    assert renewed.json()["order_id"] == order_id

    async with seeded() as db:
        order = await db.get(Order, order_id)
        assert order.lease_expires_at > first_lease


async def test_pos_lease_timeout_allows_another_terminal_to_reclaim(client, seeded):
    sp = await login(client, "SP001", "sp123")
    terminal_a = {**sp, "X-Terminal-Id": "TERM-A"}
    terminal_b = {**sp, "X-Terminal-Id": "TERM-B"}

    cart = await client.post("/api/v1/pos/cart", headers=terminal_a, json={})
    assert cart.status_code == 201, cart.text
    order_id = cart.json()["order_id"]

    async with seeded() as db:
        order = await db.get(Order, order_id)
        order.lease_expires_at = datetime.utcnow() - timedelta(seconds=1)
        await db.commit()

    reclaimed = await client.get("/api/v1/pos/cart/active", headers=terminal_b)
    assert reclaimed.status_code == 200, reclaimed.text
    assert reclaimed.json()["order_id"] == order_id
    assert reclaimed.json()["terminal_id"] == "TERM-B"

    async with seeded() as db:
        order = await db.get(Order, order_id)
        assert order.terminal_id == "TERM-B"
        assert order.lease_expires_at > datetime.utcnow()


async def test_pos_reconnect_after_another_terminal_claims_requires_new_lease(client, seeded):
    sp = await login(client, "SP001", "sp123")
    terminal_a = {**sp, "X-Terminal-Id": "TERM-A"}
    terminal_b = {**sp, "X-Terminal-Id": "TERM-B"}

    cart = await client.post("/api/v1/pos/cart", headers=terminal_a, json={})
    assert cart.status_code == 201, cart.text
    order_id = cart.json()["order_id"]

    async with seeded() as db:
        order = await db.get(Order, order_id)
        order.lease_expires_at = datetime.utcnow() - timedelta(seconds=1)
        await db.commit()

    claimed = await client.get("/api/v1/pos/cart/active", headers=terminal_b)
    assert claimed.status_code == 200, claimed.text

    blocked_reconnect = await client.post(
        f"/api/v1/pos/cart/{order_id}/scan",
        headers=terminal_a,
        json={"barcode": "BC-MILK", "quantity": 1},
    )
    assert blocked_reconnect.status_code == 409
    assert blocked_reconnect.json()["error"]["code"] == "CART_LEASE_HELD"


async def test_numeric_barcode_takes_precedence_over_legacy_product_id_scan(client):
    bm = await login(client, "BM001", "bm123")
    sp = await login(client, "SP001", "sp123")

    created = await client.post(
        "/api/v1/products",
        headers=bm,
        json={
            "sku": "SKU-BARCODE-ONE",
            "name": "Barcode One Product",
            "category": "Groceries",
            "supplier": "Acme",
            "barcode": "1",
            "mrp": 45,
            "buy_price": 30,
            "sell_price": 40,
            "gst_rate": 5,
            "qty_bought": 10,
            "reorder_level": 2,
        },
    )
    assert created.status_code == 201, created.text
    product = created.json()

    cart = await client.post("/api/v1/pos/cart", headers=sp, json={})
    order_id = cart.json()["order_id"]
    scanned = await client.post(
        f"/api/v1/pos/cart/{order_id}/scan",
        headers=sp,
        json={"barcode": "1", "quantity": 1},
    )
    assert scanned.status_code == 200, scanned.text
    line = scanned.json()
    assert line["product_id"] == product["id"]
    assert line["product_name"] == "Barcode One Product"


async def test_sales_person_sees_only_own_invoices(client):
    sp = await login(client, "SP001", "sp123")
    r = await client.get("/api/v1/invoices", headers=sp)
    assert r.status_code == 200


async def test_revenue_report_returns_enriched_role_scoped_staff(client):
    sm = await login(client, "SM001", "sm123")
    created = await client.post(
        "/api/v1/staff",
        headers=sm,
        json={
            "role": "sales_person",
            "employee_code": "SP200",
            "full_name": "Arjun Kumar",
            "phone": "9876543210",
            "password": "Secret@123",
        },
    )
    assert created.status_code == 201, created.text

    sp = await login(client, "SP001", "sp123")
    cart = await client.post("/api/v1/pos/cart", headers=sp, json={})
    order_id = cart.json()["order_id"]
    await client.post(
        f"/api/v1/pos/cart/{order_id}/scan",
        headers=sp,
        json={"barcode": "BC-MILK", "quantity": 1},
    )
    checkout = await client.post(
        f"/api/v1/pos/cart/{order_id}/checkout",
        headers=sp,
        json={"payment_method": "cash"},
    )
    assert checkout.status_code == 200, checkout.text

    sm_report = await client.get("/api/v1/reports/revenue", headers=sm)
    assert sm_report.status_code == 200, sm_report.text
    sm_payload = sm_report.json()
    assert sm_payload["scope"] == "sales_manager"
    assert sm_payload["managers"] == []
    staff_by_code = {row["employee_id"]: row for row in sm_payload["staff"]}
    staff_row = staff_by_code["SP001"]
    assert "staff_id" not in staff_row
    assert staff_row["employee_code"] == "SP001"
    assert staff_row["employee_name"] == "SP"
    assert staff_row["full_name"] == "SP"
    assert staff_row["role"] == "sales_person"
    assert staff_row["total_bills"] >= 1
    assert staff_row["total_invoices"] >= 1
    assert float(staff_row["total_revenue"]) >= 52.5
    assert staff_row["active"] is True
    assert staff_row["status"] == "active"
    assert staff_row["avatar_initials"] == "SP"
    assert "average_bill" not in staff_row
    assert "last_invoice" not in staff_row
    assert "total_returns" not in staff_row

    new_staff_row = staff_by_code["SP200"]
    assert new_staff_row["employee_name"] == "Arjun Kumar"
    assert new_staff_row["full_name"] == "Arjun Kumar"
    assert new_staff_row["phone_number"] == "9876543210"
    assert new_staff_row["phone"] == "9876543210"
    assert new_staff_row["total_bills"] == 0
    assert new_staff_row["total_invoices"] == 0
    assert float(new_staff_row["total_revenue"]) == 0
    assert new_staff_row["avatar_initials"] == "AK"

    bm = await login(client, "BM001", "bm123")
    bm_report = await client.get("/api/v1/reports/revenue", headers=bm)
    assert bm_report.status_code == 200, bm_report.text
    bm_payload = bm_report.json()
    assert bm_payload["scope"] == "branch_manager"
    assert bm_payload["staff"] == []
    manager = bm_payload["managers"][0]
    assert manager["manager"]["employee_id"] == "SM001"
    branch_staff_by_code = {row["employee_id"]: row for row in manager["sales_persons"]}
    assert branch_staff_by_code["SP001"]["employee_code"] == "SP001"
    assert branch_staff_by_code["SP200"]["phone"] == "9876543210"


async def test_invoice_branding_settings_are_header_only(client):
    bm = await login(client, "BM001", "bm123")

    update = await client.put(
        "/api/v1/settings/invoice-branding",
        headers=bm,
        json={
            "company_name": "Demo Retail Header",
            "watermark_enabled": True,
            "watermark_opacity": 30,
        },
    )
    assert update.status_code == 200, update.text
    assert update.json() == {"company_name": "Demo Retail Header"}

    current = await client.get("/api/v1/settings/invoice-branding", headers=bm)
    assert current.status_code == 200, current.text
    assert current.json() == {"company_name": "Demo Retail Header"}


async def test_customer_create_requires_valid_phone_and_name(client):
    sp = await login(client, "SP001", "sp123")

    valid = await client.post(
        "/api/v1/customers",
        headers=sp,
        json={"phone": "90000 01111", "name": "Counter Guest"},
    )
    assert valid.status_code == 201, valid.text
    assert valid.json()["phone"] == "9000001111"
    assert valid.json()["name"] == "Counter Guest"

    invalid = await client.post(
        "/api/v1/customers",
        headers=sp,
        json={"phone": "98765", "name": "A"},
    )
    assert invalid.status_code == 422


async def test_sales_manager_can_create_customer(client):
    sm = await login(client, "SM001", "sm123")
    customer = await client.post(
        "/api/v1/customers",
        headers=sm,
        json={"phone": "9000003333", "name": "Manager Guest"},
    )
    assert customer.status_code == 201, customer.text


async def test_customer_phone_duplicate_is_rejected_when_phone_present(client):
    sp = await login(client, "SP001", "sp123")
    payload = {"phone": "9000002222", "name": "First"}

    first = await client.post("/api/v1/customers", headers=sp, json=payload)
    assert first.status_code == 201, first.text

    duplicate = await client.post(
        "/api/v1/customers",
        headers=sp,
        json={**payload, "name": "Second"},
    )
    assert duplicate.status_code == 409


async def test_cart_customer_can_be_attached_after_scan(client, monkeypatch):
    monkeypatch.setattr(settings, "SMS_ENABLED", True)
    monkeypatch.setattr(settings, "TWILIO_ENABLED", False)
    monkeypatch.setattr(settings, "WHATSAPP_ENABLED", False)

    sp = await login(client, "SP001", "sp123")
    customer = await client.post(
        "/api/v1/customers",
        headers=sp,
        json={"phone": "9000004444", "name": "Attached Guest"},
    )
    assert customer.status_code == 201, customer.text

    cart = await client.post("/api/v1/pos/cart", headers=sp, json={})
    order_id = cart.json()["order_id"]
    scan = await client.post(
        f"/api/v1/pos/cart/{order_id}/scan",
        headers=sp,
        json={"barcode": "BC-MILK", "quantity": 1},
    )
    assert scan.status_code == 200, scan.text

    attach = await client.patch(
        f"/api/v1/pos/cart/{order_id}/customer",
        headers=sp,
        json={"customer_id": customer.json()["id"]},
    )
    assert attach.status_code == 200, attach.text

    checkout = await client.post(
        f"/api/v1/pos/cart/{order_id}/checkout",
        headers=sp,
        json={"payment_method": "cash"},
    )
    assert checkout.status_code == 200, checkout.text
    invoice = checkout.json()
    assert invoice["customer_id"] == customer.json()["id"]
    assert invoice["customer_phone"] == "9000004444"
    assert invoice["party_name"] == "Attached Guest"
    assert invoice["notification_status"] == {"sms": "queued", "whatsapp": "skipped"}

    detail = await client.get(f"/api/v1/invoices/{invoice['id']}", headers=sp)
    assert detail.status_code == 200, detail.text
    assert detail.json()["customer_phone"] == "9000004444"

    history = await client.get("/api/v1/invoices?limit=12", headers=sp)
    assert history.status_code == 200, history.text
    history_invoice = next(row for row in history.json() if row["id"] == invoice["id"])
    assert history_invoice["customer_phone"] == "9000004444"

    notifications = await client.get(f"/api/v1/invoices/{invoice['id']}/notifications", headers=sp)
    assert notifications.status_code == 200, notifications.text
    sms = next(row for row in notifications.json() if row["channel"] == "sms")
    assert sms["status"] == "queued"

    retry = await client.post(
        f"/api/v1/invoices/{invoice['id']}/notifications/resend",
        headers=sp,
        json={"channel": "sms"},
    )
    assert retry.status_code == 200, retry.text
    assert retry.json()["channel"] == "sms"
    assert retry.json()["status"] == "queued"


async def test_duplicate_checkout_with_same_idempotency_key_replays_invoice(client):
    sp = await login(client, "SP001", "sp123")
    cart = await client.post("/api/v1/pos/cart", headers=sp, json={})
    order_id = cart.json()["order_id"]
    scan = await client.post(
        f"/api/v1/pos/cart/{order_id}/scan",
        headers=sp,
        json={"barcode": "BC-MILK", "quantity": 1},
    )
    assert scan.status_code == 200, scan.text

    headers = {**sp, "Idempotency-Key": f"test-checkout-{order_id}"}
    first = await client.post(
        f"/api/v1/pos/cart/{order_id}/checkout",
        headers=headers,
        json={"payment_method": "cash"},
    )
    assert first.status_code == 200, first.text

    replay = await client.post(
        f"/api/v1/pos/cart/{order_id}/checkout",
        headers=headers,
        json={"payment_method": "cash"},
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["id"] == first.json()["id"]
    assert replay.json()["invoice_number"] == first.json()["invoice_number"]
    async with client.test_session_factory() as session:
        ledger_count = await session.scalar(
            select(func.count(InventoryLedger.id)).where(
                InventoryLedger.type == "SALE",
                InventoryLedger.source == "POS",
                InventoryLedger.reference_type == "invoice",
                InventoryLedger.reference_id == str(first.json()["id"]),
            )
        )
    assert ledger_count == 1


async def checkout_seeded_cart(client, headers, payload):
    cart = await client.post("/api/v1/pos/cart", headers=headers, json={})
    assert cart.status_code == 201, cart.text
    order_id = cart.json()["order_id"]
    scan = await client.post(
        f"/api/v1/pos/cart/{order_id}/scan",
        headers=headers,
        json={"barcode": "BC-MILK", "quantity": 1},
    )
    assert scan.status_code == 200, scan.text
    checkout = await client.post(
        f"/api/v1/pos/cart/{order_id}/checkout",
        headers=headers,
        json=payload,
    )
    return checkout


async def test_checkout_cash_received_and_change_due(client):
    sp = await login(client, "SP001", "sp123")
    checkout = await checkout_seeded_cart(
        client,
        sp,
        {"payment_method": "cash", "cash_received": 60},
    )
    assert checkout.status_code == 200, checkout.text
    invoice = checkout.json()
    assert invoice["status"] == "Paid"
    assert invoice["amount_paid"] == "52.50"
    assert invoice["change_due"] == "7.50"
    assert invoice["balance_due"] == "0.00"
    assert invoice["payments"][0]["method"] == "cash"
    assert invoice["payments"][0]["amount"] == "60.00"


@pytest.mark.parametrize(
    ("method", "reference_field", "reference"),
    [
        ("upi", "upi_reference", "UPI123"),
        ("card", "card_reference", "CARD123"),
        ("cheque", "cheque_reference", "CHQ123"),
    ],
)
async def test_checkout_reference_payment_types(client, method, reference_field, reference):
    sp = await login(client, "SP001", "sp123")
    checkout = await checkout_seeded_cart(
        client,
        sp,
        {"payment_method": method, reference_field: reference},
    )
    assert checkout.status_code == 200, checkout.text
    invoice = checkout.json()
    assert invoice["payment_method"] == method
    assert invoice["status"] == "Paid"
    assert invoice["payments"][0]["method"] == method
    assert invoice["payments"][0]["reference_no"] == reference


async def test_checkout_split_payments(client):
    sp = await login(client, "SP001", "sp123")
    checkout = await checkout_seeded_cart(
        client,
        sp,
        {
            "payment_method": "split",
            "payments": [
                {"method": "cash", "amount": 30},
                {"method": "upi", "amount": 22.5, "reference_no": "UPI-SPLIT"},
            ],
        },
    )
    assert checkout.status_code == 200, checkout.text
    invoice = checkout.json()
    assert invoice["payment_method"] == "split"
    assert invoice["status"] == "Paid"
    assert invoice["amount_paid"] == "52.50"
    assert [p["method"] for p in invoice["payments"]] == ["cash", "upi"]


async def test_checkout_partial_payment(client):
    sp = await login(client, "SP001", "sp123")
    checkout = await checkout_seeded_cart(
        client,
        sp,
        {"payment_method": "cash", "cash_received": 20, "allow_partial": True},
    )
    assert checkout.status_code == 200, checkout.text
    invoice = checkout.json()
    assert invoice["status"] == "Partially Paid"
    assert invoice["amount_paid"] == "20.00"
    assert invoice["balance_due"] == "32.50"
    assert invoice["change_due"] == "0.00"


async def test_checkout_payment_validation(client):
    sp = await login(client, "SP001", "sp123")
    missing_reference = await checkout_seeded_cart(
        client,
        sp,
        {"payment_method": "upi"},
    )
    assert missing_reference.status_code == 400
    assert missing_reference.json()["error"]["code"] == "PAYMENT_REFERENCE_REQUIRED"

    sp = await login(client, "SP001", "sp123")
    insufficient = await checkout_seeded_cart(
        client,
        sp,
        {"payment_method": "cash", "cash_received": 20},
    )
    assert insufficient.status_code == 400
    assert insufficient.json()["error"]["code"] == "PAYMENT_INSUFFICIENT"


async def test_return_lookup_finds_invoice_containing_barcode(client):
    sp = await login(client, "SP001", "sp123")
    r = await client.post("/api/v1/pos/cart", headers=sp, json={})
    order_id = r.json()["order_id"]
    r = await client.post(
        f"/api/v1/pos/cart/{order_id}/scan",
        headers=sp,
        json={"barcode": "BC-MILK", "quantity": 1},
    )
    assert r.status_code == 200, r.text
    checkout = await client.post(
        f"/api/v1/pos/cart/{order_id}/checkout",
        headers=sp,
        json={"payment_method": "cash"},
    )
    assert checkout.status_code == 200, checkout.text

    lookup = await client.post(
        "/api/v1/returns/lookup",
        headers=sp,
        json={"barcode": "BC-MILK"},
    )
    assert lookup.status_code == 200, lookup.text
    assert lookup.json()["id"] == checkout.json()["id"]


async def test_return_quantity_cannot_exceed_original_sale(client):
    sp = await login(client, "SP001", "sp123")
    r = await client.post("/api/v1/pos/cart", headers=sp, json={})
    order_id = r.json()["order_id"]
    r = await client.post(
        f"/api/v1/pos/cart/{order_id}/scan",
        headers=sp,
        json={"barcode": "BC-MILK", "quantity": 1},
    )
    assert r.status_code == 200, r.text
    checkout = await client.post(
        f"/api/v1/pos/cart/{order_id}/checkout",
        headers=sp,
        json={"payment_method": "cash"},
    )
    assert checkout.status_code == 200, checkout.text

    ret = await client.post(
        "/api/v1/returns",
        headers=sp,
        json={
            "original_invoice_id": checkout.json()["id"],
            "reason": "damaged",
            "resolution": "refund",
            "refund_method": "cash",
            "items": [
                {
                    "product_id": 1,
                    "quantity": 2,
                    "rate": 50,
                    "discount": 0,
                    "gst_rate": 5,
                }
            ],
        },
    )
    assert ret.status_code == 400
    assert ret.json()["success"] is False


async def test_wrong_product_return_restores_sellable_stock_on_approval(client):
    sp = await login(client, "SP001", "sp123")
    cart = await client.post("/api/v1/pos/cart", headers=sp, json={})
    order_id = cart.json()["order_id"]
    scan = await client.post(
        f"/api/v1/pos/cart/{order_id}/scan",
        headers=sp,
        json={"barcode": "BC-MILK", "quantity": 1},
    )
    assert scan.status_code == 200, scan.text
    checkout = await client.post(
        f"/api/v1/pos/cart/{order_id}/checkout",
        headers=sp,
        json={"payment_method": "cash"},
    )
    assert checkout.status_code == 200, checkout.text
    invoice = checkout.json()
    invoice_item_id = invoice["items"][0]["id"]

    submitted = await client.post(
        "/api/v1/returns",
        headers=sp,
        json={
            "original_invoice_id": invoice["id"],
            "reason": "wrong_product",
            "resolution": "refund",
            "refund_method": "cash",
            "items": [
                {
                    "invoice_item_id": invoice_item_id,
                    "quantity": 1,
                    "damage_type": "wrong_product",
                }
            ],
        },
    )
    assert submitted.status_code == 201, submitted.text
    return_id = submitted.json()["id"]

    bm = await login(client, "BM001", "bm123")
    verified = await client.patch(
        f"/api/v1/returns/{return_id}/status",
        headers=bm,
        json={"status": "verified"},
    )
    assert verified.status_code == 200, verified.text
    approved = await client.patch(
        f"/api/v1/returns/{return_id}/status",
        headers=bm,
        json={"status": "approved"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert approved.json()["refund_status"] == "initiated"

    processed = await client.post(f"/api/v1/returns/{return_id}/process", headers=bm)
    assert processed.status_code == 200, processed.text
    assert processed.json()["status"] == "completed"
    assert processed.json()["refund_status"] == "completed"

    product = await client.get("/api/v1/products/1", headers=bm)
    assert product.status_code == 200, product.text
    product_payload = product.json()
    assert product_payload["stock_cached"] == "100.000"
    assert product_payload["qty_returned"] == "1.000"
    assert product_payload["damaged_qty"] == "0.000"


async def test_return_evidence_qr_link_accepts_public_image_upload(client):
    sp = await login(client, "SP001", "sp123")
    cart = await client.post("/api/v1/pos/cart", headers=sp, json={})
    order_id = cart.json()["order_id"]
    scan = await client.post(
        f"/api/v1/pos/cart/{order_id}/scan",
        headers=sp,
        json={"barcode": "BC-MILK", "quantity": 1},
    )
    assert scan.status_code == 200, scan.text
    checkout = await client.post(
        f"/api/v1/pos/cart/{order_id}/checkout",
        headers=sp,
        json={"payment_method": "cash"},
    )
    assert checkout.status_code == 200, checkout.text
    invoice = checkout.json()

    submitted = await client.post(
        "/api/v1/returns",
        headers=sp,
        json={
            "original_invoice_id": invoice["id"],
            "reason": "damaged",
            "resolution": "refund",
            "refund_method": "cash",
            "items": [
                {
                    "invoice_item_id": invoice["items"][0]["id"],
                    "quantity": 1,
                    "damage_type": "damaged",
                }
            ],
        },
    )
    assert submitted.status_code == 201, submitted.text
    return_id = submitted.json()["id"]

    bm = await login(client, "BM001", "bm123")
    verified = await client.patch(
        f"/api/v1/returns/{return_id}/status",
        headers=bm,
        json={"status": "verified"},
    )
    assert verified.status_code == 200, verified.text
    assert verified.json()["evidence_required"] is True

    blocked = await client.patch(
        f"/api/v1/returns/{return_id}/status",
        headers=bm,
        json={"status": "approved"},
    )
    assert blocked.status_code == 400
    assert "Photo evidence is required" in blocked.text

    link = await client.post(f"/api/v1/returns/{return_id}/evidence-link", headers=sp)
    assert link.status_code == 200, link.text
    upload_url = link.json()["upload_url"]
    token = urlparse(upload_url).path.rsplit("/", 1)[-1]

    info = await client.get(f"/api/v1/returns/public/evidence/{token}")
    assert info.status_code == 200, info.text
    assert info.json()["return_id"] == return_id
    assert info.json()["max_upload_bytes"] == 15 * 1024 * 1024

    upload = await client.post(
        f"/api/v1/returns/public/evidence/{token}",
        files={"file": ("damage.png", b"\x89PNG\r\n\x1a\nfake", "image/png")},
        data={"note": "Broken image"},
    )
    assert upload.status_code == 400
    assert "valid JPG, PNG, or WEBP" in upload.text

    upload = await client.post(
        f"/api/v1/returns/public/evidence/{token}",
        files={"file": ("damage.png", VALID_PNG_BYTES, "image/png")},
        data={"note": "Leaking pack"},
    )
    assert upload.status_code == 201, upload.text
    assert upload.json()["return_id"] == return_id
    assert upload.json()["original_name"] == "damage.png"
    assert upload.json()["file_url"].startswith("/media/return-evidence/")

    evidence = await client.get(f"/api/v1/returns/{return_id}/evidence", headers=sp)
    assert evidence.status_code == 200, evidence.text
    assert evidence.json()[0]["note"] == "Leaking pack"
    assert evidence.json()[0]["file_url"].startswith("/media/return-evidence/")
    media = await client.get(evidence.json()[0]["file_url"])
    assert media.status_code == 200, media.text
    assert media.headers["content-type"].startswith("image/png")
    assert media.content == VALID_PNG_BYTES

    sm = await login(client, "SM001", "sm123")
    sm_returns = await client.get("/api/v1/returns", headers=sm)
    assert sm_returns.status_code == 200, sm_returns.text
    assert any(row["id"] == return_id for row in sm_returns.json())
    sm_evidence = await client.get(f"/api/v1/returns/{return_id}/evidence", headers=sm)
    assert sm_evidence.status_code == 200, sm_evidence.text
    assert sm_evidence.json()[0]["file_url"].startswith("/media/return-evidence/")

    bm_evidence = await client.get(f"/api/v1/returns/{return_id}/evidence", headers=bm)
    assert bm_evidence.status_code == 200, bm_evidence.text
    assert bm_evidence.json()[0]["file_url"].startswith("/media/return-evidence/")

    approved = await client.patch(
        f"/api/v1/returns/{return_id}/status",
        headers=bm,
        json={"status": "approved"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert approved.json()["evidence_count"] == 1
