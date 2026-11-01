"""Independent daily expenses; no changes to asset or debt statistics."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010_daily_expenses"
down_revision: str | None = "0009_optional_account_link"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "expenses",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("expense_date", sa.Date(), nullable=False),
        sa.Column(
            "amount", sa.Numeric(20, 6).with_variant(sa.String(21), "sqlite"), nullable=False
        ),
        sa.Column("currency_code", sa.String(3), sa.ForeignKey("currencies.code"), nullable=False),
        sa.Column("category", sa.String(30), nullable=False),
        sa.Column("merchant", sa.String(150), nullable=True),
        sa.Column(
            "account_id",
            sa.Uuid(),
            sa.ForeignKey("accounts.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("request_key", sa.Uuid(), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "request_key", name="uq_expenses_user_request"),
    )
    op.create_index("ix_expenses_user_date", "expenses", ["user_id", "expense_date"])


def downgrade() -> None:
    op.drop_index("ix_expenses_user_date", table_name="expenses")
    op.drop_table("expenses")
