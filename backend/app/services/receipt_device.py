"""Owner-approved, revocable receipt-only grants; never web sessions."""

import hashlib
import re
import secrets
import threading
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ApiError
from app.models.audit import AuditLog
from app.models.receipt_device import ReceiptDevice, ReceiptPairing
from app.models.user import User

PAIRING_SECONDS = 600
POLL_SECONDS = 3
SCOPE = "receipt:recognize"
_creation_lock = threading.Lock()


def now() -> datetime:
    return datetime.now(UTC)


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def public_origin() -> str:
    settings = get_settings()
    parsed = urlsplit(settings.app_base_url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
        or (settings.app_env == "production" and parsed.scheme != "https")
    ):
        raise ApiError(503, "DEVICE_CONFIG", "请配置正确的 HTTPS 应用地址")
    return f"{parsed.scheme}://{parsed.netloc}"


def normalize_code(value: str) -> str:
    code = value.replace("-", "").replace(" ", "").upper()
    if not re.fullmatch(r"[A-HJ-NP-Z2-9]{8}", code):
        raise ApiError(404, "DEVICE_CODE_INVALID", "授权码无效或已过期")
    return code


def start_pairing(db: Session, device_name: str, requester: str) -> dict:
    clock = now()
    requester_hash = digest(get_settings().secret_key + requester)
    with _creation_lock:
        db.execute(
            delete(ReceiptPairing).where(ReceiptPairing.expires_at < clock - timedelta(days=1))
        )
        db.execute(
            delete(ReceiptDevice).where(ReceiptDevice.expires_at < clock - timedelta(days=1))
        )
        recent = db.scalar(
            select(func.count())
            .select_from(ReceiptPairing)
            .where(
                ReceiptPairing.requester_hash == requester_hash,
                ReceiptPairing.created_at > clock - timedelta(minutes=1),
            )
        )
        active = db.scalar(
            select(func.count())
            .select_from(ReceiptPairing)
            .where(ReceiptPairing.expires_at > clock)
        )
        if recent >= 6 or active >= 128:
            db.rollback()
            raise ApiError(429, "DEVICE_RATE_LIMIT", "授权请求过于频繁，请稍后重试")
        device_code = secrets.token_urlsafe(32)
        user_code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(8))
        row = ReceiptPairing(
            device_code_hash=digest(device_code),
            user_code_hash=digest(user_code),
            requester_hash=requester_hash,
            device_name=device_name,
            status="pending",
            created_at=clock,
            expires_at=clock + timedelta(seconds=PAIRING_SECONDS),
        )
        verification_uri = public_origin() + "/receipt-devices"
        db.add(row)
        db.commit()
    return {
        "deviceCode": device_code,
        "userCode": user_code[:4] + "-" + user_code[4:],
        "verificationUri": verification_uri,
        "expiresAt": as_utc(row.expires_at).isoformat(),
        "interval": POLL_SECONDS,
    }


def owner_pairing(db: Session, code: str, owner_id: uuid.UUID) -> ReceiptPairing:
    row = db.scalar(
        select(ReceiptPairing).where(ReceiptPairing.user_code_hash == digest(normalize_code(code)))
    )
    if (
        row is None
        or as_utc(row.expires_at) <= now()
        or (row.user_id is not None and row.user_id != owner_id)
    ):
        raise ApiError(404, "DEVICE_CODE_INVALID", "授权码无效或已过期")
    return row


def decide_pairing(db: Session, code: str, user: User, approved: bool) -> dict:
    row = owner_pairing(db, code, user.id)
    target = "approved" if approved else "denied"
    if row.status == target and row.user_id == user.id:
        return {"status": target}
    if row.status != "pending":
        raise ApiError(409, "DEVICE_CODE_USED", "该授权码已经处理，请重新发起")
    changed = db.execute(
        update(ReceiptPairing)
        .where(ReceiptPairing.id == row.id, ReceiptPairing.status == "pending")
        .values(status=target, user_id=user.id, password_fingerprint=digest(user.password_hash))
    )
    if changed.rowcount != 1:
        db.rollback()
        raise ApiError(409, "DEVICE_CODE_USED", "该授权码已经处理，请重新发起")
    db.add(
        AuditLog(
            user_id=user.id,
            action="receipt_device." + target,
            entity_type="receipt_pairing",
            entity_id=row.id,
        )
    )
    db.commit()
    return {"status": target}


