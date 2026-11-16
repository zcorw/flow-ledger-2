"""Isolated short-lived, owner-approved receipt capabilities, not web sessions."""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from sqlalchemy import Boolean, DateTime, String, Uuid, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from app.core.errors import ApiError
from app.models.user import User


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class DeviceBase(DeclarativeBase):
    """Separate experimental metadata: excluded from production migrations."""


class ReceiptDeviceGrant(DeviceBase):
    # Not imported by app.models or included in a production migration yet.
    __tablename__ = "receipt_device_grants"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    password_fingerprint: Mapped[str] = mapped_column(String(64))
    resource: Mapped[str] = mapped_column(String(300))
    confirm_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


@dataclass(frozen=True)
class DeviceActor:
    user: User


class ReceiptGrants:
    def __init__(self, resource: str, now=lambda: datetime.now(UTC)):
        parsed = urlsplit(resource)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or parsed.path not in {"", "/"}
            or len(resource) > 300
        ):
            raise ValueError("A canonical HTTPS origin is required")
        self.resource = resource.rstrip("/")
        self.now = now

    def approve(self, db: Session, user_id: uuid.UUID) -> dict:
        """Trusted owner-consent call only. Never expose as public token issuance."""
        user = db.get(User, user_id)
        if user is None:
            raise ApiError(404, "USER_NOT_FOUND", "账户不存在")
        token = secrets.token_urlsafe(32)
        now = self.now()
        row = ReceiptDeviceGrant(
            id=uuid.uuid4(),
            user_id=user.id,
            token_hash=digest(token),
            password_fingerprint=digest(user.password_hash),
            resource=self.resource,
            confirm_until=now + timedelta(minutes=5),
            expires_at=now + timedelta(minutes=15),
            confirmed=False,
            revoked=False,
        )
        db.add(row)
        db.commit()
        return {
            "deviceId": str(row.id),
            "token": token,
            "confirmationExpiresAt": row.confirm_until.isoformat(),
            "expiresAt": row.expires_at.isoformat(),
            "scope": "receipt:recognize expense:create",
        }

    def _get(self, db: Session, token: str) -> tuple[ReceiptDeviceGrant, User]:
        if len(token) != 43 or any(
            c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
            for c in token
        ):
            raise ApiError(401, "DEVICE_UNAUTHORIZED", "设备授权无效")
        row = db.scalar(
            select(ReceiptDeviceGrant).where(ReceiptDeviceGrant.token_hash == digest(token))
        )
        user = db.get(User, row.user_id) if row else None
        if (
            row is None
            or user is None
            or row.revoked
            or row.resource != self.resource
            or row.password_fingerprint != digest(user.password_hash)
            or row.expires_at.replace(tzinfo=UTC) <= self.now()
            or (not row.confirmed and row.confirm_until.replace(tzinfo=UTC) <= self.now())
        ):
            raise ApiError(401, "DEVICE_UNAUTHORIZED", "设备授权无效")
        return row, user

    def confirm(self, db: Session, token: str) -> dict:
        row, _ = self._get(db, token)
        row.confirmed = True
        db.commit()
        # Retries do not extend either deadline or create another grant.
        return {"confirmed": True, "expiresAt": row.expires_at.isoformat()}

    def authenticate(self, db: Session, token: str) -> DeviceActor:
        row, user = self._get(db, token)
        if not row.confirmed:
            raise ApiError(401, "DEVICE_UNCONFIRMED", "设备尚未确认接收授权")
        return DeviceActor(user=user)

    def revoke(self, db: Session, owner_id: uuid.UUID, device_id: uuid.UUID) -> None:
        row = db.get(ReceiptDeviceGrant, device_id)
        if row is None or row.user_id != owner_id:
            raise ApiError(404, "DEVICE_NOT_FOUND", "设备不存在")
        row.revoked = True
        db.commit()
