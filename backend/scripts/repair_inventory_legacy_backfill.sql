-- Repairs duplicated compatibility inventory rows.
--
-- Older startup backfill logic inserted full LEGACY_BACKFILL PURCHASE/SALE
-- rows even when ERP/POS ledger rows already existed. This script rebuilds
-- those synthetic rows as only the missing gap between product counters and
-- real ledger activity, then refreshes products.stock_cached from the ledger.

BEGIN;

DELETE FROM inventory_ledger
WHERE reference_type = 'LEGACY_BACKFILL'
  AND type IN ('PURCHASE', 'SALE');

INSERT INTO inventory_ledger (
    product_id,
    business_profile_id,
    outlet_id,
    type,
    quantity,
    reference_type,
    reference_id,
    idempotency_key,
    source
)
SELECT
    p.id,
    p.business_profile_id,
    NULL,
    'PURCHASE',
    COALESCE(p.qty_bought, 0) - COALESCE(real_purchase.quantity, 0),
    'LEGACY_BACKFILL',
    p.id::text,
    'ERP:LEGACY_BACKFILL:PURCHASE:' || p.id::text,
    'ERP_BACKFILL'
FROM products p
LEFT JOIN (
    SELECT product_id, COALESCE(SUM(quantity), 0) AS quantity
    FROM inventory_ledger
    WHERE type = 'PURCHASE'
      AND reference_type IS DISTINCT FROM 'LEGACY_BACKFILL'
    GROUP BY product_id
) real_purchase ON real_purchase.product_id = p.id
WHERE COALESCE(p.qty_bought, 0) - COALESCE(real_purchase.quantity, 0) > 0;

INSERT INTO inventory_ledger (
    product_id,
    business_profile_id,
    outlet_id,
    type,
    quantity,
    reference_type,
    reference_id,
    idempotency_key,
    source
)
SELECT
    p.id,
    p.business_profile_id,
    NULL,
    'SALE',
    -(COALESCE(p.qty_sold, 0) - COALESCE(real_sale.quantity, 0)),
    'LEGACY_BACKFILL',
    p.id::text,
    'ERP:LEGACY_BACKFILL:SALE:' || p.id::text,
    'ERP_BACKFILL'
FROM products p
LEFT JOIN (
    SELECT product_id, COALESCE(SUM(ABS(quantity)), 0) AS quantity
    FROM inventory_ledger
    WHERE type = 'SALE'
      AND reference_type IS DISTINCT FROM 'LEGACY_BACKFILL'
    GROUP BY product_id
) real_sale ON real_sale.product_id = p.id
WHERE COALESCE(p.qty_sold, 0) - COALESCE(real_sale.quantity, 0) > 0;

UPDATE products
SET stock_cached = COALESCE((
    SELECT SUM(quantity)
    FROM inventory_ledger
    WHERE inventory_ledger.product_id = products.id
), 0);

COMMIT;
