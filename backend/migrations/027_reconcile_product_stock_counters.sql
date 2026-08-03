-- POS compatibility startup previously added full product totals as legacy
-- rows even when ERP had already recorded those purchases and sales. Rebuild
-- legacy rows from only the quantities missing from real ledger movements.
BEGIN;

DELETE FROM inventory_ledger
WHERE reference_type = 'LEGACY_BACKFILL'
  AND type IN ('PURCHASE', 'SALE');

WITH real_purchase AS (
    SELECT
        product_id,
        COALESCE(SUM(ABS(quantity)), 0) AS quantity
    FROM inventory_ledger
    WHERE type = 'PURCHASE'
    GROUP BY product_id
)
INSERT INTO inventory_ledger (
    product_id, business_profile_id, outlet_id, type, quantity,
    reference_type, reference_id, idempotency_key, source
)
SELECT
    product.id, product.business_profile_id, NULL, 'PURCHASE',
    product.qty_bought - COALESCE(real_purchase.quantity, 0),
    'LEGACY_BACKFILL', product.id::text,
    'ERP:LEGACY_BACKFILL:PURCHASE:' || product.id::text, 'ERP_BACKFILL'
FROM products product
LEFT JOIN real_purchase ON real_purchase.product_id = product.id
WHERE product.qty_bought > COALESCE(real_purchase.quantity, 0);

WITH real_sale AS (
    SELECT
        product_id,
        COALESCE(SUM(ABS(quantity)), 0) AS quantity
    FROM inventory_ledger
    WHERE type = 'SALE'
    GROUP BY product_id
)
INSERT INTO inventory_ledger (
    product_id, business_profile_id, outlet_id, type, quantity,
    reference_type, reference_id, idempotency_key, source
)
SELECT
    product.id, product.business_profile_id, NULL, 'SALE',
    -(product.qty_sold - COALESCE(real_sale.quantity, 0)),
    'LEGACY_BACKFILL', product.id::text,
    'ERP:LEGACY_BACKFILL:SALE:' || product.id::text, 'ERP_BACKFILL'
FROM products product
LEFT JOIN real_sale ON real_sale.product_id = product.id
WHERE product.qty_sold > COALESCE(real_sale.quantity, 0);

UPDATE products
SET stock_cached = GREATEST(COALESCE(ledger.stock, 0), 0),
    updated_at = CURRENT_TIMESTAMP
FROM (
    SELECT product_id, SUM(quantity) AS stock
    FROM inventory_ledger
    GROUP BY product_id
) ledger
WHERE products.id = ledger.product_id;

UPDATE products
SET stock_cached = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE id NOT IN (SELECT DISTINCT product_id FROM inventory_ledger);

COMMIT;
