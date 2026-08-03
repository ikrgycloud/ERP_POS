from datetime import date, datetime, timezone
from decimal import Decimal
import os
from pathlib import Path
import sys

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.invoices import resolve_invoice_party_identity, serialize_invoice  # noqa: E402
from app.api.deps import ErpPrincipal  # noqa: E402
from app.api.orders import build_order_items, build_order_quote, delete_order, list_orders, serialize_order  # noqa: E402
from app.api.products import product_qr_payload  # noqa: E402
from app.database import Base  # noqa: E402
from app.models import Invoice, InventoryLedger, Order, OrderItem, Product, ProductDiscount, Supplier  # noqa: E402
from app.schemas import OrderCreate, OrderOut, OrderUpdate, SupplierCreate, SupplierOut  # noqa: E402
from app.services import active_discount_for_product, record_product_quantity, validate_ledger_inventory_for_sale  # noqa: E402


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    with SessionLocal() as db:
        yield db


def _product(**overrides):
    data = {
        "business_profile_id": 1,
        "sku": "SKU-1",
        "barcode": "BAR-1",
        "name": "Test Product",
        "category": "General",
        "supplier": "Acme",
        "qty_bought": Decimal("10"),
        "qty_sold": Decimal("0"),
        "stock_cached": Decimal("10"),
        "mrp": Decimal("100"),
        "buy_price": Decimal("60"),
        "sell_price": Decimal("100"),
        "gst_rate": Decimal("18"),
        "reorder_level": Decimal("1"),
        "is_active": True,
    }
    data.update(overrides)
    return Product(**data)


@pytest.mark.parametrize("order_schema", [OrderCreate, OrderUpdate])
def test_order_requires_at_least_one_product_line(order_schema):
    with pytest.raises(ValidationError, match="at least 1 item"):
        order_schema.model_validate(
            {
                "type": "sale",
                "partyType": "B2B",
                "partyName": "Outlet",
                "status": "Draft",
                "date": date.today().isoformat(),
                "paymentStatus": "Unpaid",
                "items": [],
            }
        )


def test_product_qr_payload_applies_discount_once():
    product = _product()
    product.discounts = [
        ProductDiscount(
            id=1,
            product_id=1,
            business_profile_id=1,
            discount_type="percentage",
            discount_value=Decimal("10"),
            min_quantity=Decimal("0"),
            is_active=True,
        )
    ]

    payload = product_qr_payload(product)

    assert payload["sellPrice"] == "100"
    assert payload["finalPrice"] == "90"
    assert payload["discountText"] == "10% off"


def test_order_schema_rejects_duplicate_products_and_zero_rate():
    payload = {
        "type": "purchase",
        "partyType": "B2B",
        "partyName": "Acme",
        "supplierId": 1,
        "status": "Draft",
        "date": date.today().isoformat(),
        "paymentStatus": "Unpaid",
        "items": [
            {"productId": 1, "quantity": 1, "rate": 0, "gstRate": 18},
            {"productId": 1, "quantity": 1, "rate": 10, "gstRate": 18},
        ],
    }

    with pytest.raises(ValidationError):
        OrderCreate.model_validate(payload)


def test_order_output_accepts_legacy_expired_status_without_relaxing_writes():
    output_payload = {
        "id": 1,
        "orderNumber": "ORD-1",
        "type": "sale",
        "partyType": "B2B",
        "partyName": "Legacy outlet",
        "status": "Expired",
        "date": date.today().isoformat(),
        "paymentStatus": "Unpaid",
        "inventoryApplied": False,
        "taxableValue": "10",
        "taxValue": "1.8",
        "grandTotal": "11.8",
        "items": [],
        "createdAt": "2026-01-01T00:00:00",
        "updatedAt": "2026-01-01T00:00:00",
    }

    assert OrderOut.model_validate(output_payload).status == "Expired"

    with pytest.raises(ValidationError):
        OrderCreate.model_validate(
            {
                **output_payload,
                "items": [{"productId": 1, "quantity": 1, "rate": 10, "gstRate": 18}],
            }
        )


def test_supplier_phone_is_canonical_and_mobile_remains_compatible():
    current = SupplierCreate.model_validate({"name": "Acme", "phone": "+91 98765 43210"})
    legacy = SupplierCreate.model_validate({"name": "Legacy", "mobile": "9876543210"})

    assert current.phone == "+91 98765 43210"
    assert current.mobile == "+91 98765 43210"
    assert legacy.phone == "9876543210"
    assert SupplierOut.model_validate(
        {
            "id": 1,
            "name": "Acme",
            "mobile": "9876543210",
            "createdAt": "2026-01-01T00:00:00",
            "updatedAt": "2026-01-01T00:00:00",
        }
    ).phone == "9876543210"


