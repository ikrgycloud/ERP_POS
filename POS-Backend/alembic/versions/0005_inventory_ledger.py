"""Add shared inventory ledger.

Revision ID: 0005_inventory_ledger
Revises: 0004_scoped_query_indexes
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa


revision = "0005_inventory_ledger"
down_revision = "0004_scoped_query_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inventory_ledger",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False),
        sa.Column("business_profile_id", sa.Integer(), sa.ForeignKey("business_profiles.id"), nullable=True),
        sa.Column("outlet_id", sa.Integer(), sa.ForeignKey("outlets.id"), nullable=True),
        sa.Column("type", sa.String(length=30), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 3), nullable=False),
        sa.Column("reference_type", sa.String(length=40), nullable=True),
        sa.Column("reference_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_inventory_ledger_product_id", "inventory_ledger", ["product_id"])
    op.create_index("ix_inventory_ledger_business_profile_id", "inventory_ledger", ["business_profile_id"])
    op.create_index("ix_inventory_ledger_outlet_id", "inventory_ledger", ["outlet_id"])
    op.create_index("ix_inventory_ledger_reference", "inventory_ledger", ["reference_type", "reference_id"])
    op.execute("CREATE INDEX IF NOT EXISTS ix_products_barcode ON products (barcode)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_products_sku ON products (sku)")

    op.execute(
        """
        INSERT INTO inventory_ledger (product_id, business_profile_id, outlet_id, type, quantity, reference_type, reference_id)
        SELECT p.id, p.business_profile_id, NULL, 'PURCHASE', p.qty_bought, 'LEGACY_BACKFILL', p.id
        FROM products p
        WHERE COALESCE(p.qty_bought, 0) <> 0
        """
    )
    op.execute(
        """
        INSERT INTO inventory_ledger (product_id, business_profile_id, outlet_id, type, quantity, reference_type, reference_id)
        SELECT p.id, p.business_profile_id, NULL, 'SALE', -p.qty_sold, 'LEGACY_BACKFILL', p.id
        FROM products p
        WHERE COALESCE(p.qty_sold, 0) <> 0
        """
    )


def downgrade() -> None:
    op.drop_index("ix_inventory_ledger_reference", table_name="inventory_ledger")
    op.drop_index("ix_inventory_ledger_outlet_id", table_name="inventory_ledger")
    op.drop_index("ix_inventory_ledger_business_profile_id", table_name="inventory_ledger")
    op.drop_index("ix_inventory_ledger_product_id", table_name="inventory_ledger")
    op.drop_table("inventory_ledger")
