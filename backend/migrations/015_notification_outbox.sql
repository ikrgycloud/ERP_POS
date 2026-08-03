CREATE TABLE IF NOT EXISTS notification_outbox (
    id SERIAL PRIMARY KEY,
    idempotency_key VARCHAR(180) NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    aggregate_type VARCHAR(80) NOT NULL,
    aggregate_id VARCHAR(80) NOT NULL,
    business_profile_id INTEGER NULL REFERENCES business_profiles(id),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    next_attempt_at TIMESTAMPTZ NULL,
    last_error TEXT NULL,
    processed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_notification_outbox_idempotency_key UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_notification_outbox_event_type ON notification_outbox (event_type);
CREATE INDEX IF NOT EXISTS ix_notification_outbox_aggregate_type ON notification_outbox (aggregate_type);
CREATE INDEX IF NOT EXISTS ix_notification_outbox_aggregate_id ON notification_outbox (aggregate_id);
CREATE INDEX IF NOT EXISTS ix_notification_outbox_business_profile_id ON notification_outbox (business_profile_id);
CREATE INDEX IF NOT EXISTS ix_notification_outbox_status ON notification_outbox (status);
CREATE INDEX IF NOT EXISTS ix_notification_outbox_next_attempt_at ON notification_outbox (next_attempt_at);
CREATE INDEX IF NOT EXISTS ix_notification_outbox_due ON notification_outbox (status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS notification_history (
    id SERIAL PRIMARY KEY,
    outbox_id INTEGER NULL REFERENCES notification_outbox(id) ON DELETE SET NULL,
    business_profile_id INTEGER NULL REFERENCES business_profiles(id),
    event_type VARCHAR(80) NOT NULL,
    aggregate_type VARCHAR(80) NOT NULL,
    aggregate_id VARCHAR(80) NOT NULL,
    status VARCHAR(20) NOT NULL,
    channel_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_notification_history_outbox_id ON notification_history (outbox_id);
CREATE INDEX IF NOT EXISTS ix_notification_history_business_profile_id ON notification_history (business_profile_id);
CREATE INDEX IF NOT EXISTS ix_notification_history_event_type ON notification_history (event_type);
CREATE INDEX IF NOT EXISTS ix_notification_history_aggregate_type ON notification_history (aggregate_type);
CREATE INDEX IF NOT EXISTS ix_notification_history_aggregate_id ON notification_history (aggregate_id);
CREATE INDEX IF NOT EXISTS ix_notification_history_status ON notification_history (status);
