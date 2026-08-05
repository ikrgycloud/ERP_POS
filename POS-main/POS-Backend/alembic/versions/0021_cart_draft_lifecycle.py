"""add cart draft lifecycle expiry

Revision ID: 0021_cart_draft_lifecycle
Revises: 0020_notification_history
Create Date: 2026-07-18
"""

from alembic import op

revision = "0021_cart_draft_lifecycle"
down_revision = "0020_notification_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orders_expires_at ON orders (expires_at)")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_orders_active_draft_lifecycle
        ON orders (business_profile_id, outlet_id, staff_id, status, expires_at)
        WHERE status = 'Draft'
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_orders_active_draft_lifecycle")
    op.execute("DROP INDEX IF EXISTS ix_orders_expires_at")
    op.execute("ALTER TABLE orders DROP COLUMN IF EXISTS expires_at")
