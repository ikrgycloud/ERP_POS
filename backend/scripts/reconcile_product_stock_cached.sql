-- Rebuild product available stock without double-counting legacy backfill rows.
-- Legacy PURCHASE/SALE rows only cover the gap between product counters and real ledger movements.

UPDATE products
SET stock_cached = GREATEST(
    COALESCE(ledger.real_purchase, 0)
    + GREATEST(COALESCE(products.qty_bought, 0) - COALESCE(ledger.real_purchase, 0), 0)
    - COALESCE(ledger.real_sale, 0)
    - GREATEST(COALESCE(products.qty_sold, 0) - COALESCE(ledger.real_sale, 0), 0)
    + COALESCE(ledger.other_total, 0),
    0
)
FROM (
    SELECT
        p.id AS product_id,
        SUM(CASE WHEN il.type = 'PURCHASE' AND il.reference_type IS DISTINCT FROM 'LEGACY_BACKFILL' THEN ABS(il.quantity) ELSE 0 END) AS real_purchase,
        SUM(CASE WHEN il.type = 'SALE' AND il.reference_type IS DISTINCT FROM 'LEGACY_BACKFILL' THEN ABS(il.quantity) ELSE 0 END) AS real_sale,
        SUM(CASE WHEN il.type NOT IN ('PURCHASE', 'SALE') THEN il.quantity ELSE 0 END) AS other_total
    FROM products p
    LEFT JOIN inventory_ledger il ON il.product_id = p.id
    GROUP BY p.id
) AS ledger
WHERE products.id = ledger.product_id;
