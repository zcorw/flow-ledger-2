import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Numeric, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import TimestampMixin, UUIDPrimaryKeyMixin


class DebtItem(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "debt_items"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    debt_type: Mapped[str] = mapped_column(String(20), index=True)
    counterparty: Mapped[str] = mapped_column(String(150))
    currency_code: Mapped[str] = mapped_column(String(3), ForeignKey("currencies.code"))
    status: Mapped[str] = mapped_column(String(30), default="active", index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class DebtEvent(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "debt_events"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    debt_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("debt_items.id", ondelete="CASCADE"), index=True
    )
    event_type: Mapped[str] = mapped_column(String(20), index=True)
    event_date: Mapped[date] = mapped_column(Date, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(20, 6))
    counterparty: Mapped[str] = mapped_column(String(150))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
