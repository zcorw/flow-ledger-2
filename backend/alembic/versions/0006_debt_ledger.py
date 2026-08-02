"""Create debt item and event ledger.

Revision ID: 0006_debt_ledger
Revises: 0005_monthly_snapshots
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006_debt_ledger"
down_revision: str | None = "0005_monthly_snapshots"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "debt_items",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("debt_type", sa.String(length=20), nullable=False),
        sa.Column("counterparty", sa.String(length=150), nullable=False),
        sa.Column("currency_code", sa.String(length=3), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["currency_code"], ["currencies.code"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("debt_type", "status", "user_id"):
        op.create_index(op.f(f"ix_debt_items_{column}"), "debt_items", [column])
    op.create_table(
        "debt_events",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("debt_item_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=20), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(20, 6), nullable=False),
        sa.Column("counterparty", sa.String(length=150), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["debt_item_id"], ["debt_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("debt_item_id", "event_date", "event_type", "user_id"):
        op.create_index(op.f(f"ix_debt_events_{column}"), "debt_events", [column])


def downgrade() -> None:
    for column in ("user_id", "event_type", "event_date", "debt_item_id"):
        op.drop_index(op.f(f"ix_debt_events_{column}"), table_name="debt_events")
    op.drop_table("debt_events")
    for column in ("user_id", "status", "debt_type"):
        op.drop_index(op.f(f"ix_debt_items_{column}"), table_name="debt_items")
    op.drop_table("debt_items")
