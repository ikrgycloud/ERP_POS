"""add invoice notification outbox

Revision ID: 0018_invoice_notifications_outbox
Revises: 0017_invoice_branding_settings
Create Date: 2026-07-15
"""

from alembic import op

revision = "0018_invoice_notifications_outbox"
down_revision = "0017_invoice_branding_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS invoice_public_links (
            id SERIAL PRIMARY KEY,
            invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
            business_profile_id INTEGER NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
            customer_id INTEGER REFERENCES customers(id),
            token_hash VARCHAR(128) NOT NULL,
            expires_at TIMESTAMPTZ,
            opened_at TIMESTAMPTZ,
            open_count INTEGER NOT NULL DEFAULT 0,
            revoked_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS invoice_notifications (
            id SERIAL PRIMARY KEY,
            invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
            customer_id INTEGER REFERENCES customers(id),
            business_profile_id INTEGER NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
            outlet_id INTEGER REFERENCES outlets(id),
            channel VARCHAR(20) NOT NULL,
            phone VARCHAR(32),
            status VARCHAR(20) NOT NULL DEFAULT 'queued',
            twilio_sid VARCHAR(80),
            error_message TEXT,
            attempts INTEGER NOT NULL DEFAULT 0,
            sent_at TIMESTAMPTZ,
            failed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS notification_outbox (
            id SERIAL PRIMARY KEY,
            notification_id INTEGER REFERENCES invoice_notifications(id) ON DELETE SET NULL,
            invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
            customer_id INTEGER REFERENCES customers(id),
            business_profile_id INTEGER NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
            outlet_id INTEGER REFERENCES outlets(id),
            channel VARCHAR(20) NOT NULL,
            phone VARCHAR(32),
            status VARCHAR(20) NOT NULL DEFAULT 'queued',
            attempts INTEGER NOT NULL DEFAULT 0,
            next_attempt_at TIMESTAMPTZ,
            last_error TEXT,
            processed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_public_links_token_hash "
        "ON invoice_public_links (token_hash)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_notifications_invoice_channel "
        "ON invoice_notifications (invoice_id, channel)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_outbox_invoice_channel "
        "ON notification_outbox (invoice_id, channel)"
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_invoice_public_links_invoice_id ON invoice_public_links (invoice_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_invoice_public_links_business_profile_id ON invoice_public_links (business_profile_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_invoice_public_links_customer_id ON invoice_public_links (customer_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_invoice_notifications_invoice_id ON invoice_notifications (invoice_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_invoice_notifications_business_profile_id ON invoice_notifications (business_profile_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_invoice_notifications_status ON invoice_notifications (status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notification_outbox_status ON notification_outbox (status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_notification_outbox_next_attempt_at ON notification_outbox (next_attempt_at)")


def downgrade() -> None:
    # Non-destructive by design: production rollback must not remove notification history.
    pass