def test_order_serialization_exposes_supplier_phone_without_placeholder_data():
    supplier = Supplier(id=1, name="Acme", phone="9876543210", mobile="9876543210")
    order = Order(
        id=1,
        order_number="ORD-1",
        type="purchase",
        party_type="B2B",
        party_name="Acme",
        status="Draft",
        date=date.today(),
        payment_status="Unpaid",
        inventory_applied=False,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    order.supplier = supplier
    order.items = []

    output = serialize_order(order)

    assert output.supplier_phone == "9876543210"
    assert output.supplier_mobile == "9876543210"


def test_delete_order_soft_deletes_and_hides_from_order_list(db_session):
    order = Order(
        business_profile_id=1,
        order_number="ORD-DEL-1",
        type="sale",
        party_type="B2B",
        party_name="Outlet",
        status="Draft",
        date=date.today(),
        payment_status="Unpaid",
        inventory_applied=False,
    )
    db_session.add(order)
    db_session.commit()
    principal = ErpPrincipal(business_profile_id=1, role="admin")

    result = delete_order(order.id, principal, db_session)
    listed_orders = list_orders(
        search=None,
        order_type=None,
        party_type=None,
        status_filter=None,
        payment_status=None,
        outlet_id=None,
        customer_id=None,
        start_date=None,
        end_date=None,
        cursor=None,
        skip=0,
        limit=100,
        principal=principal,
        db=db_session,
    )

    assert result.message == "Order deleted"
    assert db_session.get(Order, order.id).status == "Deleted"
    assert listed_orders == []


def test_purchase_invoice_uses_linked_supplier_as_party_contact():
    supplier = Supplier(
        id=1,
        name="Acme",
        phone="9876543210",
        mobile="9876543210",
        email="sales@acme.test",
    )
    order = Order(
        id=1,
        order_number="ORD-1",
        type="purchase",
        party_type="B2B",
        party_name="Acme",
        status="Received",
        date=date.today(),
        payment_status="Unpaid",
        inventory_applied=True,
    )
    order.supplier = supplier
    order.items = []
    invoice = Invoice(
        id=1,
        invoice_number="INV-1",
        invoice_type="Purchase",
        invoice_direction="supplier_to_admin",
        party_type="B2B",
        party_name="Acme",
        date=date.today(),
        due_date=date.today(),
        taxable_value=Decimal("100"),
        cgst=Decimal("9"),
        sgst=Decimal("9"),
        igst=Decimal("0"),
        status="Unpaid",
        paid_amount=Decimal("0"),
        remaining_amount=Decimal("118"),
        payment_percentage=Decimal("0"),
        payment_status="Unpaid",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    invoice.order = order

    output = serialize_invoice(invoice)

    assert output.party_phone == "9876543210"
    assert output.supplier_phone == "9876543210"
    assert output.party_email == "sales@acme.test"
    assert output.party_category == "B2B"
    assert output.party_role == "Supplier"


def test_legacy_customer_party_type_is_presented_as_b2c_customer():
    invoice = Invoice(invoice_type="Sale", party_type="customer")

    assert resolve_invoice_party_identity(invoice, None) == ("B2C", "Customer")


def test_sale_validation_requires_a_real_ledger_balance_when_no_ledger_exists(db_session):
    product = _product(stock_cached=Decimal("0"))
    db_session.add(product)
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        validate_ledger_inventory_for_sale(db_session, product, Decimal("2"))

    assert exc.value.status_code == 400
    assert product.stock_cached == Decimal("0.000")


def test_erp_startup_never_creates_inventory_rows(monkeypatch, db_session):
    product = _product()
    db_session.add(product)
    db_session.flush()
    db_session.add(
        InventoryLedger(
            product_id=product.id,
            business_profile_id=product.business_profile_id,
            type="PURCHASE",
            quantity=Decimal("10"),
            idempotency_key="test:opening:product-1",
        )
    )
    db_session.commit()
    initial_count = db_session.query(func.count(InventoryLedger.id)).scalar()

    import app.main as main_module

    monkeypatch.setattr(main_module.settings, "auto_create_tables", False)
    monkeypatch.setattr(main_module.notification_worker, "start", lambda: None)
    for _ in range(100):
        main_module.create_tables_on_startup()

    assert db_session.query(func.count(InventoryLedger.id)).scalar() == initial_count


def test_sale_validation_uses_ledger_truth_when_ledger_exists(db_session):
    product = _product(stock_cached=Decimal("10"))
    db_session.add(product)
    db_session.flush()
    db_session.add(
        InventoryLedger(
            product_id=product.id,
            business_profile_id=1,
            type="PURCHASE",
            quantity=Decimal("1"),
        )
    )
    db_session.commit()

    with pytest.raises(HTTPException) as exc:
        validate_ledger_inventory_for_sale(db_session, product, Decimal("2"))

    assert exc.value.status_code == 400
    assert product.stock_cached == Decimal("1.000")


def test_sale_reversal_records_available_stock_adjustment(db_session):
    product = _product(qty_bought=Decimal("10"), qty_sold=Decimal("1"), stock_cached=Decimal("9"))
    db_session.add(product)
    db_session.flush()

    record_product_quantity(
        db_session,
        product,
        transaction_type="sale_reversed",
        quantity_change=Decimal("1"),
        old_stock=Decimal("10"),
        new_stock=Decimal("10"),
        sold_stock=Decimal("0"),
        remaining_quantity=Decimal("10"),
        note="Reverse delivered sale",
    )
    db_session.flush()

    ledger = db_session.query(InventoryLedger).filter(InventoryLedger.product_id == product.id).one()
    assert ledger.type == "ADJUSTMENT"
    assert ledger.quantity == Decimal("1.000")
    assert product.stock_cached == Decimal("10.000")


def test_sale_order_item_rejects_product_from_other_business(db_session):
    product = _product(business_profile_id=2)
    db_session.add(product)
    db_session.commit()
    payload = OrderCreate.model_validate(
        {
            "type": "sale",
            "partyType": "B2B",
            "partyName": "Outlet",
            "status": "Draft",
            "date": date.today().isoformat(),
            "paymentStatus": "Unpaid",
            "items": [{"productId": product.id, "quantity": 1, "rate": 10, "gstRate": 18}],
        }
    )

    with pytest.raises(HTTPException) as exc:
        build_order_items(db_session, payload.type, payload.items, business_profile_id=1)

    assert exc.value.status_code == 404


def test_sale_order_preserves_original_price_and_exposes_discount_breakdown(db_session):
    product = _product(sell_price=Decimal("100"), gst_rate=Decimal("18"))
    product.discounts = [
        ProductDiscount(
            business_profile_id=1,
            discount_type="percentage",
            discount_value=Decimal("10"),
            min_quantity=Decimal("0"),
            is_active=True,
        )
    ]
    db_session.add(product)
    db_session.commit()

    payload = OrderCreate.model_validate(
        {
            "type": "sale",
            "partyType": "B2B",
            "partyName": "Outlet",
            "status": "Draft",
            "date": date.today().isoformat(),
            "paymentStatus": "Unpaid",
            "items": [{"productId": product.id, "quantity": 2, "rate": 1, "gstRate": 18}],
        }
    )

    order = Order(
        id=1,
        order_number="ORD-1",
        type="sale",
        party_type="B2B",
        party_name="Outlet",
        status="Draft",
        date=date.today(),
        payment_status="Unpaid",
        inventory_applied=False,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    order.items = build_order_items(db_session, payload.type, payload.items, business_profile_id=1)
    db_session.add(order)
    db_session.flush()

    output = serialize_order(order)
    item = output.items[0]

    assert item.rate == Decimal("100")
    assert item.line_subtotal == Decimal("200")
    assert item.discount_amount == Decimal("20")
    assert item.discount_label == "10.00% off"
    assert item.line_total == Decimal("180")
    assert output.subtotal_value == Decimal("200")
    assert output.discount_value == Decimal("20")
    assert output.taxable_value == Decimal("180")
    assert output.tax_value == Decimal("32.4")
    assert output.grand_total == Decimal("212.4")


def test_purchase_order_exposes_available_sale_offer_without_applying_discount(db_session):
    product = _product(sell_price=Decimal("100"), buy_price=Decimal("80"), gst_rate=Decimal("18"))
    product.discounts = [
        ProductDiscount(
            business_profile_id=1,
            discount_type="percentage",
            discount_value=Decimal("15"),
            min_quantity=Decimal("0"),
            start_date=date.today(),
            end_date=date.today(),
            is_active=True,
        )
    ]
    db_session.add(product)
    db_session.commit()
    order = Order(
        id=1,
        business_profile_id=1,
        order_number="ORD-PUR-1",
        type="purchase",
        party_type="B2B",
        party_name="Supplier",
        status="Sent",
        date=date.today(),
        payment_status="Unpaid",
        inventory_applied=False,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    item = OrderItem(
        product_id=product.id,
        quantity=Decimal("2"),
        rate=Decimal("80"),
        gst_rate=Decimal("18"),
    )
    item.product = product
    order.items = [item]
    db_session.add(order)
    db_session.flush()

    output = serialize_order(order)
    output_item = output.items[0]

    assert output.discount_value == Decimal("0")
    assert output.taxable_value == Decimal("160")
    assert output_item.discount_pct == Decimal("0")
    assert output_item.discount_amount == Decimal("0")
    assert output_item.available_discount_pct == Decimal("15")
    assert output_item.available_discount_label == "15.00% off"


def test_order_quote_uses_server_side_product_discount(db_session):
    product = _product(sell_price=Decimal("100"), gst_rate=Decimal("18"))
    product.discounts = [
        ProductDiscount(
            business_profile_id=1,
            discount_type="percentage",
            discount_value=Decimal("15"),
            min_quantity=Decimal("0"),
            is_active=True,
        )
    ]
    db_session.add(product)
    db_session.commit()
    payload = OrderCreate.model_validate(
        {
            "type": "sale",
            "partyType": "B2B",
            "partyName": "Outlet",
            "status": "Draft",
            "date": date.today().isoformat(),
            "paymentStatus": "Unpaid",
            "items": [{"productId": product.id, "quantity": 2, "rate": 1, "gstRate": 18}],
        }
    )

    quote = build_order_quote(db_session, payload.type, payload.items, business_profile_id=1)

    assert quote.items[0].rate == Decimal("100")
    assert quote.items[0].discount_amount == Decimal("30")
    assert quote.subtotal_value == Decimal("200")
    assert quote.discount_value == Decimal("30")
    assert quote.taxable_value == Decimal("170")
    assert quote.tax_value == Decimal("30.6")
    assert quote.grand_total == Decimal("200.6")


def test_multi_item_sale_exposes_discount_percent_only_on_discounted_product(db_session):
    discounted = _product(sku="SKU-DISC", barcode="BAR-DISC", sell_price=Decimal("100"), gst_rate=Decimal("18"))
    regular = _product(sku="SKU-REG", barcode="BAR-REG", sell_price=Decimal("80"), gst_rate=Decimal("18"))
    discounted.discounts = [
        ProductDiscount(
            business_profile_id=1,
            discount_type="percentage",
            discount_value=Decimal("50"),
            min_quantity=Decimal("0"),
            is_active=True,
        )
    ]
    db_session.add_all([discounted, regular])
    db_session.commit()
    payload = OrderCreate.model_validate(
        {
            "type": "sale",
            "partyType": "B2B",
            "partyName": "Outlet",
            "status": "Draft",
            "date": date.today().isoformat(),
            "paymentStatus": "Unpaid",
            "items": [
                {"productId": discounted.id, "quantity": 1, "rate": 1, "gstRate": 18},
                {"productId": regular.id, "quantity": 1, "rate": 1, "gstRate": 18},
            ],
        }
    )

    quote = build_order_quote(db_session, payload.type, payload.items, business_profile_id=1)
    by_product = {item.product_id: item for item in quote.items}

    assert by_product[discounted.id].discount_pct == Decimal("50")
    assert by_product[discounted.id].discount_label == "50.00% off"
    assert by_product[regular.id].discount_pct == Decimal("0")
    assert by_product[regular.id].discount_label is None


def test_active_discount_picks_best_actual_savings_for_legacy_overlaps():
    product = _product(sell_price=Decimal("100"))
    weaker_percentage = ProductDiscount(
        id=1,
        product_id=1,
        business_profile_id=1,
        discount_type="percentage",
        discount_value=Decimal("10"),
        min_quantity=Decimal("0"),
        start_date=date.today(),
        end_date=date.today(),
        is_active=True,
    )
    stronger_fixed = ProductDiscount(
        id=2,
        product_id=1,
        business_profile_id=1,
        discount_type="fixed",
        discount_value=Decimal("30"),
        min_quantity=Decimal("0"),
        start_date=date.today(),
        end_date=date.today(),
        is_active=True,
    )
    product.discounts = [weaker_percentage, stronger_fixed]

    assert active_discount_for_product(product, Decimal("1"), Decimal("100")) is stronger_fixed
