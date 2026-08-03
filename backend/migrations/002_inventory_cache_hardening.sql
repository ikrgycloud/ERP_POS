DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_ledger_type') THEN
        CREATE TYPE inventory_ledger_type AS ENUM ('PURCHASE', 'SALE', 'RETURN', 'DAMAGE', 'ADJUSTMENT');
    END IF;
END $$;

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS stock_cached NUMERIC(14, 3) NOT NULL DEFAULT 0;

UPDATE inventory_ledger
SET type = UPPER(type)
WHERE type IS NOT NULL;

UPDATE inventory_ledger
SET type = 'ADJUSTMENT'
WHERE type NOT IN ('PURCHASE', 'SALE', 'RETURN', 'DAMAGE', 'ADJUSTMENT');

ALTER TABLE inventory_ledger
    ALTER COLUMN type TYPE inventory_ledger_type
    USING type::inventory_ledger_type;

UPDATE products
SET stock_cached = COALESCE(stock_totals.stock, 0)
FROM (
    SELECT product_id, COALESCE(SUM(quantity), 0) AS stock
    FROM inventory_ledger
    GROUP BY product_id
) stock_totals
WHERE products.id = stock_totals.product_id;

UPDATE products
SET stock_cached = 0
WHERE id NOT IN (SELECT DISTINCT product_id FROM inventory_ledger);

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

ALTER TABLE products
    VALIDATE CONSTRAINT ck_products_stock_cached_non_negative;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_sku
    ON products (sku);

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_barcode
    ON products (barcode)
    WHERE barcode IS NOT NULL AND barcode <> '';

CREATE INDEX IF NOT EXISTS ix_products_name
    ON products (name);

CREATE INDEX IF NOT EXISTS ix_inventory_ledger_product_id
    ON inventory_ledger (product_id);

CREATE INDEX IF NOT EXISTS ix_inventory_ledger_business_profile_id
    ON inventory_ledger (business_profile_id);
