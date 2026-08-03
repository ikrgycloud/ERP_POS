ALTER TABLE supplier_returns
    ADD COLUMN IF NOT EXISTS supplier_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS document_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE supplier_return_items
    ADD COLUMN IF NOT EXISTS product_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE damaged_inventory
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS ix_supplier_returns_version
    ON supplier_returns (id, version);

CREATE INDEX IF NOT EXISTS ix_supplier_return_items_version
    ON supplier_return_items (id, version);

CREATE INDEX IF NOT EXISTS ix_damaged_inventory_version
    ON damaged_inventory (id, version);

CREATE TABLE IF NOT EXISTS domain_events (
    id SERIAL PRIMARY KEY,
    event_id VARCHAR(80) NOT NULL UNIQUE,
    event_type VARCHAR(120) NOT NULL,
    aggregate_type VARCHAR(80) NOT NULL,
    aggregate_id VARCHAR(80) NOT NULL,
    business_profile_id INTEGER REFERENCES business_profiles(id),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_domain_events_type_created
    ON domain_events (event_type, created_at);

CREATE INDEX IF NOT EXISTS ix_domain_events_aggregate
    ON domain_events (aggregate_type, aggregate_id);

CREATE INDEX IF NOT EXISTS ix_domain_events_unprocessed
    ON domain_events (processed_at, created_at)
    WHERE processed_at IS NULL;
