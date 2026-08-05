"""large invoice performance indexes

Revision ID: 0023_large_invoice_performance_indexes
Revises: 0022_cart_terminal_lease
Create Date: 2026-07-18
"""

from alembic import op

revision = "0023_large_invoice_performance_indexes"
down_revision = "0022_cart_terminal_lease"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS ix_order_items_order_id ON order_items (order_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_order_items_order_product ON order_items (order_id, product_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_order_items_product_id ON order_items (product_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_invoice_items_order_item_id ON invoice_items (order_item_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_invoice_items_product_id ON invoice_items (product_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_invoices_order_id ON invoices (order_id)")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_product_discounts_product_active_qty
        ON product_discounts (product_id, is_active, min_quantity, discount_value DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_inventory_ledger_idempotency_key
        ON inventory_ledger (idempotency_key)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_inventory_ledger_idempotency_key")
    op.execute("DROP INDEX IF EXISTS ix_product_discounts_product_active_qty")
    op.execute("DROP INDEX IF EXISTS ix_invoices_order_id")
    op.execute("DROP INDEX IF EXISTS ix_invoice_items_product_id")
    op.execute("DROP INDEX IF EXISTS ix_invoice_items_order_item_id")
    op.execute("DROP INDEX IF EXISTS ix_order_items_product_id")
    op.execute("DROP INDEX IF EXISTS ix_order_items_order_product")
    op.execute("DROP INDEX IF EXISTS ix_order_items_order_id")
