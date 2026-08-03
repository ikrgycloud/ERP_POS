DROP INDEX IF EXISTS uq_products_barcode;
DROP INDEX IF EXISTS uq_products_sku;
DROP INDEX IF EXISTS ix_products_name;

ALTER TABLE products
    DROP CONSTRAINT IF EXISTS ck_products_stock_cached_non_negative;

ALTER TABLE inventory_ledger
    ALTER COLUMN type TYPE VARCHAR(30)
    USING type::text;

DROP TYPE IF EXISTS inventory_ledger_type;

ALTER TABLE products
    DROP COLUMN IF EXISTS stock_cached;
