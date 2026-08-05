"""Harden inventory ledger with cached product stock.

Revision ID: 0006_inventory_cache_hardening
Revises: 0005_inventory_ledger
Create Date: 2026-07-13
"""
from alembic import op


revision = "0006_inventory_cache_hardening"
down_revision = "0005_inventory_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_ledger_type') THEN
                CREATE TYPE inventory_ledger_type AS ENUM ('PURCHASE', 'SALE', 'RETURN', 'DAMAGE', 'ADJUSTMENT');
            END IF;
        END $$;
        """
    )
    op.execute(
        """
        ALTER TABLE products
        ADD COLUMN IF NOT EXISTS stock_cached NUMERIC(14, 3) NOT NULL DEFAULT 0
        """
    )
    op.execute("UPDATE inventory_ledger SET type = UPPER(type) WHERE type IS NOT NULL")
    op.execute(
        """
        UPDATE inventory_ledger
        SET type = 'ADJUSTMENT'
        WHERE type NOT IN ('PURCHASE', 'SALE', 'RETURN', 'DAMAGE', 'ADJUSTMENT')
        """
    )
    op.execute(
        """
        ALTER TABLE inventory_ledger
        ALTER COLUMN type TYPE inventory_ledger_type
        USING type::inventory_ledger_type
        """
    )
    op.execute(
        """
        UPDATE products
        SET stock_cached = COALESCE(stock_totals.stock, 0)
        FROM (
            SELECT product_id, COALESCE(SUM(quantity), 0) AS stock
            FROM inventory_ledger
            GROUP BY product_id
        ) stock_totals
        WHERE products.id = stock_totals.product_id
        """
    )
    op.execute(
        """
        UPDATE products
        SET stock_cached = 0
        WHERE id NOT IN (SELECT DISTINCT product_id FROM inventory_ledger)
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'ck_products_stock_cached_non_negative'
            ) THEN
                ALTER TABLE products
                ADD CONSTRAINT ck_products_stock_cached_non_negative
                CHECK (stock_cached >= 0)
                NOT VALID;
            END IF;
        END $$;
        """
    )
    op.execute("ALTER TABLE products VALIDATE CONSTRAINT ck_products_stock_cached_non_negative")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_products_sku ON products (sku)")
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_products_barcode
        ON products (barcode)
        WHERE barcode IS NOT NULL AND barcode <> ''
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_products_name ON products (name)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_inventory_ledger_product_id ON inventory_ledger (product_id)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_inventory_ledger_business_profile_id ON inventory_ledger (business_profile_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_products_barcode")
    op.execute("DROP INDEX IF EXISTS uq_products_sku")
    op.execute("DROP INDEX IF EXISTS ix_products_name")
    op.execute("ALTER TABLE products DROP CONSTRAINT IF EXISTS ck_products_stock_cached_non_negative")
    op.execute(
        """
        ALTER TABLE inventory_ledger
        ALTER COLUMN type TYPE VARCHAR(30)
        USING type::text
        """
    )
    op.execute("DROP TYPE IF EXISTS inventory_ledger_type")
    op.drop_column("products", "stock_cached")
