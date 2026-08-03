import os
from pathlib import Path
import sys

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.files import submit_file_products  # noqa: E402
from app.database import Base  # noqa: E402
from app.models import Product, UploadedFile  # noqa: E402
from app.schemas import FileProductImportSubmit  # noqa: E402


@pytest.fixture()
def db_session():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    with SessionLocal() as db:
        yield db


def test_file_import_returns_created_products_and_preserves_rows_outside_preview(db_session):
    file_record = UploadedFile(
        original_name="products.csv",
        stored_name="products.csv",
        file_url="/uploads/files/products.csv",
        file_path="missing.csv",
        file_type="csv",
        row_count=2,
        rows_json=(
            '[{"Product Name":"Original product","Quantity":"4","MRP":"10","Buy Price":"8","Sell Price":"10"},'
            '{"Product Name":"Second product","Quantity":"2","MRP":"15","Buy Price":"12","Sell Price":"15"}]'
        ),
    )
    db_session.add(file_record)
    db_session.commit()

    result = submit_file_products(
        file_record.id,
        FileProductImportSubmit(
            row_overrides=[{"Product Name": "Edited product", "Quantity": "5", "MRP": "10", "Buy Price": "8", "Sell Price": "10"}]
        ),
        "file-import-test",
        None,
        db_session,
    )

    assert result.created == 2
    assert result.updated == 0
    assert [product.name for product in result.products] == ["Edited product", "Second product"]
    assert all(product.created_at for product in result.products)
    assert db_session.query(Product).count() == 2
