ALTER TABLE notification_outbox
    ADD COLUMN IF NOT EXISTS parent_outbox_id INTEGER NULL REFERENCES notification_outbox(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS channel VARCHAR(20) NOT NULL DEFAULT 'event',
    ADD COLUMN IF NOT EXISTS provider_response JSONB NULL,
    ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS ix_notification_outbox_parent_outbox_id ON notification_outbox (parent_outbox_id);
CREATE INDEX IF NOT EXISTS ix_notification_outbox_channel ON notification_outbox (channel);

ALTER TABLE notification_history
    ADD COLUMN IF NOT EXISTS channel VARCHAR(20) NOT NULL DEFAULT 'event',
    ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS provider_response JSONB NULL,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS ix_notification_history_channel ON notification_history (channel);
