"""Add indexes for snapshot and debt history queries.

Revision ID: 0008_performance_indexes
Revises: 0007_import_backup
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0008_performance_indexes"
down_revision: str | None = "0007_import_backup"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_projects_user_account_active",
        "projects",
        ["user_id", "account_id", "is_active"],
    )
    op.create_index(
        "ix_snapshots_user_date",
        "monthly_snapshots",
        ["user_id", "snapshot_date"],
    )
    op.create_index(
        "ix_snapshots_user_project_date",
        "monthly_snapshots",
        ["user_id", "project_id", "snapshot_date"],
    )
    op.create_index(
        "ix_debt_items_user_type_status",
        "debt_items",
        ["user_id", "debt_type", "status"],
    )
    op.create_index(
        "ix_debt_events_item_date",
        "debt_events",
        ["debt_item_id", "event_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_debt_events_item_date", table_name="debt_events")
    op.drop_index("ix_debt_items_user_type_status", table_name="debt_items")
    op.drop_index("ix_snapshots_user_project_date", table_name="monthly_snapshots")
    op.drop_index("ix_snapshots_user_date", table_name="monthly_snapshots")
    op.drop_index("ix_projects_user_account_active", table_name="projects")
