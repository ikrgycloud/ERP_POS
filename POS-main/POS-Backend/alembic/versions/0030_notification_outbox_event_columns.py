"""align POS notification outbox with production schema

Revision ID: 0030_notification_outbox_event_columns
Revises: 0029_outbox_public_url
Create Date: 2026-07-21
"""

from alembic import op


revision = "0030_notification_outbox_event_columns"
down_revision = "0029_outbox_public_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE notification_outbox
            ADD COLUMN IF NOT EXISTS parent_outbox_id INTEGER NULL REFERENCES notification_outbox(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(180),
            ADD COLUMN IF NOT EXISTS event_type VARCHAR(80),
            ADD COLUMN IF NOT EXISTS aggregate_type VARCHAR(80),
            ADD COLUMN IF NOT EXISTS aggregate_id VARCHAR(80),
            ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb,
            ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 6,
            ADD COLUMN IF NOT EXISTS provider_response JSONB NULL,
            ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ NULL,
            ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ NULL,
            ADD COLUMN IF NOT EXISTS lock_owner VARCHAR(120) NULL,
            ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ NULL
        """
    )
    op.execute(
        """
        UPDATE notification_outbox
        SET
            idempotency_key = COALESCE(NULLIF(idempotency_key, ''), 'legacy-pos-notification-' || id::text),
            event_type = COALESCE(NULLIF(event_type, ''), 'invoice_notification'),
            aggregate_type = COALESCE(NULLIF(aggregate_type, ''), 'invoice'),
            aggregate_id = COALESCE(NULLIF(aggregate_id, ''), COALESCE(invoice_id::text, id::text)),
            payload = COALESCE(payload, '{}'::jsonb),
            max_attempts = GREATEST(COALESCE(max_attempts, 6), 6)
        """
    )
    op.execute(
        """
        ALTER TABLE notification_outbox
            ALTER COLUMN idempotency_key SET NOT NULL,
            ALTER COLUMN event_type SET NOT NULL,
            ALTER COLUMN aggregate_type SET NOT NULL,
            ALTER COLUMN aggregate_id SET NOT NULL,
            ALTER COLUMN payload SET NOT NULL,
            ALTER COLUMN max_attempts SET NOT NULL
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_outbox_idempotency_key
        ON notification_outbox (idempotency_key)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_notification_outbox_due_channel
        ON notification_outbox (status, channel, next_attempt_at, created_at)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_notification_outbox_due_channel")
    op.execute("DROP INDEX IF EXISTS uq_notification_outbox_idempotency_key")
    op.execute(
        """
        ALTER TABLE notification_outbox
            DROP COLUMN IF EXISTS sent_at,
            DROP COLUMN IF EXISTS lock_owner,
            DROP COLUMN IF EXISTS locked_at,
            DROP COLUMN IF EXISTS dead_lettered_at,
            DROP COLUMN IF EXISTS provider_response,
            DROP COLUMN IF EXISTS max_attempts,
            DROP COLUMN IF EXISTS payload,
            DROP COLUMN IF EXISTS aggregate_id,
            DROP COLUMN IF EXISTS aggregate_type,
            DROP COLUMN IF EXISTS event_type,
            DROP COLUMN IF EXISTS idempotency_key,
            DROP COLUMN IF EXISTS parent_outbox_id
        """
    )
