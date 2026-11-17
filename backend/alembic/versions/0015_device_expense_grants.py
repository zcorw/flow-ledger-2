"""Separate opt-in expense permission; existing devices remain receipt-only."""

import sqlalchemy as sa

from alembic import op

revision = "0015_device_expense_grants"
down_revision = "0014_receipt_drafts"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "receipt_devices",
        sa.Column("expense_write_enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade():
    with op.batch_alter_table("receipt_devices") as batch:
        batch.drop_column("expense_write_enabled")
