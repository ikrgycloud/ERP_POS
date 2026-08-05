"""production hardening constraints

Revision ID: 0025_prod_hardening
Revises: 0024_enterprise_pos_controls
Create Date: 2026-07-18 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "0025_prod_hardening"
down_revision = "0024_enterprise_pos_controls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pos_terminals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("business_profile_id", sa.Integer(), sa.ForeignKey("business_profiles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("outlet_id", sa.Integer(), sa.ForeignKey("outlets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("terminal_id", sa.String(length=120), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("secret_hash", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_pos_terminals_business_profile_id", "pos_terminals", ["business_profile_id"])
    op.create_index("ix_pos_terminals_outlet_id", "pos_terminals", ["outlet_id"])
    op.create_index("ix_pos_terminals_terminal_id", "pos_terminals", ["terminal_id"], unique=True)
    op.create_index("ix_pos_terminals_last_seen_at", "pos_terminals", ["last_seen_at"])

    op.add_column("audit_logs", sa.Column("details_json", sa.JSON(), nullable=True))
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


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_audit_logs_business_entity_created")
    op.execute("DROP INDEX IF EXISTS ix_audit_logs_business_staff_created")
    op.execute("DROP INDEX IF EXISTS uq_shift_one_open_per_terminal_cashier")
    op.execute("DROP INDEX IF EXISTS uq_orders_one_active_draft_per_cashier")
    op.drop_column("audit_logs", "details_json")
    op.drop_table("pos_terminals")
