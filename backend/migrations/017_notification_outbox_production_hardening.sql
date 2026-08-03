ALTER TABLE notification_outbox
    ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS lock_owner VARCHAR(120) NULL;

ALTER TABLE notification_history
    ADD COLUMN IF NOT EXISTS provider VARCHAR(80) NULL,
    ADD COLUMN IF NOT EXISTS duration_ms INTEGER NULL,
    ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(120) NULL,
    ADD COLUMN IF NOT EXISTS message_id VARCHAR(120) NULL,
    ADD COLUMN IF NOT EXISTS request_payload JSONB NULL;

UPDATE notification_outbox
SET max_attempts = GREATEST(max_attempts, 6)
WHERE max_attempts < 6;

CREATE INDEX IF NOT EXISTS ix_notification_outbox_due_channel
    ON notification_outbox (status, channel, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS ix_notification_outbox_parent_channel
    ON notification_outbox (parent_outbox_id, channel);

CREATE INDEX IF NOT EXISTS ix_notification_outbox_dead_lettered_at
    ON notification_outbox (dead_lettered_at)
    WHERE dead_lettered_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_notification_outbox_locked_at
    ON notification_outbox (locked_at)
    WHERE locked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_notification_history_provider
    ON notification_history (provider);

CREATE INDEX IF NOT EXISTS ix_notification_history_correlation_id
    ON notification_history (correlation_id);

CREATE INDEX IF NOT EXISTS ix_notification_history_message_id
    ON notification_history (message_id);
