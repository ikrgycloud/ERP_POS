"""add verification indexes and expire orphan drafts

Revision ID: 0027_verify_index_cleanup
Revises: 0026_repair_alembic_drift
Create Date: 2026-07-18
"""

from alembic import op


revision = "0027_verify_index_cleanup"
down_revision = "0026_repair_alembic_drift"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE orders
        SET status = 'Expired',
            expires_at = COALESCE(expires_at, now()),
            updated_at = now()
        WHERE status = 'Draft'
          AND (
              business_profile_id IS NULL
              OR outlet_id IS NULL
              OR staff_id IS NULL
          )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_order_items_product_id ON order_items (product_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_order_items_order_id ON order_items (order_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_invoices_order_id ON invoices (order_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_invoice_items_product_id ON invoice_items (product_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_invoice_items_order_item_id ON invoice_items (order_item_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_invoice_items_order_item_id")
    op.execute("DROP INDEX IF EXISTS ix_invoice_items_product_id")
    op.execute("DROP INDEX IF EXISTS ix_invoices_order_id")
    op.execute("DROP INDEX IF EXISTS ix_order_items_order_id")
    op.execute("DROP INDEX IF EXISTS ix_order_items_product_id")
