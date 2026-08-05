"""Verify the live POS checkout HTTP flow against the configured database."""
import asyncio
import json
import time
import urllib.error
import urllib.request

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import AsyncSessionLocal
from app.models.catalog import InventoryLedger, ProductQuantity
from app.models.sales import Invoice, Order, Payment


BASE_URL = "http://127.0.0.1:8002/api/v1"
ORIGIN = "http://192.168.29.189:5174"


def request(method: str, path: str, body=None, token: str | None = None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        method=method,
        headers={
            "Accept": "application/json",
            "Origin": ORIGIN,
            **({"Content-Type": "application/json"} if body is not None else {}),
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            payload = res.read().decode("utf-8")
            return res.status, dict(res.headers), json.loads(payload) if payload else None
    except urllib.error.HTTPError as exc:
        payload = exc.read().decode("utf-8")
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError:
            parsed = payload
        return exc.code, dict(exc.headers), parsed


async def main():
    status, _, login = request(
        "POST",
        "/auth/login",
        {"employee_code": "TEST-SP001", "password": "Test@123"},
    )
    print(f"login_status={status}")
    if status != 200:
        print(json.dumps(login, indent=2))
        raise SystemExit(1)
    token = login["access_token"]

    status, _, cart = request("POST", "/pos/cart", {}, token)
    print(f"cart_status={status} order_id={cart.get('order_id') if isinstance(cart, dict) else None}")
    if status != 201:
        print(json.dumps(cart, indent=2))
        raise SystemExit(1)
    order_id = cart["order_id"]

    status, _, line = request(
        "POST",
        f"/pos/cart/{order_id}/scan",
        {"barcode": "TEST-BC-MILK", "quantity": 1},
        token,
    )
    print(f"scan_status={status}")
    if status != 200:
        print(json.dumps(line, indent=2))
        raise SystemExit(1)

    phone = f"900{int(time.time()) % 10000000:07d}"
    status, _, customer = request(
        "POST",
        "/customers",
        {"phone": phone, "name": "Live Checkout Guest"},
        token,
    )
    print(f"customer_status={status}")
    if status != 201:
        print(json.dumps(customer, indent=2))
        raise SystemExit(1)

    status, _, attach = request(
        "PATCH",
        f"/pos/cart/{order_id}/customer",
        {"customer_id": customer["id"]},
        token,
    )
    print(f"attach_status={status}")
    if status != 200:
        print(json.dumps(attach, indent=2))
        raise SystemExit(1)

    status, headers, invoice = request(
        "POST",
        f"/pos/cart/{order_id}/checkout",
        {"payment_method": "cash", "inter_state": False},
        token,
    )
    print(f"checkout_status={status}")
    print(f"checkout_cors_origin={headers.get('Access-Control-Allow-Origin')}")
    if status not in {200, 201}:
        print(json.dumps(invoice, indent=2))
        raise SystemExit(1)

    invoice_id = invoice["id"]
    async with AsyncSessionLocal() as db:
        db_invoice = (
            await db.execute(
                select(Invoice)
                .options(selectinload(Invoice.items))
                .where(Invoice.id == invoice_id)
            )
        ).scalar_one()
        db_order = await db.get(Order, order_id)
        payment = (
            await db.execute(select(Payment).where(Payment.invoice_id == invoice_id))
        ).scalar_one()
        ledger = (
            await db.execute(
                select(InventoryLedger).where(
                    InventoryLedger.reference_type == "invoice",
                    InventoryLedger.reference_id == str(invoice_id),
                )
            )
        ).scalar_one()
        quantity = (
            await db.execute(
                select(ProductQuantity).where(ProductQuantity.reference_order_id == order_id)
            )
        ).scalar_one()

    print(f"invoice_id={db_invoice.id} invoice_number={db_invoice.invoice_number}")
    print(f"invoice_items={len(db_invoice.items)}")
    print(f"payment_id={payment.id} amount={payment.amount} method={payment.method}")
    print(f"ledger_id={ledger.id} type={ledger.type} quantity={ledger.quantity}")
    print(f"product_quantity_id={quantity.id} remaining={quantity.remaining_quantity}")
    print(
        "order_status="
        f"{db_order.status} payment_status={db_order.payment_status} "
        f"inventory_applied={db_order.inventory_applied}"
    )


if __name__ == "__main__":
    asyncio.run(main())
