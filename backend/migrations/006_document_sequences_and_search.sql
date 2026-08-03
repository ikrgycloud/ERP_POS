CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS document_sequences (
    family VARCHAR(40) PRIMARY KEY,
    next_value INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO document_sequences (family, next_value)
SELECT family, max_sequence + 1
FROM (
    SELECT 'ORD-' || EXTRACT(YEAR FROM date)::int::text AS family,
           COALESCE(MAX(substring(order_number from '-([0-9]+)$')::int), 0) AS max_sequence
    FROM orders
    WHERE order_number ~ '-[0-9]+$'
    GROUP BY EXTRACT(YEAR FROM date)
    UNION ALL
    SELECT 'INV-' || EXTRACT(YEAR FROM date)::int::text AS family,
           COALESCE(MAX(substring(invoice_number from '-([0-9]+)$')::int), 0) AS max_sequence
    FROM invoices
    WHERE invoice_number ~ '-[0-9]+$'
    GROUP BY EXTRACT(YEAR FROM date)
    UNION ALL
    SELECT 'WB-' || EXTRACT(YEAR FROM generated_at)::int::text AS family,
           COALESCE(MAX(substring(waybill_number from '-([0-9]+)$')::int), 0) AS max_sequence
    FROM waybills
    WHERE waybill_number ~ '-[0-9]+$'
    GROUP BY EXTRACT(YEAR FROM generated_at)
) seeds
ON CONFLICT (family) DO NOTHING;

CREATE INDEX IF NOT EXISTS ix_products_name_trgm
    ON products USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_customers_name_trgm
    ON customers USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_suppliers_name_trgm
    ON suppliers USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_orders_party_name_trgm
    ON orders USING gin (party_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_invoices_party_name_trgm
    ON invoices USING gin (party_name gin_trgm_ops);
