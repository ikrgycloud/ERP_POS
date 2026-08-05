"""Allow customers without phone numbers.

Revision ID: 0002_nullable_customer_phone
Revises: 0001_initial_schema
Create Date: 2026-07-10
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_nullable_customer_phone"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "customers",
        "phone",
        existing_type=sa.String(length=30),
        nullable=True,
    )


def downgrade() -> None:
    op.execute("UPDATE customers SET phone = '' WHERE phone IS NULL")
    op.alter_column(
        "customers",
        "phone",
        existing_type=sa.String(length=30),
        nullable=False,
    )
