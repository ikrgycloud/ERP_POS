"""remove invoice logo and watermark settings

Revision ID: 0028_remove_invoice_assets
Revises: 0027_verify_index_cleanup
Create Date: 2026-07-19
"""

from alembic import op


revision = "0028_remove_invoice_assets"
down_revision = "0027_verify_index_cleanup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE business_profiles
            DROP COLUMN IF EXISTS invoice_logo_url,
            DROP COLUMN IF EXISTS invoice_logo_path,
            DROP COLUMN IF EXISTS invoice_watermark_url,
            DROP COLUMN IF EXISTS invoice_watermark_path,
            DROP COLUMN IF EXISTS invoice_watermark_enabled,
            DROP COLUMN IF EXISTS invoice_watermark_opacity
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE business_profiles
            ADD COLUMN IF NOT EXISTS invoice_logo_url VARCHAR(255),
            ADD COLUMN IF NOT EXISTS invoice_logo_path VARCHAR(255),
            ADD COLUMN IF NOT EXISTS invoice_watermark_url VARCHAR(255),
            ADD COLUMN IF NOT EXISTS invoice_watermark_path VARCHAR(255),
            ADD COLUMN IF NOT EXISTS invoice_watermark_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS invoice_watermark_opacity INTEGER NOT NULL DEFAULT 8
        """
    )
