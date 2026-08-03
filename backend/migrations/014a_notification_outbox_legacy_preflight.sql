-- Upgrade databases that contain the legacy notification tables created before
-- the versioned ERP notification outbox migrations were introduced.
-- This migration intentionally runs immediately before 015_notification_outbox.sql.

DO $$
BEGIN
    IF to_regclass('public.notification_outbox') IS NOT NULL THEN
        ALTER TABLE notification_outbox
            ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(180),
            ADD COLUMN IF NOT EXISTS event_type VARCHAR(80),
            ADD COLUMN IF NOT EXISTS aggregate_type VARCHAR(80),
            ADD COLUMN IF NOT EXISTS aggregate_id VARCHAR(80),
            ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb,
            ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 3;

        UPDATE notification_outbox
        SET
            idempotency_key = COALESCE(NULLIF(idempotency_key, ''), 'legacy-notification-' || id::text),
            event_type = COALESCE(NULLIF(event_type, ''), 'legacy_notification'),
            aggregate_type = COALESCE(NULLIF(aggregate_type, ''), 'legacy_notification'),
            aggregate_id = COALESCE(NULLIF(aggregate_id, ''), id::text),
            payload = COALESCE(payload, '{}'::jsonb),
            max_attempts = COALESCE(max_attempts, 3);

        ALTER TABLE notification_outbox
            ALTER COLUMN idempotency_key SET NOT NULL,
            ALTER COLUMN event_type SET NOT NULL,
            ALTER COLUMN aggregate_type SET NOT NULL,
            ALTER COLUMN aggregate_id SET NOT NULL,
            ALTER COLUMN payload SET NOT NULL,
            ALTER COLUMN max_attempts SET NOT NULL;

        CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_outbox_idempotency_key
            ON notification_outbox (idempotency_key);
    END IF;

    IF to_regclass('public.notification_history') IS NOT NULL THEN
        ALTER TABLE notification_history
            ADD COLUMN IF NOT EXISTS event_type VARCHAR(80),
            ADD COLUMN IF NOT EXISTS aggregate_type VARCHAR(80),
            ADD COLUMN IF NOT EXISTS aggregate_id VARCHAR(80),
            ADD COLUMN IF NOT EXISTS channel_summary JSONB DEFAULT '{}'::jsonb;

        UPDATE notification_history
        SET
            event_type = COALESCE(NULLIF(event_type, ''), 'legacy_notification'),
            aggregate_type = COALESCE(NULLIF(aggregate_type, ''), 'legacy_notification'),
            aggregate_id = COALESCE(NULLIF(aggregate_id, ''), id::text),
            channel_summary = COALESCE(channel_summary, '{}'::jsonb);

        ALTER TABLE notification_history
            ALTER COLUMN event_type SET NOT NULL,
            ALTER COLUMN aggregate_type SET NOT NULL,
            ALTER COLUMN aggregate_id SET NOT NULL,
            ALTER COLUMN channel_summary SET NOT NULL;
    END IF;
END $$;
