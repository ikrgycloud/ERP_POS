BEGIN;

CREATE TABLE IF NOT EXISTS product_duplicate_merges (
    duplicate_product_id INTEGER PRIMARY KEY,
    canonical_product_id INTEGER NOT NULL,
    business_profile_id INTEGER,
    duplicate_name VARCHAR(180) NOT NULL,
    duplicate_sku VARCHAR(80) NOT NULL,
    duplicate_barcode VARCHAR(80),
    duplicate_snapshot JSONB NOT NULL,
    merged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TEMP TABLE duplicate_product_map ON COMMIT DROP AS
WITH ranked AS (
    SELECT
        id,
        FIRST_VALUE(id) OVER (
            PARTITION BY COALESCE(business_profile_id, 0), LOWER(REGEXP_REPLACE(BTRIM(name), '\s+', ' ', 'g'))
            ORDER BY created_at, id
        ) AS canonical_id,
        ROW_NUMBER() OVER (
            PARTITION BY COALESCE(business_profile_id, 0), LOWER(REGEXP_REPLACE(BTRIM(name), '\s+', ' ', 'g'))
            ORDER BY created_at, id
        ) AS duplicate_rank
    FROM products
    WHERE is_active = TRUE
)
SELECT id AS duplicate_id, canonical_id
FROM ranked
WHERE duplicate_rank > 1;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM duplicate_product_map map
        JOIN order_items duplicate_item ON duplicate_item.product_id = map.duplicate_id
        JOIN order_items canonical_item
          ON canonical_item.order_id = duplicate_item.order_id
         AND canonical_item.product_id = map.canonical_id
    ) THEN
        RAISE EXCEPTION 'Cannot merge duplicate products used together in the same order';
    END IF;
END $$;

CREATE TEMP TABLE product_merge_totals ON COMMIT DROP AS
SELECT
    map.canonical_id,
    SUM(duplicate.qty_bought) AS duplicate_qty_bought,
    SUM(duplicate.qty_sold) AS duplicate_qty_sold,
    SUM(duplicate.stock_cached) AS duplicate_stock_cached
FROM duplicate_product_map map
JOIN products duplicate ON duplicate.id = map.duplicate_id
GROUP BY map.canonical_id;

INSERT INTO product_duplicate_merges (
    duplicate_product_id,
    canonical_product_id,
    business_profile_id,
    duplicate_name,
    duplicate_sku,
    duplicate_barcode,
    duplicate_snapshot
)
SELECT
    duplicate.id,
    map.canonical_id,
    duplicate.business_profile_id,
    duplicate.name,
    duplicate.sku,
    duplicate.barcode,
    TO_JSONB(duplicate)
FROM duplicate_product_map map
JOIN products duplicate ON duplicate.id = map.duplicate_id
ON CONFLICT (duplicate_product_id) DO NOTHING;

UPDATE order_items target SET product_id = map.canonical_id FROM duplicate_product_map map WHERE target.product_id = map.duplicate_id;
UPDATE inventory_ledger target SET product_id = map.canonical_id FROM duplicate_product_map map WHERE target.product_id = map.duplicate_id;
UPDATE product_quantities target SET product_id = map.canonical_id FROM duplicate_product_map map WHERE target.product_id = map.duplicate_id;
UPDATE product_discounts target SET product_id = map.canonical_id FROM duplicate_product_map map WHERE target.product_id = map.duplicate_id;
UPDATE product_qualities target SET product_id = map.canonical_id FROM duplicate_product_map map WHERE target.product_id = map.duplicate_id;
UPDATE product_prices target SET product_id = map.canonical_id FROM duplicate_product_map map WHERE target.product_id = map.duplicate_id;
UPDATE damaged_inventory target SET product_id = map.canonical_id FROM duplicate_product_map map WHERE target.product_id = map.duplicate_id;
UPDATE inspection_reports target SET product_id = map.canonical_id FROM duplicate_product_map map WHERE target.product_id = map.duplicate_id;
UPDATE return_items target SET product_id = map.canonical_id FROM duplicate_product_map map WHERE target.product_id = map.duplicate_id;
UPDATE supplier_return_items target SET product_id = map.canonical_id FROM duplicate_product_map map WHERE target.product_id = map.duplicate_id;
UPDATE supplier_return_replacements target SET product_id = map.canonical_id FROM duplicate_product_map map WHERE target.product_id = map.duplicate_id;
UPDATE supplier_return_replacements target SET replacement_product_id = map.canonical_id FROM duplicate_product_map map WHERE target.replacement_product_id = map.duplicate_id;

UPDATE products canonical
SET
    qty_bought = canonical.qty_bought + totals.duplicate_qty_bought,
    qty_sold = canonical.qty_sold + totals.duplicate_qty_sold,
    stock_cached = canonical.stock_cached + totals.duplicate_stock_cached,
    reorder_level = GREATEST(canonical.reorder_level, canonical.qty_sold + totals.duplicate_qty_sold),
    updated_at = CURRENT_TIMESTAMP
FROM product_merge_totals totals
WHERE canonical.id = totals.canonical_id;

INSERT INTO product_quantities (
    product_id,
    business_profile_id,
    transaction_type,
    quantity_change,
    old_stock,
    new_stock,
    sold_stock,
    effective_date,
    remaining_quantity,
    note,
    created_at,
    updated_at
)
SELECT
    canonical.id,
    canonical.business_profile_id,
    'duplicate_merge',
    totals.duplicate_stock_cached,
    canonical.stock_cached - totals.duplicate_stock_cached,
    canonical.stock_cached,
    canonical.qty_sold,
    CURRENT_DATE,
    canonical.stock_cached,
    'Consolidated duplicate product masters while preserving inventory history',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM product_merge_totals totals
JOIN products canonical ON canonical.id = totals.canonical_id;

UPDATE products duplicate
SET
    is_active = FALSE,
    qty_bought = 0,
    qty_sold = 0,
    stock_cached = 0,
    reorder_level = 0,
    updated_at = CURRENT_TIMESTAMP
FROM duplicate_product_map map
WHERE duplicate.id = map.duplicate_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_business_normalized_name
ON products (
    COALESCE(business_profile_id, 0),
    LOWER(REGEXP_REPLACE(BTRIM(name), '\s+', ' ', 'g'))
)
WHERE is_active = TRUE;

COMMIT;
