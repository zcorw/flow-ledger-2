import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, Numeric, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import TimestampMixin, UUIDPrimaryKeyMixin


class Account(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "accounts"
    __table_args__ = (
        UniqueConstraint("institution_id", "name", name="uq_account_institution_name"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    institution_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("institutions.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(150))
    account_type: Mapped[str] = mapped_column(String(40))
    masked_identifier: Mapped[str | None] = mapped_column(String(80), nullable=True)
    display_color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Project(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("account_id", "name", name="uq_project_account_name"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(150))
    asset_type: Mapped[str] = mapped_column(String(40))
    currency_code: Mapped[str] = mapped_column(String(3), ForeignKey("currencies.code"), index=True)
    default_liquidity_level: Mapped[str] = mapped_column(String(40))
    default_risk_level: Mapped[str] = mapped_column(String(20))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class MonthlySnapshot(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "monthly_snapshots"
    __table_args__ = (
        UniqueConstraint("project_id", "snapshot_date", name="uq_snapshot_project_date"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    snapshot_date: Mapped[date] = mapped_column(Date, index=True)
    snapshot_month: Mapped[str] = mapped_column(String(7), index=True)
    currency_code: Mapped[str] = mapped_column(String(3), ForeignKey("currencies.code"))
    original_amount: Mapped[Decimal] = mapped_column(Numeric(20, 6))
    fx_rate_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("fx_rates.id", ondelete="SET NULL"), nullable=True
    )
    fx_rate_to_cny: Mapped[Decimal] = mapped_column(Numeric(20, 10))
    fx_is_stale: Mapped[bool] = mapped_column(Boolean, default=False)
    converted_amount_cny: Mapped[Decimal] = mapped_column(Numeric(20, 6))
    liquidity_level: Mapped[str] = mapped_column(String(40))
    risk_level: Mapped[str] = mapped_column(String(20))
    change_note: Mapped[str | None] = mapped_column(Text, nullable=True)
