"""Add scoped query indexes for production hot paths.

Revision ID: 0004_scoped_query_indexes
Revises: 0003_invoice_snapshots_and_sequences
Create Date: 2026-07-11
"""
from alembic import op

revision = "0004_scoped_query_indexes"
down_revision = "0003_invoice_snapshots_and_sequences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_staff_business_role_manager", "staff", ["business_profile_id", "role", "manager_id"])
    op.create_index("ix_customers_outlet_phone", "customers", ["outlet_id", "phone"])
    op.create_index("ix_products_business_sku", "products", ["business_profile_id", "sku"])
    op.create_index("ix_products_business_barcode", "products", ["business_profile_id", "barcode"])
    op.create_index("ix_products_business_stock", "products", ["business_profile_id", "qty_bought", "qty_sold", "damaged_qty", "reorder_level"])
    op.create_index("ix_orders_business_status_staff", "orders", ["business_profile_id", "status", "staff_id"])
    op.create_index("ix_invoices_business_date_staff", "invoices", ["business_profile_id", "date", "staff_id"])
    op.create_index("ix_invoices_business_number", "invoices", ["business_profile_id", "invoice_number"])
    op.create_index("ix_returns_business_status_staff", "returns", ["business_profile_id", "status", "staff_id"])
    op.create_index("ix_payments_business_method_direction", "payments", ["business_profile_id", "method", "direction"])
    op.create_index("ix_damaged_inventory_business_product", "damaged_inventory", ["business_profile_id", "product_id"])


def downgrade() -> None:
    op.drop_index("ix_damaged_inventory_business_product", table_name="damaged_inventory")
    op.drop_index("ix_payments_business_method_direction", table_name="payments")
    op.drop_index("ix_returns_business_status_staff", table_name="returns")
    op.drop_index("ix_invoices_business_number", table_name="invoices")
    op.drop_index("ix_invoices_business_date_staff", table_name="invoices")
    op.drop_index("ix_orders_business_status_staff", table_name="orders")
    op.drop_index("ix_products_business_stock", table_name="products")
    op.drop_index("ix_products_business_barcode", table_name="products")
    op.drop_index("ix_products_business_sku", table_name="products")
    op.drop_index("ix_customers_outlet_phone", table_name="customers")
    op.drop_index("ix_staff_business_role_manager", table_name="staff")
