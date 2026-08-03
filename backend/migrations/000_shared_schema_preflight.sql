-- Compatibility bridge for databases initialized from the shared POS schema.
-- PostgreSQL enums do not inherit text functions, while the legacy ERP cache
-- migration normalizes this value with UPPER before converting it to the enum.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_ledger_type') THEN
        EXECUTE $function$
            CREATE OR REPLACE FUNCTION upper(inventory_ledger_type)
            RETURNS inventory_ledger_type
            LANGUAGE SQL
            IMMUTABLE
            STRICT
            PARALLEL SAFE
            AS 'SELECT $1'
        $function$;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.damage_categories') IS NOT NULL THEN
        ALTER TABLE damage_categories ALTER COLUMN requires_supplier_return SET DEFAULT FALSE;
        ALTER TABLE damage_categories ALTER COLUMN is_active SET DEFAULT TRUE;
        ALTER TABLE damage_categories ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;
    END IF;
END $$;

ALTER TABLE IF EXISTS product_quantities
    ADD COLUMN IF NOT EXISTS effective_date DATE,
    ADD COLUMN IF NOT EXISTS old_stock NUMERIC(12, 3),
    ADD COLUMN IF NOT EXISTS new_stock NUMERIC(12, 3),
    ADD COLUMN IF NOT EXISTS sold_stock NUMERIC(12, 3);
ALTER TABLE IF EXISTS product_qualities
    ADD COLUMN IF NOT EXISTS effective_date DATE;
ALTER TABLE IF EXISTS product_prices
    ADD COLUMN IF NOT EXISTS effective_date DATE;

-- SQLAlchemy client-side defaults are not database defaults. The ERP seed
-- migrations insert global workflow rows directly, so make those defaults
-- explicit when the table was bootstrapped from ORM metadata.
DO $$
BEGIN
    IF to_regclass('public.workflow_statuses') IS NOT NULL THEN
        ALTER TABLE workflow_statuses ALTER COLUMN sequence SET DEFAULT 0;
        ALTER TABLE workflow_statuses ALTER COLUMN is_initial SET DEFAULT FALSE;
        ALTER TABLE workflow_statuses ALTER COLUMN is_terminal SET DEFAULT FALSE;
        ALTER TABLE workflow_statuses ALTER COLUMN is_active SET DEFAULT TRUE;
        ALTER TABLE workflow_statuses ALTER COLUMN allowed_next SET DEFAULT '[]'::jsonb;
        ALTER TABLE workflow_statuses ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;
    END IF;
END $$;
