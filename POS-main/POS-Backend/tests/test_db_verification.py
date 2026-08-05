"""Database verification behavior."""
from pathlib import Path

import pytest
from sqlalchemy import Column, ForeignKey, Integer, MetaData, String, Table, func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Environment, settings
from app.db.init import DatabaseInitializer
from app.db.session import Base
from app.models.catalog import InventoryLedger, Product


@pytest.mark.asyncio
async def test_missing_index_does_not_fail_database_verification(caplog):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
            await connection.execute(text("DROP INDEX ix_products_barcode"))

        initializer = DatabaseInitializer(engine, "sqlite+aiosqlite:///:memory:")
        await initializer._verify_database_objects()

        assert "missing non-critical indexes" in caplog.text
        assert "op.create_index('ix_products_barcode'" in caplog.text
    finally:
        await engine.dispose()


def test_postgres_index_definition_match_ignores_generated_name():
    expected = DatabaseInitializer._index_spec(
        "products",
        next(
            index
            for index in Base.metadata.tables["products"].indexes
            if index.name == "ix_products_barcode"
        ),
    )
    existing = DatabaseInitializer._pg_index_spec(
        "products_barcode_idx",
        'CREATE INDEX products_barcode_idx ON public.products USING btree (barcode)',
    )

    assert existing == expected


def test_returned_damaged_quantity_schema_drift_is_covered_by_migration():
    products = Base.metadata.tables["products"]
    assert "returned_damaged_qty" in products.columns

    migration = Path("alembic/versions/0016_returned_damaged_qty_schema_drift.py")
    source = migration.read_text(encoding="utf-8")
    assert "ADD COLUMN IF NOT EXISTS returned_damaged_qty" in source
    assert "DROP COLUMN" not in source


def test_staging_environment_is_supported():
    assert Environment.STAGING.value == "staging"


@pytest.mark.asyncio
async def test_pos_startup_never_generates_inventory_rows(monkeypatch, caplog):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with session_factory() as session:
            product = Product(
                sku="STARTUP-STOCK-1", name="Startup Stock", category="Test", supplier="Test",
                mrp=10, buy_price=5, sell_price=10, qty_bought=10, stock_cached=10,
            )
            session.add(product)
            await session.flush()
            session.add(
                InventoryLedger(
                    product_id=product.id,
                    type="PURCHASE",
                    quantity=10,
                    idempotency_key="test:startup:opening-stock",
                )
            )
            await session.commit()

        monkeypatch.setattr(settings, "AUTO_CREATE_DATABASE", False)
        monkeypatch.setattr(settings, "AUTO_CREATE_TABLES", False)
        initializer = DatabaseInitializer(engine, "sqlite+aiosqlite:///:memory:")
        for _ in range(100):
            await initializer.initialize()

        async with session_factory() as session:
            count = await session.scalar(select(func.count(InventoryLedger.id)))
        assert count == 1
        assert "Legacy compatibility mode: DISABLED" in caplog.text
        assert "Synthetic ledger generation: DISABLED" in caplog.text
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_missing_audit_log_foreign_keys_fail_database_verification(monkeypatch):
    metadata = MetaData()
    Table("business_profiles", metadata, Column("id", Integer, primary_key=True))
    Table("outlets", metadata, Column("id", Integer, primary_key=True))
    Table("staff", metadata, Column("id", Integer, primary_key=True))
    Table(
        "audit_logs",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("business_profile_id", Integer, ForeignKey("business_profiles.id")),
        Column("outlet_id", Integer, ForeignKey("outlets.id")),
        Column("staff_id", Integer, ForeignKey("staff.id")),
        Column("action", String(80), nullable=False),
    )

    class MinimalBase:
        pass

    MinimalBase.metadata = metadata

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    try:
        async with engine.begin() as connection:
            await connection.execute(text("CREATE TABLE business_profiles (id INTEGER PRIMARY KEY)"))
            await connection.execute(text("CREATE TABLE outlets (id INTEGER PRIMARY KEY)"))
            await connection.execute(text("CREATE TABLE staff (id INTEGER PRIMARY KEY)"))
            await connection.execute(
                text(
                    """
                    CREATE TABLE audit_logs (
                        id INTEGER PRIMARY KEY,
                        business_profile_id INTEGER,
                        outlet_id INTEGER,
                        staff_id INTEGER,
                        action VARCHAR(80) NOT NULL,
                        FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id)
                    )
                    """
                )
            )

        import app.db.init as init_module

        monkeypatch.setattr(init_module, "Base", MinimalBase)
        initializer = DatabaseInitializer(engine, "sqlite+aiosqlite:///:memory:")

        with pytest.raises(RuntimeError) as exc:
            await initializer._verify_database_objects()

        message = str(exc.value)
        assert "audit_logs.outlet_id" in message
        assert "audit_logs.staff_id" in message
    finally:
        await engine.dispose()


def test_repair_migration_is_forward_idempotent():
    migration = Path("alembic/versions/0026_repair_alembic_drift.py")
    source = migration.read_text(encoding="utf-8")

    assert "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS outlet_id" in source
    assert "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS staff_id" in source
    assert "ALTER TABLE orders ADD COLUMN IF NOT EXISTS expires_at" in source
    assert "ROW_NUMBER() OVER" in source
    assert "SET status = 'Expired'" in source
    assert "CREATE INDEX IF NOT EXISTS ix_audit_logs_staff_id" in source
    assert "CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_one_active_draft_per_cashier" in source
    assert "audit_logs_outlet_id_fkey" in source
    assert "audit_logs_staff_id_fkey" in source
    assert "op.drop_column" not in source


def test_verification_index_cleanup_migration_is_additive():
    migration = Path("alembic/versions/0027_verification_index_cleanup.py")
    source = migration.read_text(encoding="utf-8")

    assert "status = 'Expired'" in source
    assert "business_profile_id IS NULL" in source
    assert "CREATE INDEX IF NOT EXISTS ix_order_items_product_id" in source
    assert "CREATE INDEX IF NOT EXISTS ix_invoice_items_order_item_id" in source
    assert "DROP TABLE" not in source
    assert "DELETE FROM" not in source


def test_invoice_asset_removal_migration_drops_only_invoice_assets():
    migration = Path("alembic/versions/0028_remove_invoice_branding_assets.py")
    source = migration.read_text(encoding="utf-8")

    assert "DROP COLUMN IF EXISTS invoice_logo_url" in source
    assert "DROP COLUMN IF EXISTS invoice_logo_path" in source
    assert "DROP COLUMN IF EXISTS invoice_watermark_url" in source
    assert "DROP COLUMN IF EXISTS invoice_watermark_path" in source
    assert "DROP COLUMN IF EXISTS invoice_watermark_enabled" in source
    assert "DROP COLUMN IF EXISTS invoice_watermark_opacity" in source
    assert "invoice_company_name" not in source
    assert "DROP TABLE" not in source
