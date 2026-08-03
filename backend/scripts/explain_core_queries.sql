EXPLAIN (ANALYZE, BUFFERS)
SELECT id, sku, barcode, name, stock_cached
FROM products
WHERE business_profile_id = :business_profile_id
  AND is_active = TRUE
  AND sku = :sku
LIMIT 1;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, sku, barcode, name, stock_cached
FROM products
WHERE business_profile_id = :business_profile_id
  AND is_active = TRUE
  AND barcode = :barcode
LIMIT 1;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, sku, barcode, name, stock_cached
FROM products
WHERE business_profile_id = :business_profile_id
  AND is_active = TRUE
  AND name ILIKE '%' || :search || '%'
ORDER BY id DESC
LIMIT 100;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, invoice_number, date, status
FROM invoices
WHERE business_profile_id = :business_profile_id
  AND date BETWEEN :start_date AND :end_date
ORDER BY id DESC
LIMIT 100;

EXPLAIN (ANALYZE, BUFFERS)
SELECT product_id, SUM(quantity)
FROM inventory_ledger
WHERE business_profile_id = :business_profile_id
  AND product_id = :product_id
GROUP BY product_id;
