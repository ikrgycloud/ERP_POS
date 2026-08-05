"""enterprise POS controls

Revision ID: 0024_enterprise_pos_controls
Revises: 0023_large_invoice_performance_indexes
Create Date: 2026-07-18 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "0024_enterprise_pos_controls"
down_revision = "0023_large_invoice_performance_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("audit_logs") as batch:
        batch.add_column(sa.Column("outlet_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("staff_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("terminal_id", sa.String(length=120), nullable=True))
        batch.add_column(sa.Column("severity", sa.String(length=20), nullable=False, server_default="info"))
        batch.create_index("ix_audit_logs_outlet_id", ["outlet_id"])
        batch.create_index("ix_audit_logs_staff_id", ["staff_id"])
        batch.create_index("ix_audit_logs_terminal_id", ["terminal_id"])

    op.create_table(
        "approval_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("business_profile_id", sa.Integer(), sa.ForeignKey("business_profiles.id"), nullable=False),
        sa.Column("outlet_id", sa.Integer(), sa.ForeignKey("outlets.id"), nullable=True),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id"), nullable=True),
        sa.Column("invoice_id", sa.Integer(), sa.ForeignKey("invoices.id"), nullable=True),
        sa.Column("requested_by_staff_id", sa.Integer(), sa.ForeignKey("staff.id"), nullable=False),
        sa.Column("approved_by_staff_id", sa.Integer(), sa.ForeignKey("staff.id"), nullable=True),
        sa.Column("terminal_id", sa.String(length=120), nullable=True),
        sa.Column("approval_type", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_approval_requests_business_profile_id", "approval_requests", ["business_profile_id"])
    op.create_index("ix_approval_requests_outlet_id", "approval_requests", ["outlet_id"])
    op.create_index("ix_approval_requests_order_id", "approval_requests", ["order_id"])
    op.create_index("ix_approval_requests_invoice_id", "approval_requests", ["invoice_id"])
    op.create_index("ix_approval_requests_requested_by_staff_id", "approval_requests", ["requested_by_staff_id"])
    op.create_index("ix_approval_requests_approved_by_staff_id", "approval_requests", ["approved_by_staff_id"])
    op.create_index("ix_approval_requests_terminal_id", "approval_requests", ["terminal_id"])
    op.create_index("ix_approval_requests_approval_type", "approval_requests", ["approval_type"])
    op.create_index("ix_approval_requests_status", "approval_requests", ["status"])
    op.create_index("ix_approval_requests_decided_at", "approval_requests", ["decided_at"])

    op.create_table(
        "shift_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("business_profile_id", sa.Integer(), sa.ForeignKey("business_profiles.id"), nullable=False),
        sa.Column("outlet_id", sa.Integer(), sa.ForeignKey("outlets.id"), nullable=True),
        sa.Column("staff_id", sa.Integer(), sa.ForeignKey("staff.id"), nullable=False),
        sa.Column("terminal_id", sa.String(length=120), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
        sa.Column("opened_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("opening_cash", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("closing_cash", sa.Numeric(12, 2), nullable=True),
        sa.Column("expected_cash", sa.Numeric(12, 2), nullable=True),
        sa.Column("variance", sa.Numeric(12, 2), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_shift_sessions_business_profile_id", "shift_sessions", ["business_profile_id"])
    op.create_index("ix_shift_sessions_outlet_id", "shift_sessions", ["outlet_id"])
    op.create_index("ix_shift_sessions_staff_id", "shift_sessions", ["staff_id"])
    op.create_index("ix_shift_sessions_terminal_id", "shift_sessions", ["terminal_id"])
    op.create_index("ix_shift_sessions_status", "shift_sessions", ["status"])
    op.create_index("ix_shift_sessions_closed_at", "shift_sessions", ["closed_at"])

    op.create_table(
        "cash_drawer_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("business_profile_id", sa.Integer(), sa.ForeignKey("business_profiles.id"), nullable=False),
        sa.Column("outlet_id", sa.Integer(), sa.ForeignKey("outlets.id"), nullable=True),
        sa.Column("staff_id", sa.Integer(), sa.ForeignKey("staff.id"), nullable=False),
        sa.Column("shift_id", sa.Integer(), sa.ForeignKey("shift_sessions.id"), nullable=True),
        sa.Column("terminal_id", sa.String(length=120), nullable=True),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_cash_drawer_events_business_profile_id", "cash_drawer_events", ["business_profile_id"])
    op.create_index("ix_cash_drawer_events_outlet_id", "cash_drawer_events", ["outlet_id"])
    op.create_index("ix_cash_drawer_events_staff_id", "cash_drawer_events", ["staff_id"])
    op.create_index("ix_cash_drawer_events_shift_id", "cash_drawer_events", ["shift_id"])
    op.create_index("ix_cash_drawer_events_terminal_id", "cash_drawer_events", ["terminal_id"])
    op.create_index("ix_cash_drawer_events_event_type", "cash_drawer_events", ["event_type"])


def downgrade() -> None:
    op.drop_table("cash_drawer_events")
    op.drop_table("shift_sessions")
    op.drop_table("approval_requests")
    with op.batch_alter_table("audit_logs") as batch:
        batch.drop_index("ix_audit_logs_terminal_id")
        batch.drop_index("ix_audit_logs_staff_id")
        batch.drop_index("ix_audit_logs_outlet_id")
        batch.drop_column("severity")
        batch.drop_column("terminal_id")
        batch.drop_column("staff_id")
        batch.drop_column("outlet_id")
