SELECT business_profile_id, sku, COUNT(*) AS duplicate_count
FROM products
WHERE sku IS NOT NULL AND btrim(sku) <> ''
GROUP BY business_profile_id, sku
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, business_profile_id, sku;

SELECT business_profile_id, barcode, COUNT(*) AS duplicate_count
FROM products
WHERE barcode IS NOT NULL AND btrim(barcode) <> ''
GROUP BY business_profile_id, barcode
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, business_profile_id, barcode;

SELECT conflict_type, COUNT(*) AS resolved_count
FROM product_identifier_conflicts
GROUP BY conflict_type
ORDER BY conflict_type;
