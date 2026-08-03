from decimal import Decimal
import os
from pathlib import Path
import sys

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base  # noqa: E402
from app.models import Product  # noqa: E402
from app.product_identifiers import (  # noqa: E402
    ProductIdentifierError,
    assert_barcode_available,
    generate_product_barcode,
    generate_product_identifiers,
    normalize_manual_barcode,
)


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
        "sku": "SKU-BP000001-999999",
        "name": "Test Product",
        "category": "General",
        "supplier": "Acme",
        "qty_bought": Decimal("0"),
        "qty_sold": Decimal("0"),
        "mrp": Decimal("10"),
        "buy_price": Decimal("5"),
        "sell_price": Decimal("8"),
        "gst_rate": Decimal("5"),
        "reorder_level": Decimal("0"),
        "is_active": True,
    }
    data.update(overrides)
    return Product(**data)


def test_product_identifiers_are_backend_generated_and_sequential(db_session):
    first = generate_product_identifiers(db_session, 6)
    second = generate_product_identifiers(db_session, 6)

    assert first.sku == "SKU-BP000006-000001"
    assert second.sku == "SKU-BP000006-000002"
    assert first.barcode == "2900000000001"
    assert second.barcode == "2900000000002"
    assert first.sku != second.sku
    assert first.barcode != second.barcode


def test_product_sku_sequence_is_business_scoped_but_barcode_is_global(db_session):
    tenant_one = generate_product_identifiers(db_session, 1)
    tenant_two = generate_product_identifiers(db_session, 2)

    assert tenant_one.sku == "SKU-BP000001-000001"
    assert tenant_two.sku == "SKU-BP000002-000001"
    assert tenant_one.barcode != tenant_two.barcode


def test_100_sequential_product_identifier_generations_do_not_duplicate(db_session):
    identifiers = [generate_product_identifiers(db_session, 1) for _ in range(100)]

    assert len({item.sku for item in identifiers}) == 100
    assert len({item.barcode for item in identifiers}) == 100
    assert identifiers[-1].sku == "SKU-BP000001-000100"


def test_manual_barcode_validation_and_duplicate_prevention(db_session):
    assert normalize_manual_barcode(" 123 456 ") == "123456"
    with pytest.raises(ProductIdentifierError) as invalid:
        normalize_manual_barcode("ABC-123")
    assert invalid.value.code == "INVALID_BARCODE"

    db_session.add(_product(barcode="123456"))
    db_session.commit()

    with pytest.raises(ProductIdentifierError) as duplicate:
        assert_barcode_available(db_session, barcode="123456", business_profile_id=1)
    assert duplicate.value.code == "BARCODE_ALREADY_EXISTS"

    assert_barcode_available(db_session, barcode="123456", business_profile_id=2)
