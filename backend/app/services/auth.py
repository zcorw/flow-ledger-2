import hmac
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ApiError
from app.core.security import (
    SESSION_COOKIE_NAME,
    generate_session_token,
    hash_session_token,
    session_expiry,
)
from app.models.auth import AuthSession
from app.models.user import User


@dataclass(frozen=True)
class CurrentAuth:
    user: User
    session: AuthSession


def set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=30 * 24 * 60 * 60,
        httponly=True,
        secure=settings.app_env == "production",
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/", httponly=True, samesite="lax")


def create_session(db: Session, user: User) -> str:
    token = generate_session_token()
    db.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_session_token(token),
            expires_at=session_expiry(),
        )
    )
    return token


def authenticate_request(request: Request, db: Session) -> CurrentAuth:
    raw_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not raw_token:
        raise ApiError(401, "NOT_AUTHENTICATED", "请先登录")

    auth_session = db.scalar(
        select(AuthSession).where(AuthSession.token_hash == hash_session_token(raw_token))
    )
    now = datetime.now(UTC)
    if auth_session is None or auth_session.expires_at.replace(tzinfo=UTC) <= now:
        raise ApiError(401, "SESSION_EXPIRED", "登录会话已失效")

    user = db.get(User, auth_session.user_id)
    if user is None:
        raise ApiError(401, "NOT_AUTHENTICATED", "请先登录")
    auth_session.last_seen_at = now
    return CurrentAuth(user=user, session=auth_session)


def revoke_session(db: Session, raw_token: str | None) -> None:
    if raw_token:
        db.execute(
            delete(AuthSession).where(AuthSession.token_hash == hash_session_token(raw_token))
        )


def tokens_match(provided: str, configured: str) -> bool:
    return hmac.compare_digest(provided.encode("utf-8"), configured.encode("utf-8"))
