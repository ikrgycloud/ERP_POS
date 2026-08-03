BEGIN;

-- Rebuild synthetic legacy entries after duplicate product masters have been
-- consolidated. This prevents each former product's backfill from being counted
-- again on the canonical product.
CREATE TEMP TABLE duplicate_inventory_reconciliation ON COMMIT DROP AS
SELECT DISTINCT
    merged.canonical_product_id AS product_id,
    product.stock_cached AS old_stock
FROM product_duplicate_merges merged
JOIN products product ON product.id = merged.canonical_product_id;

DELETE FROM inventory_ledger ledger
USING duplicate_inventory_reconciliation target
WHERE ledger.product_id = target.product_id
  AND ledger.reference_type = 'LEGACY_BACKFILL'
  AND ledger.type IN ('PURCHASE', 'SALE');

INSERT INTO inventory_ledger (
    product_id, business_profile_id, outlet_id, type, quantity,
    reference_type, reference_id, idempotency_key, source
)
SELECT
    product.id, product.business_profile_id, NULL, 'PURCHASE',
    product.qty_bought - COALESCE(real_purchase.quantity, 0),
    'LEGACY_BACKFILL', product.id::text,
    'ERP:LEGACY_BACKFILL:PURCHASE:' || product.id::text, 'ERP_BACKFILL'
FROM duplicate_inventory_reconciliation target
JOIN products product ON product.id = target.product_id
LEFT JOIN (
    SELECT product_id, SUM(quantity) AS quantity
    FROM inventory_ledger
    WHERE type = 'PURCHASE'
      AND reference_type IS DISTINCT FROM 'LEGACY_BACKFILL'
    GROUP BY product_id
) real_purchase ON real_purchase.product_id = product.id
WHERE product.qty_bought - COALESCE(real_purchase.quantity, 0) > 0
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO inventory_ledger (
    product_id, business_profile_id, outlet_id, type, quantity,
    reference_type, reference_id, idempotency_key, source
)
SELECT
    product.id, product.business_profile_id, NULL, 'SALE',
    -(product.qty_sold - COALESCE(real_sale.quantity, 0)),
    'LEGACY_BACKFILL', product.id::text,
    'ERP:LEGACY_BACKFILL:SALE:' || product.id::text, 'ERP_BACKFILL'
FROM duplicate_inventory_reconciliation target
JOIN products product ON product.id = target.product_id
LEFT JOIN (
    SELECT product_id, SUM(ABS(quantity)) AS quantity
    FROM inventory_ledger
    WHERE type = 'SALE'
      AND reference_type IS DISTINCT FROM 'LEGACY_BACKFILL'
    GROUP BY product_id
) real_sale ON real_sale.product_id = product.id
WHERE product.qty_sold - COALESCE(real_sale.quantity, 0) > 0
ON CONFLICT (idempotency_key) DO NOTHING;

UPDATE products product
SET
    stock_cached = COALESCE(ledger.stock, 0),
    updated_at = CURRENT_TIMESTAMP
FROM duplicate_inventory_reconciliation target
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
    product.id, product.business_profile_id, 'inventory_reconciliation',
    product.stock_cached - target.old_stock, target.old_stock,
    product.stock_cached, product.qty_sold, CURRENT_DATE,
    product.stock_cached,
    'Removed duplicate legacy inventory backfill after product consolidation',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM duplicate_inventory_reconciliation target
JOIN products product ON product.id = target.product_id
WHERE product.stock_cached <> target.old_stock
  AND NOT EXISTS (
      SELECT 1
      FROM product_quantities history
      WHERE history.product_id = product.id
        AND history.transaction_type = 'inventory_reconciliation'
        AND history.note = 'Removed duplicate legacy inventory backfill after product consolidation'
  );

COMMIT;
