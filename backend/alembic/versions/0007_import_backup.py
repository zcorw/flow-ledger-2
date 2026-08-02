"""Create import jobs and backup exports.

Revision ID: 0007_import_backup
Revises: 0006_debt_ledger
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007_import_backup"
down_revision: str | None = "0006_debt_ledger"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "import_jobs",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("import_type", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column("error_report", sa.JSON(), nullable=True),
        sa.Column("validated_payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("import_type", "status", "user_id"):
        op.create_index(op.f(f"ix_import_jobs_{column}"), "import_jobs", [column])
    op.create_table(
        "backup_exports",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("checksum", sa.String(length=64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("purpose", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_backup_exports_checksum"), "backup_exports", ["checksum"])
    op.create_index(op.f("ix_backup_exports_user_id"), "backup_exports", ["user_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_backup_exports_user_id"), table_name="backup_exports")
    op.drop_index(op.f("ix_backup_exports_checksum"), table_name="backup_exports")
    op.drop_table("backup_exports")
    for column in ("user_id", "status", "import_type"):
        op.drop_index(op.f(f"ix_import_jobs_{column}"), table_name="import_jobs")
    op.drop_table("import_jobs")
