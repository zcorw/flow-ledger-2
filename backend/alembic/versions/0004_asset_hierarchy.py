"""Create account and project hierarchy tables.

Revision ID: 0004_asset_hierarchy
Revises: 0003_fx_rates
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_asset_hierarchy"
down_revision: str | None = "0003_fx_rates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("institution_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("account_type", sa.String(length=40), nullable=False),
        sa.Column("masked_identifier", sa.String(length=80), nullable=True),
        sa.Column("display_color", sa.String(length=20), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["institution_id"], ["institutions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("institution_id", "name", name="uq_account_institution_name"),
    )
    op.create_index(op.f("ix_accounts_institution_id"), "accounts", ["institution_id"])
    op.create_index(op.f("ix_accounts_user_id"), "accounts", ["user_id"])
    op.create_table(
        "projects",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("asset_type", sa.String(length=40), nullable=False),
        sa.Column("currency_code", sa.String(length=3), nullable=False),
        sa.Column("default_liquidity_level", sa.String(length=40), nullable=False),
        sa.Column("default_risk_level", sa.String(length=20), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["currency_code"], ["currencies.code"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "name", name="uq_project_account_name"),
    )
    op.create_index(op.f("ix_projects_account_id"), "projects", ["account_id"])
    op.create_index(op.f("ix_projects_currency_code"), "projects", ["currency_code"])
    op.create_index(op.f("ix_projects_user_id"), "projects", ["user_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_projects_user_id"), table_name="projects")
    op.drop_index(op.f("ix_projects_currency_code"), table_name="projects")
    op.drop_index(op.f("ix_projects_account_id"), table_name="projects")
    op.drop_table("projects")
    op.drop_index(op.f("ix_accounts_user_id"), table_name="accounts")
    op.drop_index(op.f("ix_accounts_institution_id"), table_name="accounts")
    op.drop_table("accounts")
