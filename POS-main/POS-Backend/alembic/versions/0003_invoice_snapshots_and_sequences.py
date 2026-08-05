"""Add invoice item snapshots and document sequences.

Revision ID: 0003_invoice_snapshots_and_sequences
Revises: 0002_nullable_customer_phone
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "0003_invoice_snapshots_and_sequences"
down_revision = "0002_nullable_customer_phone"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The baseline intentionally uses current ORM metadata for new installations.
    # Keep this historical revision safe when those tables already exist, while
    # retaining the original upgrade behavior for older databases.
    inspector = inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "document_sequences" not in tables:
        op.create_table(
            "document_sequences",
            sa.Column("family", sa.String(length=30), primary_key=True),
            sa.Column("next_value", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
    if "invoice_items" not in tables:
        op.create_table(
            "invoice_items",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("invoice_id", sa.Integer(), sa.ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False),
            sa.Column("order_item_id", sa.Integer(), sa.ForeignKey("order_items.id"), nullable=True),
            sa.Column("product_id", sa.Integer(), nullable=False),
            sa.Column("product_name", sa.String(length=180), nullable=False),
            sa.Column("barcode", sa.String(length=80), nullable=True),
            sa.Column("sku", sa.String(length=80), nullable=True),
            sa.Column("category", sa.String(length=100), nullable=True),
            sa.Column("quantity", sa.Numeric(12, 3), nullable=False),
            sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
            sa.Column("discount_pct", sa.Numeric(5, 2), nullable=False, server_default="0"),
            sa.Column("discount_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
            sa.Column("tax_rate", sa.Numeric(5, 2), nullable=False, server_default="0"),
            sa.Column("tax_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
            sa.Column("total", sa.Numeric(12, 2), nullable=False),
            sa.Column("mrp", sa.Numeric(12, 2), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
    existing_indexes = {index["name"] for index in inspect(op.get_bind()).get_indexes("invoice_items")}
    if "ix_invoice_items_invoice_id" not in existing_indexes:
        op.create_index("ix_invoice_items_invoice_id", "invoice_items", ["invoice_id"])


def downgrade() -> None:
    op.drop_index("ix_invoice_items_invoice_id", table_name="invoice_items")
    op.drop_table("invoice_items")
    op.drop_table("document_sequences")
