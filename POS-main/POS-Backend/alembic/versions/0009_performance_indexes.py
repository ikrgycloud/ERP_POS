"""performance indexes for shared ERP/POS tables"""

from alembic import op

revision = "0009_performance_indexes"
down_revision = "0008_request_idempotency"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE INDEX IF NOT EXISTS ix_products_business_active_created ON products (business_profile_id, is_active, created_at DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_products_business_sku ON products (business_profile_id, sku)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_products_business_barcode ON products (business_profile_id, barcode)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_products_business_name ON products (business_profile_id, name)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_products_business_low_stock ON products (business_profile_id, stock_cached, reorder_level) WHERE is_active = TRUE")
    op.execute("CREATE INDEX IF NOT EXISTS ix_inventory_ledger_business_product ON inventory_ledger (business_profile_id, product_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orders_business_date_status ON orders (business_profile_id, date DESC, status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orders_business_type_date ON orders (business_profile_id, type, date DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orders_business_outlet_date ON orders (business_profile_id, outlet_id, date DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_invoices_business_date_status ON invoices (business_profile_id, date DESC, status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_invoices_business_type_date ON invoices (business_profile_id, invoice_type, date DESC)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_invoices_business_direction_date ON invoices (business_profile_id, invoice_direction, date DESC)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_invoices_business_direction_date")
    op.execute("DROP INDEX IF EXISTS ix_invoices_business_type_date")
    op.execute("DROP INDEX IF EXISTS ix_invoices_business_date_status")
    op.execute("DROP INDEX IF EXISTS ix_orders_business_outlet_date")
    op.execute("DROP INDEX IF EXISTS ix_orders_business_type_date")
    op.execute("DROP INDEX IF EXISTS ix_orders_business_date_status")
    op.execute("DROP INDEX IF EXISTS ix_inventory_ledger_business_product")
    op.execute("DROP INDEX IF EXISTS ix_products_business_low_stock")
    op.execute("DROP INDEX IF EXISTS ix_products_business_name")
    op.execute("DROP INDEX IF EXISTS ix_products_business_barcode")
    op.execute("DROP INDEX IF EXISTS ix_products_business_sku")
    op.execute("DROP INDEX IF EXISTS ix_products_business_active_created")
