ALTER TABLE products DROP CONSTRAINT IF EXISTS uq_products_business_barcode;
ALTER TABLE products DROP CONSTRAINT IF EXISTS uq_products_business_sku;
DROP TABLE IF EXISTS product_identifier_conflicts;
