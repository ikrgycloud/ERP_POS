"""tenant scope audit logs"""

from alembic import op

revision = "0012_audit_log_tenant_scope"
down_revision = "0011_identifier_uniqueness_preflight"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE audit_logs
        ADD COLUMN IF NOT EXISTS business_profile_id INTEGER REFERENCES business_profiles(id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_audit_logs_business_created
        ON audit_logs (business_profile_id, created_at DESC, id DESC)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_audit_logs_business_created")
    op.execute("ALTER TABLE audit_logs DROP COLUMN IF EXISTS business_profile_id")
