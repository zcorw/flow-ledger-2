"""Archive private receipt originals and connect them to expenses."""

import sqlalchemy as sa

from alembic import op

revision = "0013_receipt_originals"
down_revision = "0012_persistent_devices"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "receipts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("original_image", sa.LargeBinary(), nullable=False),
        sa.Column("mime_type", sa.String(32), nullable=False),
        sa.Column("byte_length", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("amount", sa.String(32), nullable=False),
        sa.Column("expense_date", sa.String(32), nullable=False),
        sa.Column("currency_code", sa.String(16), nullable=False),
        sa.Column("merchant", sa.String(150), nullable=False),
        sa.Column("warnings", sa.JSON(), nullable=False),
        sa.Column("failure_code", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_receipts_user_created", "receipts", ["user_id", "created_at"])
    with op.batch_alter_table("expenses") as batch:
        batch.add_column(sa.Column("receipt_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key("fk_expenses_receipt", "receipts", ["receipt_id"], ["id"])
        batch.create_unique_constraint("uq_expenses_receipt", ["receipt_id"])


def downgrade():
    with op.batch_alter_table("expenses") as batch:
        batch.drop_constraint("uq_expenses_receipt", type_="unique")
        batch.drop_constraint("fk_expenses_receipt", type_="foreignkey")
        batch.drop_column("receipt_id")
    op.drop_index("ix_receipts_user_created", table_name="receipts")
    op.drop_table("receipts")
