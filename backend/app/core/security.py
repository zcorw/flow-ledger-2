import hashlib
import secrets
from datetime import timedelta

from pwdlib import PasswordHash

from app.models.common import utc_now

password_hash = PasswordHash.recommended()
SESSION_COOKIE_NAME = "flow_ledger_session"
SESSION_TTL = timedelta(days=30)


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return password_hash.verify(password, hashed_password)


def generate_session_token() -> str:
    return secrets.token_urlsafe(48)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def session_expiry():
    return utc_now() + SESSION_TTL
