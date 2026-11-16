"""Receipt-only device pairing and short-lived authorization."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0011_receipt_devices"
down_revision: str | None = "0010_daily_expenses"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "receipt_pairings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("device_code_hash", sa.String(64), nullable=False),
        sa.Column("user_code_hash", sa.String(64), nullable=False),
        sa.Column("requester_hash", sa.String(64), nullable=False),
        sa.Column("device_name", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("password_fingerprint", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_poll_at", sa.DateTime(timezone=True)),
    )
    for field in ["device_code_hash", "user_code_hash", "requester_hash", "user_id", "expires_at"]:
        op.create_index(
            "ix_receipt_pairings_" + field,
            "receipt_pairings",
            [field],
            unique=field in {"device_code_hash", "user_code_hash"},
        )
    op.create_table(
        "receipt_devices",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("password_fingerprint", sa.String(64), nullable=False),
        sa.Column("resource", sa.String(300), nullable=False),
        sa.Column("device_name", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
    )
    for field in ["user_id", "token_hash", "expires_at"]:
        op.create_index(
            "ix_receipt_devices_" + field,
            "receipt_devices",
            [field],
            unique=field == "token_hash",
        )


def downgrade() -> None:
    op.drop_table("receipt_devices")
    op.drop_table("receipt_pairings")
