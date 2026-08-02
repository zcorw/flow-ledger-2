from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.dependencies import CurrentAuthDependency
from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.core.security import SESSION_COOKIE_NAME, hash_password, verify_password
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.auth import AuthSession
from app.models.user import User
from app.schemas.auth import ChangePasswordRequest, LoginRequest, UserResponse
from app.services.auth import (
    clear_session_cookie,
    create_session,
    revoke_session,
    set_session_cookie,
)

router = APIRouter()
DbDependency = Annotated[Session, Depends(get_db)]
SettingsDependency = Annotated[Settings, Depends(get_settings)]


@router.post("/login", response_model=UserResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: DbDependency,
    settings: SettingsDependency,
) -> UserResponse:
    user = db.scalar(select(User).where(User.email == str(payload.email).casefold()))
    if user is None or not verify_password(payload.password, user.password_hash):
        db.add(
            AuditLog(
                user_id=user.id if user else None,
                action="auth.login_failed",
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
        )
        db.commit()
        raise ApiError(401, "INVALID_CREDENTIALS", "邮箱或密码错误")

    token = create_session(db, user)
    db.add(
        AuditLog(
            user_id=user.id,
            action="auth.login",
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
    )
    db.commit()
    set_session_cookie(response, token, settings)
    return UserResponse.model_validate(user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: DbDependency) -> None:
    revoke_session(db, request.cookies.get(SESSION_COOKIE_NAME))
    db.commit()
    clear_session_cookie(response)


@router.get("/me", response_model=UserResponse)
def me(auth: CurrentAuthDependency, db: DbDependency) -> UserResponse:
    db.commit()
    return UserResponse.model_validate(auth.user)


@router.post("/change-password", response_model=UserResponse)
def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    auth: CurrentAuthDependency,
    db: DbDependency,
    settings: SettingsDependency,
) -> UserResponse:
    if not verify_password(payload.current_password, auth.user.password_hash):
        raise ApiError(400, "INVALID_CURRENT_PASSWORD", "当前密码不正确")
    if verify_password(payload.new_password, auth.user.password_hash):
        raise ApiError(400, "PASSWORD_UNCHANGED", "新密码不能与当前密码相同")

    auth.user.password_hash = hash_password(payload.new_password)
    db.execute(delete(AuthSession).where(AuthSession.user_id == auth.user.id))
    token = create_session(db, auth.user)
    db.add(
        AuditLog(
            user_id=auth.user.id,
            action="auth.password_changed",
            entity_type="user",
            entity_id=auth.user.id,
        )
    )
    db.commit()
    set_session_cookie(response, token, settings)
    return UserResponse.model_validate(auth.user)
