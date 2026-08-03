DELETE FROM document_sequences
WHERE family LIKE 'product-sku:business:%'
   OR family = 'product-barcode:global';

DROP INDEX IF EXISTS ix_products_business_sku_unique;
DROP INDEX IF EXISTS ix_products_business_barcode_unique;
