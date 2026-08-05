"""add returned damaged quantity column

Revision ID: 0016_returned_damaged_qty_schema_drift
Revises: 0015_return_inventory_refund_sync
Create Date: 2026-07-15
"""

from alembic import op

revision = "0016_returned_damaged_qty_schema_drift"
down_revision = "0015_return_inventory_refund_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE products
            ADD COLUMN IF NOT EXISTS returned_damaged_qty NUMERIC(12, 3) NOT NULL DEFAULT 0
        """
    )


def downgrade() -> None:
    # Non-destructive by design: production rollback must not remove data.
    pass
