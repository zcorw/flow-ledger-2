import uuid

from sqlalchemy import JSON, ForeignKey, Index, LargeBinary, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import TimestampMixin, UUIDPrimaryKeyMixin


class Receipt(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Private original and OCR candidate; this is not an accounting entry."""

    __tablename__ = "receipts"
    __table_args__ = (Index("ix_receipts_user_created", "user_id", "created_at"),)

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"))
    original_image: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    mime_type: Mapped[str] = mapped_column(String(32))
    byte_length: Mapped[int]
    sha256: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), default="recognizing")
    amount: Mapped[str] = mapped_column(String(32), default="")
    expense_date: Mapped[str] = mapped_column(String(32), default="")
    currency_code: Mapped[str] = mapped_column(String(16), default="")
    merchant: Mapped[str] = mapped_column(String(150), default="")
    warnings: Mapped[list[str]] = mapped_column(JSON, default=list)
    failure_code: Mapped[str] = mapped_column(String(64), default="")
