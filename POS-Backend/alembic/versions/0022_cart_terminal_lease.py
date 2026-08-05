"""add cart terminal lease

Revision ID: 0022_cart_terminal_lease
Revises: 0021_cart_draft_lifecycle
Create Date: 2026-07-18
"""

from alembic import op

revision = "0022_cart_terminal_lease"
down_revision = "0021_cart_draft_lifecycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS terminal_id VARCHAR(120)")
    op.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orders_terminal_id ON orders (terminal_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orders_lease_expires_at ON orders (lease_expires_at)")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_orders_draft_terminal_lease
        ON orders (business_profile_id, outlet_id, staff_id, status, terminal_id, lease_expires_at)
        WHERE status = 'Draft'
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_orders_draft_terminal_lease")
    op.execute("DROP INDEX IF EXISTS ix_orders_lease_expires_at")
    op.execute("DROP INDEX IF EXISTS ix_orders_terminal_id")
    op.execute("ALTER TABLE orders DROP COLUMN IF EXISTS lease_expires_at")
    op.execute("ALTER TABLE orders DROP COLUMN IF EXISTS terminal_id")
