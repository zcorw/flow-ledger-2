"""Create FX rate and synchronization tables.

Revision ID: 0003_fx_rates
Revises: 0002_auth_core
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003_fx_rates"
down_revision: str | None = "0002_auth_core"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "fx_sync_runs",
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("currencies", sa.JSON(), nullable=False),
        sa.Column("message", sa.String(length=1000), nullable=True),
        sa.Column("triggered_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["triggered_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_fx_sync_runs_status"), "fx_sync_runs", ["status"])
    op.create_table(
        "fx_rates",
        sa.Column("base_currency", sa.String(length=3), nullable=False),
        sa.Column("quote_currency", sa.String(length=3), nullable=False),
        sa.Column("rate_date", sa.Date(), nullable=False),
        sa.Column("rate_to_base", sa.Numeric(precision=20, scale=10), nullable=False),
        sa.Column("source", sa.String(length=100), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["quote_currency"], ["currencies.code"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "base_currency",
            "quote_currency",
            "rate_date",
            "source",
            name="uq_fx_rate_source_date",
        ),
    )
    op.create_index(op.f("ix_fx_rates_rate_date"), "fx_rates", ["rate_date"])
    op.create_index(
        "idx_fx_rates_currency_date",
        "fx_rates",
        ["quote_currency", "rate_date"],
    )


def downgrade() -> None:
    op.drop_index("idx_fx_rates_currency_date", table_name="fx_rates")
    op.drop_index(op.f("ix_fx_rates_rate_date"), table_name="fx_rates")
    op.drop_table("fx_rates")
    op.drop_index(op.f("ix_fx_sync_runs_status"), table_name="fx_sync_runs")
    op.drop_table("fx_sync_runs")
