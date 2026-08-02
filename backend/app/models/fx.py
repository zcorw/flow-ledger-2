import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Numeric, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import UUIDPrimaryKeyMixin, utc_now


class FxRate(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "fx_rates"
    __table_args__ = (
        UniqueConstraint(
            "base_currency",
            "quote_currency",
            "rate_date",
            "source",
            name="uq_fx_rate_source_date",
        ),
    )

    base_currency: Mapped[str] = mapped_column(String(3), default="CNY")
    quote_currency: Mapped[str] = mapped_column(String(3), ForeignKey("currencies.code"))
    rate_date: Mapped[date] = mapped_column(Date, index=True)
    rate_to_base: Mapped[Decimal] = mapped_column(Numeric(20, 10))
    source: Mapped[str] = mapped_column(String(100))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class FxSyncRun(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "fx_sync_runs"

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(30), index=True)
    currencies: Mapped[list[str]] = mapped_column(JSON)
    message: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    triggered_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
