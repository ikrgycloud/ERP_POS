"""trigram search indexes for scalable lookup"""

from alembic import op

revision = "0010_search_trigram_indexes"
down_revision = "0009_performance_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE INDEX IF NOT EXISTS ix_products_name_trgm ON products USING gin (name gin_trgm_ops)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_customers_name_trgm ON customers USING gin (name gin_trgm_ops)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_suppliers_name_trgm ON suppliers USING gin (name gin_trgm_ops)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orders_party_name_trgm ON orders USING gin (party_name gin_trgm_ops)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_invoices_party_name_trgm ON invoices USING gin (party_name gin_trgm_ops)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_invoices_party_name_trgm")
    op.execute("DROP INDEX IF EXISTS ix_orders_party_name_trgm")
    op.execute("DROP INDEX IF EXISTS ix_suppliers_name_trgm")
    op.execute("DROP INDEX IF EXISTS ix_customers_name_trgm")
    op.execute("DROP INDEX IF EXISTS ix_products_name_trgm")
