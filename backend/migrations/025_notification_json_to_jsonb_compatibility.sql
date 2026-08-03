-- Normalize early notification installations that used JSON columns before
-- the versioned notification-outbox schema standardized on JSONB.
--
-- This is intentionally a new migration: 014a may already be recorded in
-- production and applied migrations must never be edited.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'notification_outbox'
          AND column_name = 'payload'
          AND data_type = 'json'
    ) THEN
        ALTER TABLE notification_outbox
            ALTER COLUMN payload TYPE JSONB USING payload::text::jsonb;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'notification_history'
          AND column_name = 'channel_summary'
          AND data_type = 'json'
    ) THEN
        ALTER TABLE notification_history
            ALTER COLUMN channel_summary TYPE JSONB USING channel_summary::text::jsonb;
    END IF;
END $$;
