"""repair alembic drift for existing ERP/POS databases

Revision ID: 0026_repair_alembic_drift
Revises: 0025_prod_hardening
Create Date: 2026-07-18
"""

from alembic import op


revision = "0026_repair_alembic_drift"
down_revision = "0025_prod_hardening"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ")
    op.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS terminal_id VARCHAR(120)")
    op.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orders_expires_at ON orders (expires_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orders_terminal_id ON orders (terminal_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orders_lease_expires_at ON orders (lease_expires_at)")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_orders_active_draft_lifecycle
        ON orders (business_profile_id, outlet_id, staff_id, status, expires_at)
        WHERE status = 'Draft'
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_orders_draft_terminal_lease
        ON orders (business_profile_id, outlet_id, staff_id, status, terminal_id, lease_expires_at)
        WHERE status = 'Draft'
        """
    )
    op.execute(
        """
        WITH ranked_drafts AS (
            SELECT
                id,
                ROW_NUMBER() OVER (
                    PARTITION BY business_profile_id, outlet_id, staff_id
                    ORDER BY updated_at DESC NULLS LAST, id DESC
                ) AS draft_rank
            FROM orders
            WHERE status = 'Draft'
              AND business_profile_id IS NOT NULL
              AND outlet_id IS NOT NULL
              AND staff_id IS NOT NULL
        )
        UPDATE orders
        SET status = 'Expired',
            expires_at = COALESCE(expires_at, now()),
            updated_at = now()
        WHERE id IN (
            SELECT id
            FROM ranked_drafts
            WHERE draft_rank > 1
        )
        """
    )

    op.execute("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS outlet_id INTEGER")
    op.execute("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS staff_id INTEGER")
    op.execute("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS terminal_id VARCHAR(120)")
    op.execute("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS severity VARCHAR(20)")
    op.execute("UPDATE audit_logs SET severity = 'info' WHERE severity IS NULL")
    op.execute("ALTER TABLE audit_logs ALTER COLUMN severity SET DEFAULT 'info'")
    op.execute("ALTER TABLE audit_logs ALTER COLUMN severity SET NOT NULL")
    op.execute("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS details_json JSON")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_logs_outlet_id ON audit_logs (outlet_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_logs_staff_id ON audit_logs (staff_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_audit_logs_terminal_id ON audit_logs (terminal_id)")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_audit_logs_business_staff_created
        ON audit_logs (business_profile_id, staff_id, created_at DESC, id DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_audit_logs_business_entity_created
        ON audit_logs (business_profile_id, entity_type, entity_id, created_at DESC, id DESC)
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'audit_logs_outlet_id_fkey'
                  AND conrelid = 'audit_logs'::regclass
            ) THEN
                ALTER TABLE audit_logs
                ADD CONSTRAINT audit_logs_outlet_id_fkey
                FOREIGN KEY (outlet_id) REFERENCES outlets(id) NOT VALID;
            END IF;
        END $$;
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'audit_logs_staff_id_fkey'
                  AND conrelid = 'audit_logs'::regclass
            ) THEN
                ALTER TABLE audit_logs
                ADD CONSTRAINT audit_logs_staff_id_fkey
                FOREIGN KEY (staff_id) REFERENCES staff(id) NOT VALID;
            END IF;
        END $$;
        """
    )
    op.execute("ALTER TABLE audit_logs VALIDATE CONSTRAINT audit_logs_outlet_id_fkey")
    op.execute("ALTER TABLE audit_logs VALIDATE CONSTRAINT audit_logs_staff_id_fkey")

    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_one_active_draft_per_cashier
        ON orders (business_profile_id, outlet_id, staff_id)
        WHERE status = 'Draft'
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_one_open_per_terminal_cashier
        ON shift_sessions (business_profile_id, outlet_id, staff_id, terminal_id)
        WHERE status = 'open'
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_shift_one_open_per_terminal_cashier")
    op.execute("DROP INDEX IF EXISTS uq_orders_one_active_draft_per_cashier")
    op.execute("ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_staff_id_fkey")
    op.execute("ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_outlet_id_fkey")
    op.execute("DROP INDEX IF EXISTS ix_audit_logs_business_entity_created")
    op.execute("DROP INDEX IF EXISTS ix_audit_logs_business_staff_created")
    op.execute("DROP INDEX IF EXISTS ix_audit_logs_terminal_id")
    op.execute("DROP INDEX IF EXISTS ix_audit_logs_staff_id")
    op.execute("DROP INDEX IF EXISTS ix_audit_logs_outlet_id")
    op.execute("DROP INDEX IF EXISTS ix_orders_draft_terminal_lease")
    op.execute("DROP INDEX IF EXISTS ix_orders_active_draft_lifecycle")
    op.execute("DROP INDEX IF EXISTS ix_orders_lease_expires_at")
    op.execute("DROP INDEX IF EXISTS ix_orders_terminal_id")
    op.execute("DROP INDEX IF EXISTS ix_orders_expires_at")
