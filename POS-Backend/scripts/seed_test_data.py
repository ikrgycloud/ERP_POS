"""Seed representative test data across every application table.

Usage:
    python -m scripts.seed_test_data

The script is idempotent: it reuses records with TEST-* identifiers instead of
deleting existing data or creating duplicates on every run.
"""
import asyncio
import json
import sys
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any, TypeVar

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# Allow running the script directly from the scripts/ directory on Windows.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.config import settings
from app.core.security import hash_password
from app.db.init import DatabaseInitializer
from app.db.session import AsyncSessionLocal, engine
from app.models.catalog import (
    Category,
    DamagedInventory,
    Product,
    ProductDiscount,
    ProductQuantity,
    Supplier,
)
from app.models.org import BusinessProfile, Outlet, Staff
from app.models.sales import (
    AuditLog,
    Customer,
    Invoice,
    Order,
    OrderItem,
    Payment,
    Return,
    ReturnItem,
    Waybill,
)

ModelT = TypeVar("ModelT")


async def get_one(db: AsyncSession, model: type[ModelT], **filters: Any) -> ModelT | None:
    stmt = select(model).filter_by(**filters).limit(1)
    return (await db.execute(stmt)).scalar_one_or_none()


async def get_or_create(
    db: AsyncSession,
    model: type[ModelT],
    lookup: dict[str, Any],
    defaults: dict[str, Any] | None = None,
) -> ModelT:
    obj = await get_one(db, model, **lookup)
    if obj is not None:
        return obj

    obj = model(**lookup, **(defaults or {}))
    db.add(obj)
    await db.flush()
    return obj


