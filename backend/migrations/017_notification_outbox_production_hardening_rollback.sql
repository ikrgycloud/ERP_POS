DROP INDEX IF EXISTS ix_notification_history_message_id;
DROP INDEX IF EXISTS ix_notification_history_correlation_id;
DROP INDEX IF EXISTS ix_notification_history_provider;
DROP INDEX IF EXISTS ix_notification_outbox_locked_at;
DROP INDEX IF EXISTS ix_notification_outbox_dead_lettered_at;
DROP INDEX IF EXISTS ix_notification_outbox_parent_channel;
DROP INDEX IF EXISTS ix_notification_outbox_due_channel;

ALTER TABLE notification_history
    DROP COLUMN IF EXISTS request_payload,
    DROP COLUMN IF EXISTS message_id,
    DROP COLUMN IF EXISTS correlation_id,
    DROP COLUMN IF EXISTS duration_ms,
    DROP COLUMN IF EXISTS provider;

ALTER TABLE notification_outbox
    DROP COLUMN IF EXISTS lock_owner,
    DROP COLUMN IF EXISTS locked_at,
    DROP COLUMN IF EXISTS dead_lettered_at;
