"""add invoice branding settings

Revision ID: 0017_invoice_branding_settings
Revises: 0016_returned_damaged_qty_schema_drift
Create Date: 2026-07-15
"""

from alembic import op

revision = "0017_invoice_branding_settings"
down_revision = "0016_returned_damaged_qty_schema_drift"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE business_profiles
            ADD COLUMN IF NOT EXISTS invoice_company_name VARCHAR(200),
            ADD COLUMN IF NOT EXISTS invoice_logo_url VARCHAR(255),
            ADD COLUMN IF NOT EXISTS invoice_logo_path VARCHAR(255),
            ADD COLUMN IF NOT EXISTS invoice_watermark_url VARCHAR(255),
            ADD COLUMN IF NOT EXISTS invoice_watermark_path VARCHAR(255),
            ADD COLUMN IF NOT EXISTS invoice_watermark_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS invoice_watermark_opacity INTEGER NOT NULL DEFAULT 8
        """
    )


def downgrade() -> None:
    # Non-destructive by design: production rollback must not remove branding data.
    pass
