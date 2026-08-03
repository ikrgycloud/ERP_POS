CREATE INDEX IF NOT EXISTS ix_products_business_active_created
    ON products (business_profile_id, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_products_business_sku
    ON products (business_profile_id, sku);

CREATE INDEX IF NOT EXISTS ix_products_business_barcode
    ON products (business_profile_id, barcode);

CREATE INDEX IF NOT EXISTS ix_products_business_name
    ON products (business_profile_id, name);

CREATE INDEX IF NOT EXISTS ix_products_business_low_stock
    ON products (business_profile_id, stock_cached, reorder_level)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS ix_inventory_ledger_business_product
    ON inventory_ledger (business_profile_id, product_id);

CREATE INDEX IF NOT EXISTS ix_orders_business_date_status
    ON orders (business_profile_id, date DESC, status);

CREATE INDEX IF NOT EXISTS ix_orders_business_type_date
    ON orders (business_profile_id, type, date DESC);

CREATE INDEX IF NOT EXISTS ix_orders_business_outlet_date
    ON orders (business_profile_id, outlet_id, date DESC);

CREATE INDEX IF NOT EXISTS ix_invoices_business_date_status
    ON invoices (business_profile_id, date DESC, status);

CREATE INDEX IF NOT EXISTS ix_invoices_business_type_date
    ON invoices (business_profile_id, invoice_type, date DESC);

CREATE INDEX IF NOT EXISTS ix_invoices_business_direction_date
    ON invoices (business_profile_id, invoice_direction, date DESC);

CREATE INDEX IF NOT EXISTS ix_waybills_generated_status
    ON waybills (generated_at DESC, status);

CREATE INDEX IF NOT EXISTS ix_uploaded_files_business_active_created
    ON uploaded_files (business_profile_id, is_active, created_at DESC);
