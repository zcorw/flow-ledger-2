import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

from app.db.base import Base
from app.models.common import TimestampMixin, UUIDPrimaryKeyMixin


class ExpenseAmount(TypeDecorator):
    """Postgres numeric; exact text on SQLite (whose NUMERIC affinity uses floats)."""

    impl = Numeric(20, 6)
    cache_ok = True

    def load_dialect_impl(self, dialect):
        return dialect.type_descriptor(String(21) if dialect.name == "sqlite" else Numeric(20, 6))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        amount = Decimal(value).quantize(Decimal("0.000001"))
        return str(amount) if dialect.name == "sqlite" else amount

    def process_result_value(self, value, dialect):
        return Decimal(value) if value is not None else None


class Expense(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "expenses"
    __table_args__ = (
        UniqueConstraint("user_id", "request_key", name="uq_expenses_user_request"),
        Index("ix_expenses_user_date", "user_id", "expense_date"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    expense_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(ExpenseAmount())
    currency_code: Mapped[str] = mapped_column(String(3), ForeignKey("currencies.code"))
    category: Mapped[str] = mapped_column(String(30), default="uncategorized")
    merchant: Mapped[str | None] = mapped_column(String(150), nullable=True)
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(20), default="manual")
    request_key: Mapped[uuid.UUID] = mapped_column(Uuid)
    request_hash: Mapped[str] = mapped_column(String(64))
    # Retain the idempotency key after deletion so delayed retries never recreate a record.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
