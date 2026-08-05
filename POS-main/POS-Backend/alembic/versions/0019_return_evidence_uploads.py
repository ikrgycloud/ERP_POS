"""add return evidence uploads"""

from alembic import op
import sqlalchemy as sa

revision = "0019_return_evidence_uploads"
down_revision = "0018_invoice_notifications_outbox"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "return_evidence",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("return_id", sa.Integer(), sa.ForeignKey("returns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("business_profile_id", sa.Integer(), sa.ForeignKey("business_profiles.id"), nullable=True),
        sa.Column("outlet_id", sa.Integer(), sa.ForeignKey("outlets.id"), nullable=True),
        sa.Column("uploaded_by_staff_id", sa.Integer(), sa.ForeignKey("staff.id"), nullable=True),
        sa.Column("token_hash", sa.String(length=128), nullable=True),
        sa.Column("original_name", sa.String(length=255), nullable=False),
        sa.Column("stored_name", sa.String(length=255), nullable=False),
        sa.Column("file_url", sa.String(length=500), nullable=False),
        sa.Column("file_path", sa.String(length=500), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_return_evidence_return_id", "return_evidence", ["return_id"])
    op.create_index("ix_return_evidence_business_profile_id", "return_evidence", ["business_profile_id"])
    op.create_index("ix_return_evidence_outlet_id", "return_evidence", ["outlet_id"])
    op.create_index("ix_return_evidence_uploaded_by_staff_id", "return_evidence", ["uploaded_by_staff_id"])
    op.create_index("ix_return_evidence_token_hash", "return_evidence", ["token_hash"])


def downgrade() -> None:
    op.drop_index("ix_return_evidence_token_hash", table_name="return_evidence")
    op.drop_index("ix_return_evidence_uploaded_by_staff_id", table_name="return_evidence")
    op.drop_index("ix_return_evidence_outlet_id", table_name="return_evidence")
    op.drop_index("ix_return_evidence_business_profile_id", table_name="return_evidence")
    op.drop_index("ix_return_evidence_return_id", table_name="return_evidence")
    op.drop_table("return_evidence")
