CREATE TABLE IF NOT EXISTS inventory_ledger (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    business_profile_id INTEGER NULL REFERENCES business_profiles(id),
    outlet_id INTEGER NULL REFERENCES outlets(id),
    type VARCHAR(30) NOT NULL,
    quantity NUMERIC(12, 3) NOT NULL,
    reference_type VARCHAR(40) NULL,
    reference_id INTEGER NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_inventory_ledger_product_id
    ON inventory_ledger (product_id);

CREATE INDEX IF NOT EXISTS ix_inventory_ledger_business_profile_id
    ON inventory_ledger (business_profile_id);

CREATE INDEX IF NOT EXISTS ix_inventory_ledger_outlet_id
    ON inventory_ledger (outlet_id);

CREATE INDEX IF NOT EXISTS ix_inventory_ledger_reference
    ON inventory_ledger (reference_type, reference_id);

CREATE INDEX IF NOT EXISTS ix_products_sku
    ON products (sku);

CREATE INDEX IF NOT EXISTS ix_products_barcode
    ON products (barcode);

INSERT INTO inventory_ledger (product_id, business_profile_id, outlet_id, type, quantity, reference_type, reference_id)
SELECT p.id, p.business_profile_id, NULL, 'PURCHASE', p.qty_bought, 'LEGACY_BACKFILL', p.id
FROM products p
WHERE COALESCE(p.qty_bought, 0) <> 0
AND NOT EXISTS (
    SELECT 1 FROM inventory_ledger il
    WHERE il.product_id = p.id
    AND il.reference_type = 'LEGACY_BACKFILL'
    AND il.type = 'PURCHASE'
);

INSERT INTO inventory_ledger (product_id, business_profile_id, outlet_id, type, quantity, reference_type, reference_id)
SELECT p.id, p.business_profile_id, NULL, 'SALE', -p.qty_sold, 'LEGACY_BACKFILL', p.id
FROM products p
WHERE COALESCE(p.qty_sold, 0) <> 0
AND NOT EXISTS (
    SELECT 1 FROM inventory_ledger il
    WHERE il.product_id = p.id
    AND il.reference_type = 'LEGACY_BACKFILL'
    AND il.type = 'SALE'
);
