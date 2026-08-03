"""Allow accounts to be created before institution association.

Revision ID: 0009_optional_account_link
Revises: 0008_performance_indexes
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009_optional_account_link"
down_revision: str | None = "0008_performance_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("accounts") as batch_op:
        batch_op.alter_column(
            "institution_id",
            existing_type=sa.Uuid(),
            nullable=True,
        )
    op.create_index(
        "uq_accounts_user_unassigned_name",
        "accounts",
        ["user_id", "name"],
        unique=True,
        postgresql_where=sa.text("institution_id IS NULL"),
        sqlite_where=sa.text("institution_id IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_accounts_user_unassigned_name", table_name="accounts")
    with op.batch_alter_table("accounts") as batch_op:
        batch_op.alter_column(
            "institution_id",
            existing_type=sa.Uuid(),
            nullable=False,
        )