async def seed() -> None:
    await DatabaseInitializer(engine, settings.DATABASE_URL).initialize()

    async with AsyncSessionLocal() as db:
        business = await get_or_create(
            db,
            BusinessProfile,
            {"access_code": "TEST-BP"},
            {
                "role": "admin",
                "legal_name": "Test Retail Private Limited",
                "trade_name": "Test Retail",
                "owner_name": "Test Owner",
                "mobile": "9999990000",
                "email": "owner@test-retail.local",
                "password_hash": hash_password("Test@123"),
                "gstin": "27AAAAA0000A1Z5",
                "pan": "AAAAA0000A",
                "business_type": "Retail",
                "billing_address": "Test billing address",
                "shipping_address": "Test shipping address",
                "city": "Mumbai",
                "state": "Maharashtra",
                "pincode": "400001",
                "bank_name": "Test Bank",
                "account_number": "000111222333",
                "ifsc": "TEST0001234",
                "upi_id": "testretail@upi",
            },
        )

        outlet = await get_or_create(
            db,
            Outlet,
            {"outlet_code": "TEST-OUTLET-001"},
            {
                "business_profile_id": business.id,
                "role": "outlet",
                "access_code": "TEST-OUTLET-ACCESS",
                "legal_name": "Test Retail Private Limited",
                "trade_name": "Test Retail Main",
                "owner_name": "Test Owner",
                "mobile": "9999990001",
                "email": "outlet@test-retail.local",
                "password_hash": hash_password("Test@123"),
                "name": "Test Main Outlet",
                "manager_name": "Test Branch Manager",
                "gstin": "27AAAAA0000A1Z5",
                "pan": "AAAAA0000A",
                "business_type": "Retail",
                "address": "Test outlet address",
                "city": "Mumbai",
                "state": "Maharashtra",
                "pincode": "400001",
                "bank_name": "Test Bank",
                "account_number": "000111222333",
                "ifsc": "TEST0001234",
                "upi_id": "testoutlet@upi",
                "is_active": True,
            },
        )

        branch_manager = await get_or_create(
            db,
            Staff,
            {"employee_code": "TEST-BM001"},
            {
                "business_profile_id": business.id,
                "outlet_id": outlet.id,
                "role": "branch_manager",
                "full_name": "Test Branch Manager",
                "phone": "9999991001",
                "email": "bm@test-retail.local",
                "password_hash": hash_password("Test@123"),
                "joining_date": date.today(),
                "is_active": True,
            },
        )
        sales_manager = await get_or_create(
            db,
            Staff,
            {"employee_code": "TEST-SM001"},
            {
                "business_profile_id": business.id,
                "outlet_id": outlet.id,
                "role": "sales_manager",
                "full_name": "Test Sales Manager",
                "phone": "9999991002",
                "email": "sm@test-retail.local",
                "password_hash": hash_password("Test@123"),
                "manager_id": branch_manager.id,
                "joining_date": date.today(),
                "is_active": True,
            },
        )
        sales_person = await get_or_create(
            db,
            Staff,
            {"employee_code": "TEST-SP001"},
            {
                "business_profile_id": business.id,
                "outlet_id": outlet.id,
                "role": "sales_person",
                "full_name": "Test Sales Person",
                "phone": "9999991003",
                "email": "sp@test-retail.local",
                "password_hash": hash_password("Test@123"),
                "manager_id": sales_manager.id,
                "joining_date": date.today(),
                "is_active": True,
            },
        )

        category = await get_or_create(
            db,
            Category,
            {"name": "TEST Groceries"},
            {"description": "Seeded test category", "is_active": True},
        )
        supplier = await get_or_create(
            db,
            Supplier,
            {"business_profile_id": business.id, "name": "TEST Acme Supplier"},
            {
                "mobile": "9999992001",
                "email": "supplier@test-retail.local",
                "address": "Supplier test address",
                "gstin": "27BBBBB0000B1Z5",
                "is_active": True,
            },
        )
        product = await get_or_create(
            db,
            Product,
            {"sku": "TEST-SKU-MILK"},
            {
                "business_profile_id": business.id,
                "name": "TEST Milk 500ml",
                "category_id": category.id,
                "supplier_id": supplier.id,
                "category": category.name,
                "supplier": supplier.name,
                "qty_bought": Decimal("100.000"),
                "qty_sold": Decimal("2.000"),
                "stock_cached": Decimal("98.000"),
                "unit_type": "pieces",
                "unit_label": "Pieces",
                "mrp": Decimal("50.00"),
                "buy_price": Decimal("40.00"),
                "sell_price": Decimal("50.00"),
                "gst_rate": Decimal("5.00"),
                "reorder_level": Decimal("10.000"),
                "is_active": True,
                "barcode": "TEST-BC-MILK",
                "damaged_qty": Decimal("1.000"),
                "returned_damaged_qty": Decimal("1.000"),
            },
        )

        await get_or_create(
            db,
            ProductDiscount,
            {"product_id": product.id, "description": "TEST 10 percent discount"},
            {
                "business_profile_id": business.id,
                "discount_type": "percentage",
                "discount_value": Decimal("10.00"),
                "min_quantity": Decimal("2.000"),
                "start_date": date.today() - timedelta(days=1),
                "end_date": date.today() + timedelta(days=30),
                "is_active": True,
            },
        )

        customer = await get_or_create(
            db,
            Customer,
            {"outlet_id": outlet.id, "phone": "9999993001"},
            {
                "name": "Test Customer",
                "email": "customer@test-retail.local",
                "address": "Customer test address",
                "city": "Mumbai",
                "state": "Maharashtra",
                "pincode": "400001",
                "total_spent": Decimal("105.00"),
                "purchase_count": 1,
                "loyalty_points": 10,
                "last_purchase_amount": Decimal("105.00"),
                "last_purchase_at": date.today(),
                "notes": "Seeded test customer",
            },
        )

        order = await get_or_create(
            db,
            Order,
            {"order_number": "TEST-ORD-0001"},
            {
                "business_profile_id": business.id,
                "type": "sale",
                "party_type": "customer",
                "party_name": customer.name,
                "outlet_id": outlet.id,
                "customer_id": customer.id,
                "staff_id": sales_person.id,
                "status": "Completed",
                "date": date.today(),
                "payment_status": "Paid",
                "inventory_applied": True,
            },
        )
        order_item = await get_or_create(
            db,
            OrderItem,
            {"order_id": order.id, "product_id": product.id},
            {
                "quantity": Decimal("2.000"),
                "unit_type": "pieces",
                "unit_label": "Pieces",
                "rate": Decimal("50.00"),
                "gst_rate": Decimal("5.00"),
            },
        )

        invoice = await get_or_create(
            db,
            Invoice,
            {"invoice_number": "TEST-INV-0001"},
            {
                "business_profile_id": business.id,
                "order_id": order.id,
                "invoice_type": "sale",
                "invoice_direction": "outlet_to_customer",
                "outlet_id": outlet.id,
                "customer_id": customer.id,
                "staff_id": sales_person.id,
                "is_reverse": False,
                "party_type": "customer",
                "party_name": customer.name,
                "date": date.today(),
                "due_date": date.today(),
                "taxable_value": Decimal("100.00"),
                "cgst": Decimal("2.50"),
                "sgst": Decimal("2.50"),
                "igst": Decimal("0.00"),
                "status": "Paid",
                "payment_method": "cash",
            },
        )
        payment = await get_or_create(
            db,
            Payment,
            {"invoice_id": invoice.id, "direction": "in", "method": "cash"},
            {
                "business_profile_id": business.id,
                "outlet_id": outlet.id,
                "staff_id": sales_person.id,
                "amount": Decimal("105.00"),
                "reference_no": "TEST-PAY-IN-0001",
            },
        )

        product_quantity = await get_or_create(
            db,
            ProductQuantity,
            {"product_id": product.id, "transaction_type": "sale", "note": "TEST sale"},
            {
                "business_profile_id": business.id,
                "quantity_change": Decimal("-2.000"),
                "remaining_quantity": Decimal("98.000"),
                "reference_order_id": order.id,
            },
        )

        ret = await get_or_create(
            db,
            Return,
            {"return_number": "TEST-RET-0001"},
            {
                "business_profile_id": business.id,
                "original_invoice_id": invoice.id,
                "outlet_id": outlet.id,
                "customer_id": customer.id,
                "staff_id": sales_person.id,
                "return_date": date.today(),
                "reason": "Seeded damaged return",
                "resolution": "refund",
                "refund_method": "cash",
                "refund_amount": Decimal("52.50"),
                "status": "completed",
                "remarks": "Seeded return data",
            },
        )

        reversal = await get_or_create(
            db,
            Invoice,
            {"invoice_number": "TEST-REV-0001"},
            {
                "business_profile_id": business.id,
                "invoice_type": "reversal",
                "invoice_direction": "customer_to_outlet",
                "linked_invoice_id": invoice.id,
                "outlet_id": outlet.id,
                "customer_id": customer.id,
                "staff_id": sales_person.id,
                "is_reverse": True,
                "party_type": "customer",
                "party_name": customer.name,
                "date": date.today(),
                "due_date": date.today(),
                "taxable_value": Decimal("50.00"),
                "cgst": Decimal("1.25"),
                "sgst": Decimal("1.25"),
                "igst": Decimal("0.00"),
                "status": "Refunded",
                "payment_method": "cash",
            },
        )
        ret.reversal_invoice_id = reversal.id

        return_item = await get_or_create(
            db,
            ReturnItem,
            {"return_id": ret.id, "product_id": product.id},
            {
                "order_item_id": order_item.id,
                "quantity": Decimal("1.000"),
                "rate": Decimal("50.00"),
                "discount": Decimal("0.00"),
                "gst_rate": Decimal("5.00"),
                "line_refund": Decimal("50.00"),
                "damage_type": "leaking",
                "remarks": "Seeded return item",
            },
        )
        await get_or_create(
            db,
            DamagedInventory,
            {"return_item_id": return_item.id},
            {
                "business_profile_id": business.id,
                "product_id": product.id,
                "outlet_id": outlet.id,
                "return_id": ret.id,
                "quantity": Decimal("1.000"),
                "damage_type": "leaking",
                "disposition": "quarantined",
                "recorded_by": branch_manager.id,
                "remarks": "Seeded damaged inventory",
            },
        )
        await get_or_create(
            db,
            Payment,
            {"invoice_id": reversal.id, "direction": "out", "method": "cash"},
            {
                "business_profile_id": business.id,
                "outlet_id": outlet.id,
                "staff_id": sales_person.id,
                "amount": Decimal("52.50"),
                "reference_no": "TEST-PAY-OUT-0001",
            },
        )
        await get_or_create(
            db,
            Waybill,
            {"waybill_number": "TEST-WAY-0001"},
            {
                "invoice_id": invoice.id,
                "generated_at": date.today(),
                "valid_until": date.today() + timedelta(days=7),
                "status": "Active",
                "transport_mode": "Road",
                "vehicle_number": "MH01TEST",
                "from_name": outlet.name,
                "to_name": customer.name,
            },
        )
        await get_or_create(
            db,
            AuditLog,
            {"action": "seed", "entity_type": "test_data", "entity_id": "TEST-SEED-001"},
            {
                "details": json.dumps(
                    {
                        "business_profile_id": business.id,
                        "outlet_id": outlet.id,
                        "staff_ids": [
                            branch_manager.id,
                            sales_manager.id,
                            sales_person.id,
                        ],
                        "product_quantity_id": product_quantity.id,
                        "payment_id": payment.id,
                    }
                )
            },
        )

        await db.commit()

    await engine.dispose()

    print("Seed test data completed.")
    print("Login users:")
    print("  Branch Manager: TEST-BM001 / Test@123")
    print("  Sales Manager : TEST-SM001 / Test@123")
    print("  Sales Person  : TEST-SP001 / Test@123")
    print("Product barcode: TEST-BC-MILK")
    print("Invoice number : TEST-INV-0001")
    print("Return number  : TEST-RET-0001")


if __name__ == "__main__":
    asyncio.run(seed())
