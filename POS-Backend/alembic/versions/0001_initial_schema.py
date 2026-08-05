"""Initial schema baseline.

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-07-09
"""
from alembic import op

from app.db.session import Base
import app.models  # noqa: F401  (populate metadata for the baseline migration)

revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=True)
    # Several descriptive revision identifiers exceed Alembic's historical
    # VARCHAR(32) default. Widen the version column before the next revision is
    # recorded so a clean installation can traverse the complete chain.
    op.execute("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(128)")


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind, checkfirst=True)
