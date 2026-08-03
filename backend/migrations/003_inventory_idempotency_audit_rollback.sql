DROP INDEX IF EXISTS uq_inventory_ledger_idempotency_key;
DROP INDEX IF EXISTS ix_inventory_ledger_user_id;
DROP INDEX IF EXISTS ix_inventory_ledger_source;

ALTER TABLE inventory_ledger
    ALTER COLUMN reference_id TYPE INTEGER
    USING CASE
        WHEN reference_id ~ '^[0-9]+$' THEN reference_id::integer
        ELSE NULL
    END;

ALTER TABLE inventory_ledger
    DROP COLUMN IF EXISTS idempotency_key,
    DROP COLUMN IF EXISTS user_id,
    DROP COLUMN IF EXISTS source;
