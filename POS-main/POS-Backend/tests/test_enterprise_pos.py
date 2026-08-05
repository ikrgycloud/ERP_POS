import pytest

from tests.conftest import login

pytestmark = pytest.mark.asyncio


async def test_enterprise_shift_drawer_approval_and_timeline(client):
    sp = await login(client, "SP001", "sp123")
    bm = await login(client, "BM001", "bm123")
    terminal_headers = {**sp, "X-Terminal-Id": "TERM-TEST-1"}

    opened = await client.post(
        "/api/v1/pos/enterprise/shifts/open",
        headers=terminal_headers,
        json={"opening_cash": 500, "note": "morning"},
    )
    assert opened.status_code == 201, opened.text
    shift = opened.json()
    assert shift["status"] == "open"
    assert shift["terminal_id"] == "TERM-TEST-1"

    active = await client.get("/api/v1/pos/enterprise/shifts/active", headers=terminal_headers)
    assert active.status_code == 200, active.text
    assert active.json()["id"] == shift["id"]

    drawer = await client.post(
        "/api/v1/pos/enterprise/drawer-events",
        headers=terminal_headers,
        json={"event_type": "manual_open", "amount": 0, "reason": "no sale"},
    )
    assert drawer.status_code == 201, drawer.text
    assert drawer.json()["shift_id"] == shift["id"]

    requested = await client.post(
        "/api/v1/pos/enterprise/approvals",
        headers=terminal_headers,
        json={
            "approval_type": "discount",
            "reason": "customer goodwill",
            "payload": {"discount_pct": 10},
        },
    )
    assert requested.status_code == 201, requested.text
    approval = requested.json()
    assert approval["status"] == "pending"

    sp_blocked = await client.post(
        f"/api/v1/pos/enterprise/approvals/{approval['id']}/approve",
        headers=terminal_headers,
        json={"decision_note": "self approval"},
    )
    assert sp_blocked.status_code == 403

    approved = await client.post(
        f"/api/v1/pos/enterprise/approvals/{approval['id']}/approve",
        headers={**bm, "X-Terminal-Id": "TERM-MANAGER"},
        json={"decision_note": "ok"},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert approved.json()["approved_by_staff_id"] is not None

    timeline = await client.get("/api/v1/pos/enterprise/timeline", headers=terminal_headers)
    assert timeline.status_code == 200, timeline.text
    actions = {row["action"] for row in timeline.json()}
    assert "shift_opened" in actions
    assert "drawer_manual_open" in actions
    assert "approval_requested" in actions

    closed = await client.post(
        f"/api/v1/pos/enterprise/shifts/{shift['id']}/close",
        headers=terminal_headers,
        json={"closing_cash": 500},
    )
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "closed"


async def test_registered_terminal_requires_secret_for_cart_apis(client):
    sp = await login(client, "SP001", "sp123")
    bm = await login(client, "BM001", "bm123")

    registered = await client.post(
        "/api/v1/pos/enterprise/terminals/register",
        headers={**bm, "X-Terminal-Id": "TERM-SECURE"},
        json={"terminal_id": "TERM-SECURE", "name": "Front Counter", "secret": "terminal-secret"},
    )
    assert registered.status_code == 201, registered.text

    blocked = await client.post(
        "/api/v1/pos/cart",
        headers={**sp, "X-Terminal-Id": "TERM-SECURE"},
        json={},
    )
    assert blocked.status_code == 403

    allowed = await client.post(
        "/api/v1/pos/cart",
        headers={
            **sp,
            "X-Terminal-Id": "TERM-SECURE",
            "X-Terminal-Secret": "terminal-secret",
        },
        json={},
    )
    assert allowed.status_code == 201, allowed.text


async def test_checkout_requires_open_shift(client):
    login_response = await client.post(
        "/api/v1/auth/login",
        json={"employee_code": "SP001", "password": "sp123"},
    )
    assert login_response.status_code == 200, login_response.text
    headers = {"Authorization": f"Bearer {login_response.json()['access_token']}"}

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
        json={"payment_method": "cash", "cash_received": 100},
    )
    assert checkout.status_code == 400
    assert checkout.json()["error"]["code"] == "SHIFT_REQUIRED"


async def test_duplicate_open_shift_returns_existing_shift(client):
    sp = await login(client, "SP001", "sp123")
    headers = {**sp, "X-Terminal-Id": "TERM-SHIFT"}
    first = await client.post(
        "/api/v1/pos/enterprise/shifts/open",
        headers=headers,
        json={"opening_cash": 100},
    )
    duplicate = await client.post(
        "/api/v1/pos/enterprise/shifts/open",
        headers=headers,
        json={"opening_cash": 200},
    )
    assert first.status_code in {200, 201}, first.text
    assert duplicate.status_code in {200, 201}, duplicate.text
    assert duplicate.json()["id"] == first.json()["id"]


async def test_non_empty_void_requires_manager_approval(client):
    sp = await login(client, "SP001", "sp123")
    bm = await login(client, "BM001", "bm123")
    cart = await client.post("/api/v1/pos/cart", headers=sp, json={})
    assert cart.status_code == 201, cart.text
    order_id = cart.json()["order_id"]
    scan = await client.post(
        f"/api/v1/pos/cart/{order_id}/scan",
        headers=sp,
        json={"barcode": "BC-MILK", "quantity": 1},
    )
    assert scan.status_code == 200, scan.text

    blocked = await client.post(f"/api/v1/pos/cart/{order_id}/void", headers=sp)
    assert blocked.status_code == 400
    assert blocked.json()["error"]["code"] == "APPROVAL_REQUIRED"

    approval = await client.post(
        "/api/v1/pos/enterprise/approvals",
        headers=sp,
        json={"approval_type": "void", "reason": "customer cancelled", "order_id": order_id},
    )
    assert approval.status_code == 201, approval.text
    approved = await client.post(
        f"/api/v1/pos/enterprise/approvals/{approval.json()['id']}/approve",
        headers=bm,
        json={"decision_note": "ok"},
    )
    assert approved.status_code == 200, approved.text

    voided = await client.post(f"/api/v1/pos/cart/{order_id}/void", headers=sp)
    assert voided.status_code == 200, voided.text
    assert voided.json()["status"] == "Cancelled"
