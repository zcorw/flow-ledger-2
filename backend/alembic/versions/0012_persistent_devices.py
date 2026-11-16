"""Allow receipt device grants to remain valid until revoked."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0012_persistent_devices"
down_revision: str | None = "0011_receipt_devices"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Existing finite grants keep their original expiry; new grants can use NULL.
    with op.batch_alter_table("receipt_devices") as batch:
        batch.alter_column("expires_at", existing_type=sa.DateTime(timezone=True), nullable=True)


def downgrade() -> None:
    # Old servers require a date. Rollback invalidates persistent grants instead
    # of silently converting them into a new finite authorization.
    devices = sa.table("receipt_devices", sa.column("expires_at", sa.DateTime(timezone=True)))
    op.execute(
        devices.update().where(devices.c.expires_at.is_(None)).values(expires_at=sa.func.now())
    )
    with op.batch_alter_table("receipt_devices") as batch:
        batch.alter_column("expires_at", existing_type=sa.DateTime(timezone=True), nullable=False)
