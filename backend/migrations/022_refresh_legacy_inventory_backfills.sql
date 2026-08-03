BEGIN;

CREATE TEMP TABLE inventory_before_reconciliation ON COMMIT DROP AS
SELECT id AS product_id, business_profile_id, stock_cached AS old_stock
FROM products
WHERE is_active = TRUE;

DELETE FROM inventory_ledger
WHERE reference_type = 'LEGACY_BACKFILL'
  AND type IN ('PURCHASE', 'SALE');

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
LEFT JOIN (
    SELECT product_id, SUM(ABS(quantity)) AS quantity
    FROM inventory_ledger
    WHERE type = 'PURCHASE'
    GROUP BY product_id
) real_purchase ON real_purchase.product_id = product.id
WHERE product.is_active = TRUE
  AND product.qty_bought - COALESCE(real_purchase.quantity, 0) > 0;

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
LEFT JOIN (
    SELECT product_id, SUM(ABS(quantity)) AS quantity
    FROM inventory_ledger
    WHERE type = 'SALE'
    GROUP BY product_id
) real_sale ON real_sale.product_id = product.id
WHERE product.is_active = TRUE
  AND product.qty_sold - COALESCE(real_sale.quantity, 0) > 0;

UPDATE products product
SET stock_cached = COALESCE(ledger.stock, 0), updated_at = CURRENT_TIMESTAMP
FROM inventory_before_reconciliation target
LEFT JOIN (
    SELECT product_id, SUM(quantity) AS stock
    FROM inventory_ledger
    GROUP BY product_id
) ledger ON ledger.product_id = target.product_id
WHERE product.id = target.product_id;

INSERT INTO product_quantities (
    product_id, business_profile_id, transaction_type, quantity_change,
    old_stock, new_stock, sold_stock, effective_date, remaining_quantity,
    note, created_at, updated_at
)
SELECT
    product.id, product.business_profile_id, 'legacy_backfill_reconciliation',
    product.stock_cached - target.old_stock, target.old_stock, product.stock_cached,
    product.qty_sold, CURRENT_DATE, product.stock_cached,
    'Refreshed legacy placeholders against completed inventory transactions',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM inventory_before_reconciliation target
JOIN products product ON product.id = target.product_id
WHERE product.stock_cached <> target.old_stock;

COMMIT;
