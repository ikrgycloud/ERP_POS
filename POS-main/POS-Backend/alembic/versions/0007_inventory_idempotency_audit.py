"""Add inventory ledger idempotency and audit fields.

Revision ID: 0007_inventory_idempotency_audit
Revises: 0006_inventory_cache_hardening
Create Date: 2026-07-13
"""
from alembic import op


revision = "0007_inventory_idempotency_audit"
down_revision = "0006_inventory_cache_hardening"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE inventory_ledger
            ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
            ADD COLUMN IF NOT EXISTS user_id VARCHAR(80),
            ADD COLUMN IF NOT EXISTS source VARCHAR(40)
        """
    )
    op.execute(
        """
        ALTER TABLE inventory_ledger
            ALTER COLUMN reference_id TYPE VARCHAR(80)
            USING reference_id::text
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_ledger_idempotency_key
        ON inventory_ledger (idempotency_key)
        WHERE idempotency_key IS NOT NULL
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_inventory_ledger_user_id ON inventory_ledger (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_inventory_ledger_source ON inventory_ledger (source)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_inventory_ledger_reference ON inventory_ledger (reference_type, reference_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_inventory_ledger_idempotency_key")
    op.execute("DROP INDEX IF EXISTS ix_inventory_ledger_user_id")
    op.execute("DROP INDEX IF EXISTS ix_inventory_ledger_source")
    op.execute(
        """
        ALTER TABLE inventory_ledger
            ALTER COLUMN reference_id TYPE INTEGER
            USING CASE
                WHEN reference_id ~ '^[0-9]+$' THEN reference_id::integer
                ELSE NULL
            END
        """
    )
    op.execute(
        """
        ALTER TABLE inventory_ledger
            DROP COLUMN IF EXISTS idempotency_key,
            DROP COLUMN IF EXISTS user_id,
            DROP COLUMN IF EXISTS source
        """
    )
