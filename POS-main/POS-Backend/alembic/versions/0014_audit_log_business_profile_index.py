"""audit log business profile index"""

from alembic import op

revision = "0014_audit_log_business_profile_index"
down_revision = "0013_shared_foreign_keys_not_valid"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_audit_logs_business_profile_id
        ON audit_logs (business_profile_id)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_audit_logs_business_profile_id")
