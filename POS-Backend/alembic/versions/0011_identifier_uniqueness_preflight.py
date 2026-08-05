"""identifier uniqueness preflight for shared products"""

from alembic import op

revision = "0011_identifier_uniqueness_preflight"
down_revision = "0010_search_trigram_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS product_identifier_conflicts (
            id BIGSERIAL PRIMARY KEY,
            product_id INTEGER NOT NULL,
            business_profile_id INTEGER,
            conflict_type VARCHAR(20) NOT NULL,
            old_value VARCHAR(80),
            new_value VARCHAR(80),
            resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute("ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key")
    op.execute("UPDATE products SET barcode = NULL WHERE barcode IS NOT NULL AND btrim(barcode) = ''")
    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                business_profile_id,
                sku AS old_sku,
                LEFT(sku, 68) || '-' || id::text AS new_sku,
                ROW_NUMBER() OVER (
                    PARTITION BY business_profile_id, sku
                    ORDER BY is_active DESC, id ASC
                ) AS duplicate_rank
            FROM products
            WHERE sku IS NOT NULL AND btrim(sku) <> ''
        ),
        duplicates AS (
            SELECT * FROM ranked WHERE duplicate_rank > 1
        )
        INSERT INTO product_identifier_conflicts (
            product_id,
            business_profile_id,
            conflict_type,
            old_value,
            new_value
        )
        SELECT id, business_profile_id, 'sku', old_sku, new_sku
        FROM duplicates
        """
    )
    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                LEFT(sku, 68) || '-' || id::text AS new_sku,
                ROW_NUMBER() OVER (
                    PARTITION BY business_profile_id, sku
                    ORDER BY is_active DESC, id ASC
                ) AS duplicate_rank
            FROM products
            WHERE sku IS NOT NULL AND btrim(sku) <> ''
        )
        UPDATE products AS product
        SET sku = ranked.new_sku
        FROM ranked
        WHERE product.id = ranked.id
          AND ranked.duplicate_rank > 1
        """
    )
    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                business_profile_id,
                barcode AS old_barcode,
                LEFT(barcode, 68) || '-' || id::text AS new_barcode,
                ROW_NUMBER() OVER (
                    PARTITION BY business_profile_id, barcode
                    ORDER BY is_active DESC, id ASC
                ) AS duplicate_rank
            FROM products
            WHERE barcode IS NOT NULL AND btrim(barcode) <> ''
        ),
        duplicates AS (
            SELECT * FROM ranked WHERE duplicate_rank > 1
        )
        INSERT INTO product_identifier_conflicts (
            product_id,
            business_profile_id,
            conflict_type,
            old_value,
            new_value
        )
        SELECT id, business_profile_id, 'barcode', old_barcode, new_barcode
        FROM duplicates
        """
    )
    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                LEFT(barcode, 68) || '-' || id::text AS new_barcode,
                ROW_NUMBER() OVER (
                    PARTITION BY business_profile_id, barcode
                    ORDER BY is_active DESC, id ASC
                ) AS duplicate_rank
            FROM products
            WHERE barcode IS NOT NULL AND btrim(barcode) <> ''
        )
        UPDATE products AS product
        SET barcode = ranked.new_barcode
        FROM ranked
        WHERE product.id = ranked.id
          AND ranked.duplicate_rank > 1
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'uq_products_business_sku'
            ) THEN
                DROP INDEX IF EXISTS uq_products_business_sku;
                ALTER TABLE products
                ADD CONSTRAINT uq_products_business_sku UNIQUE (business_profile_id, sku);
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'uq_products_business_barcode'
            ) THEN
                ALTER TABLE products
                ADD CONSTRAINT uq_products_business_barcode UNIQUE (business_profile_id, barcode);
            END IF;
        END $$
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE products DROP CONSTRAINT IF EXISTS uq_products_business_barcode")
    op.execute("ALTER TABLE products DROP CONSTRAINT IF EXISTS uq_products_business_sku")
    op.execute("DROP TABLE IF EXISTS product_identifier_conflicts")
