CREATE TABLE IF NOT EXISTS document_sequences (
    family VARCHAR(40) PRIMARY KEY,
    next_value BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE document_sequences
    ALTER COLUMN next_value TYPE BIGINT;

WITH sku_sequences AS (
    SELECT
        'product-sku:business:' ||
            COALESCE(lpad(business_profile_id::text, 6, '0'), 'GLOBAL') AS family,
        COALESCE(
            MAX(
                CASE
                    WHEN sku ~ '^SKU-BP[0-9]{6}-[0-9]{6}$'
                    THEN substring(sku from '-([0-9]{6})$')::int
                    ELSE 0
                END
            ),
            0
        ) + 1 AS next_value
    FROM products
    GROUP BY business_profile_id
)
INSERT INTO document_sequences (family, next_value)
SELECT family, next_value
FROM sku_sequences
ON CONFLICT (family)
DO UPDATE SET next_value = GREATEST(document_sequences.next_value, EXCLUDED.next_value);

WITH barcode_sequence AS (
    SELECT
        'product-barcode:global' AS family,
        COALESCE(
            MAX(
                CASE
                    WHEN barcode ~ '^29[0-9]{11}$'
                    THEN substring(barcode from 3)::bigint
                    ELSE 0
                END
            ),
            0
        ) + 1 AS next_value
    FROM products
)
INSERT INTO document_sequences (family, next_value)
SELECT family, next_value
FROM barcode_sequence
ON CONFLICT (family)
DO UPDATE SET next_value = GREATEST(document_sequences.next_value, EXCLUDED.next_value);

CREATE UNIQUE INDEX IF NOT EXISTS ix_products_business_sku_unique
    ON products (business_profile_id, sku);

CREATE UNIQUE INDEX IF NOT EXISTS ix_products_business_barcode_unique
    ON products (business_profile_id, barcode)
    WHERE barcode IS NOT NULL AND btrim(barcode) <> '';
