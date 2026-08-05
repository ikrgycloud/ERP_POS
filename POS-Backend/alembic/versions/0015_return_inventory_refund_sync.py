"""return inventory and refund synchronization fields"""

from alembic import op

revision = "0015_return_inventory_refund_sync"
down_revision = "0014_audit_log_business_profile_index"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_ledger_type') THEN
                ALTER TYPE inventory_ledger_type ADD VALUE IF NOT EXISTS 'EXPIRED';
                ALTER TYPE inventory_ledger_type ADD VALUE IF NOT EXISTS 'QUARANTINE';
            END IF;
        END $$
        """
    )
    op.execute(
        """
        ALTER TABLE products
            ADD COLUMN IF NOT EXISTS expired_qty NUMERIC(12, 3) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS quarantine_qty NUMERIC(12, 3) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS reserved_qty NUMERIC(12, 3) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS qty_returned NUMERIC(12, 3) NOT NULL DEFAULT 0
        """
    )
    op.execute(
        """
        ALTER TABLE returns
            ADD COLUMN IF NOT EXISTS refund_status VARCHAR(30) NOT NULL DEFAULT 'pending'
        """
    )
    op.execute(
        """
        ALTER TABLE inventory_ledger
            ADD COLUMN IF NOT EXISTS old_stock NUMERIC(14, 3),
            ADD COLUMN IF NOT EXISTS new_stock NUMERIC(14, 3),
            ADD COLUMN IF NOT EXISTS reason VARCHAR(80)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_inventory_ledger_reason
        ON inventory_ledger (reason)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_inventory_ledger_reason")
    op.execute("ALTER TABLE inventory_ledger DROP COLUMN IF EXISTS reason")
    op.execute("ALTER TABLE inventory_ledger DROP COLUMN IF EXISTS new_stock")
    op.execute("ALTER TABLE inventory_ledger DROP COLUMN IF EXISTS old_stock")
    op.execute("ALTER TABLE returns DROP COLUMN IF EXISTS refund_status")
    op.execute("ALTER TABLE products DROP COLUMN IF EXISTS qty_returned")
    op.execute("ALTER TABLE products DROP COLUMN IF EXISTS reserved_qty")
    op.execute("ALTER TABLE products DROP COLUMN IF EXISTS quarantine_qty")
    op.execute("ALTER TABLE products DROP COLUMN IF EXISTS expired_qty")
