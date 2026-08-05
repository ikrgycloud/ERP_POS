"""request-level idempotency table"""

from alembic import op

revision = "0008_request_idempotency"
down_revision = "0007_inventory_idempotency_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS idempotency_keys (
            id SERIAL PRIMARY KEY,
            key VARCHAR(255) NOT NULL UNIQUE,
            endpoint VARCHAR(255) NOT NULL,
            request_hash VARCHAR(64) NOT NULL,
            response_body JSONB,
            status_code INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_idempotency_keys_key ON idempotency_keys (key)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_idempotency_keys_endpoint ON idempotency_keys (endpoint)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_idempotency_keys_endpoint")
    op.execute("DROP INDEX IF EXISTS ix_idempotency_keys_key")
    op.execute("DROP TABLE IF EXISTS idempotency_keys")
