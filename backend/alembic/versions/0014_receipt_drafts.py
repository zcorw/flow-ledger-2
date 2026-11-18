"""Versioned, idempotent receipt drafts without accounting writes."""

import sqlalchemy as sa

from alembic import op

revision = "0014_receipt_drafts"
down_revision = "0013_receipt_originals"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("receipts") as batch:
        batch.add_column(sa.Column("draft_values", sa.JSON(), nullable=True))
        batch.add_column(
            sa.Column("draft_revision", sa.Integer(), server_default="0", nullable=False)
        )
        batch.add_column(sa.Column("draft_request_key", sa.String(36), nullable=True))
        batch.add_column(sa.Column("draft_request_hash", sa.String(64), nullable=True))


def downgrade():
    with op.batch_alter_table("receipts") as batch:
        batch.drop_column("draft_request_hash")
        batch.drop_column("draft_request_key")
        batch.drop_column("draft_revision")
        batch.drop_column("draft_values")
