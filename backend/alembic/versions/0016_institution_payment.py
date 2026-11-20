"""Institution payment eligibility, preserving all existing choices."""

import sqlalchemy as sa

from alembic import op

revision = "0016_institution_payment"
down_revision = "0015_device_expense_grants"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "institutions",
        sa.Column("can_be_payment_account", sa.Boolean(), server_default=sa.true(), nullable=False),
    )


def downgrade():
    with op.batch_alter_table("institutions") as batch:
        batch.drop_column("can_be_payment_account")
