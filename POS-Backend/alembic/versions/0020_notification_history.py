"""add immutable notification history

Revision ID: 0020_notification_history
Revises: 0019_return_evidence_uploads
Create Date: 2026-07-18
"""

from alembic import op

revision = "0020_notification_history"
down_revision = "0019_return_evidence_uploads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS notification_history (
            id SERIAL PRIMARY KEY,
            notification_id INTEGER REFERENCES invoice_notifications(id) ON DELETE SET NULL,
            outbox_id INTEGER REFERENCES notification_outbox(id) ON DELETE SET NULL,
            invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
            customer_id INTEGER REFERENCES customers(id),
            business_profile_id INTEGER NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
            outlet_id INTEGER REFERENCES outlets(id),
            channel VARCHAR(20) NOT NULL,
            status VARCHAR(20) NOT NULL,
            attempt INTEGER NOT NULL DEFAULT 0,
            provider_response JSONB,
            error_message TEXT,
            completed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_notification_history_notification_id ON notification_history (notification_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notification_history_outbox_id ON notification_history (outbox_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notification_history_invoice_id ON notification_history (invoice_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notification_history_customer_id ON notification_history (customer_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notification_history_business_profile_id ON notification_history (business_profile_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notification_history_outlet_id ON notification_history (outlet_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notification_history_channel ON notification_history (channel)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notification_history_status ON notification_history (status)")


def downgrade() -> None:
    # Preserve notification audit history during rollback.
    pass
