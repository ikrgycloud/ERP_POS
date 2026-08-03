DROP INDEX IF EXISTS ix_notification_history_channel;
DROP INDEX IF EXISTS ix_notification_outbox_channel;
DROP INDEX IF EXISTS ix_notification_outbox_parent_outbox_id;

ALTER TABLE notification_history
    DROP COLUMN IF EXISTS completed_at,
    DROP COLUMN IF EXISTS provider_response,
    DROP COLUMN IF EXISTS attempt,
    DROP COLUMN IF EXISTS channel;

ALTER TABLE notification_outbox
    DROP COLUMN IF EXISTS sent_at,
    DROP COLUMN IF EXISTS provider_response,
    DROP COLUMN IF EXISTS channel,
    DROP COLUMN IF EXISTS parent_outbox_id;
