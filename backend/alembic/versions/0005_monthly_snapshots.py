"""Create monthly snapshots.

Revision ID: 0005_monthly_snapshots
Revises: 0004_asset_hierarchy
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005_monthly_snapshots"
down_revision: str | None = "0004_asset_hierarchy"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "monthly_snapshots",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("snapshot_month", sa.String(length=7), nullable=False),
        sa.Column("currency_code", sa.String(length=3), nullable=False),
        sa.Column("original_amount", sa.Numeric(20, 6), nullable=False),
        sa.Column("fx_rate_id", sa.Uuid(), nullable=True),
        sa.Column("fx_rate_to_cny", sa.Numeric(20, 10), nullable=False),
        sa.Column("fx_is_stale", sa.Boolean(), nullable=False),
        sa.Column("converted_amount_cny", sa.Numeric(20, 6), nullable=False),
        sa.Column("liquidity_level", sa.String(length=40), nullable=False),
        sa.Column("risk_level", sa.String(length=20), nullable=False),
        sa.Column("change_note", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["currency_code"], ["currencies.code"]),
        sa.ForeignKeyConstraint(["fx_rate_id"], ["fx_rates.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "snapshot_date", name="uq_snapshot_project_date"),
    )
    op.create_index(op.f("ix_monthly_snapshots_project_id"), "monthly_snapshots", ["project_id"])
    op.create_index(
        op.f("ix_monthly_snapshots_snapshot_date"),
        "monthly_snapshots",
        ["snapshot_date"],
    )
    op.create_index(
        op.f("ix_monthly_snapshots_snapshot_month"),
        "monthly_snapshots",
        ["snapshot_month"],
    )
    op.create_index(op.f("ix_monthly_snapshots_user_id"), "monthly_snapshots", ["user_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_monthly_snapshots_user_id"), table_name="monthly_snapshots")
    op.drop_index(op.f("ix_monthly_snapshots_snapshot_month"), table_name="monthly_snapshots")
    op.drop_index(op.f("ix_monthly_snapshots_snapshot_date"), table_name="monthly_snapshots")
    op.drop_index(op.f("ix_monthly_snapshots_project_id"), table_name="monthly_snapshots")
    op.drop_table("monthly_snapshots")
