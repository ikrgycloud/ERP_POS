ALTER TABLE inventory_ledger
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
    ADD COLUMN IF NOT EXISTS user_id VARCHAR(80),
    ADD COLUMN IF NOT EXISTS source VARCHAR(40);

ALTER TABLE inventory_ledger
    ALTER COLUMN reference_id TYPE VARCHAR(80)
    USING reference_id::text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_ledger_idempotency_key
    ON inventory_ledger (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_inventory_ledger_user_id
    ON inventory_ledger (user_id);

CREATE INDEX IF NOT EXISTS ix_inventory_ledger_source
    ON inventory_ledger (source);

CREATE INDEX IF NOT EXISTS ix_inventory_ledger_reference
    ON inventory_ledger (reference_type, reference_id);