def exchange_pairing(db: Session, device_code: str) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}", device_code):
        raise ApiError(401, "DEVICE_CODE_INVALID", "设备授权无效")
    clock = now()
    row = db.scalar(
        select(ReceiptPairing).where(ReceiptPairing.device_code_hash == digest(device_code))
    )
    if row is None or as_utc(row.expires_at) <= clock:
        raise ApiError(410, "DEVICE_CODE_EXPIRED", "授权码已过期，请重新授权")
    if row.status == "denied":
        raise ApiError(403, "DEVICE_ACCESS_DENIED", "设备授权已拒绝")
    if row.status == "consumed":
        raise ApiError(409, "DEVICE_CODE_USED", "授权码已经使用，请重新授权")
    if row.status == "pending":
        changed = db.execute(
            update(ReceiptPairing)
            .where(
                ReceiptPairing.id == row.id,
                or_(
                    ReceiptPairing.last_poll_at.is_(None),
                    ReceiptPairing.last_poll_at <= clock - timedelta(seconds=POLL_SECONDS),
                ),
            )
            .values(last_poll_at=clock)
            .execution_options(synchronize_session=False)
        )
        if changed.rowcount != 1:
            db.rollback()
            raise ApiError(429, "DEVICE_SLOW_DOWN", "请稍后再查询授权结果")
        db.commit()
        return {"status": "authorization_pending", "interval": POLL_SECONDS}
    user = db.get(User, row.user_id)
    if user is None or digest(user.password_hash) != row.password_fingerprint:
        raise ApiError(410, "DEVICE_CODE_EXPIRED", "授权已失效，请重新授权")
    changed = db.execute(
        update(ReceiptPairing)
        .where(ReceiptPairing.id == row.id, ReceiptPairing.status == "approved")
        .values(status="consumed")
    )
    if changed.rowcount != 1:
        db.rollback()
        raise ApiError(409, "DEVICE_CODE_USED", "授权码已经使用，请重新授权")
    token = secrets.token_urlsafe(32)
    grant = ReceiptDevice(
        user_id=user.id,
        token_hash=digest(token),
        password_fingerprint=digest(user.password_hash),
        resource=public_origin(),
        device_name=row.device_name,
        created_at=clock,
        expires_at=None,
    )
    db.add(grant)
    db.flush()
    db.add(
        AuditLog(
            user_id=user.id,
            action="receipt_device.issued",
            entity_type="receipt_device",
            entity_id=grant.id,
            after_data={"scope": SCOPE},
        )
    )
    db.commit()
    return {
        "accessToken": token,
        "tokenType": "Bearer",
        "deviceId": str(grant.id),
        "expiresAt": None,
        "scope": SCOPE,
    }


def authenticate_device(db: Session, authorization: str) -> ReceiptDevice:
    if not re.fullmatch(r"Bearer [A-Za-z0-9_-]{43}", authorization):
        raise ApiError(401, "DEVICE_UNAUTHORIZED", "设备授权无效，请重新授权")
    row = db.scalar(
        select(ReceiptDevice).where(ReceiptDevice.token_hash == digest(authorization[7:]))
    )
    user = db.get(User, row.user_id) if row else None
    if (
        row is None
        or user is None
        or row.revoked_at is not None
        or (row.expires_at is not None and as_utc(row.expires_at) <= now())
        or row.resource != public_origin()
        or row.password_fingerprint != digest(user.password_hash)
    ):
        raise ApiError(401, "DEVICE_UNAUTHORIZED", "设备授权已失效，请重新授权")
    return row
