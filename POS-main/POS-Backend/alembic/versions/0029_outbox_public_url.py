"""store dynamic public invoice URL on notification outbox

Revision ID: 0029_outbox_public_url
Revises: 0028_remove_invoice_assets
Create Date: 2026-07-19
"""

from alembic import op


revision = "0029_outbox_public_url"
down_revision = "0028_remove_invoice_assets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE notification_outbox
        ADD COLUMN IF NOT EXISTS public_url VARCHAR(500)
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE notification_outbox
        DROP COLUMN IF EXISTS public_url
        """
    )
