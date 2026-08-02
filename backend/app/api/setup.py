from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.core.security import hash_password
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.configuration import AppSetting, Currency, UserCurrency
from app.models.institution import Institution
from app.models.user import User
from app.schemas.auth import BootstrapRequest, SetupStatusResponse, UserResponse
from app.services.auth import create_session, set_session_cookie, tokens_match

router = APIRouter()

DbDependency = Annotated[Session, Depends(get_db)]
SettingsDependency = Annotated[Settings, Depends(get_settings)]

DEFAULT_CURRENCIES = (
    ("CNY", "人民币", "¥", 0),
    ("USD", "美元", "$", 1),
    ("JPY", "日元", "¥", 2),
    ("HKD", "港币", "HK$", 3),
    ("EUR", "欧元", "€", 4),
)


@router.get("/status", response_model=SetupStatusResponse)
def setup_status(db: DbDependency) -> SetupStatusResponse:
    return SetupStatusResponse(requires_setup=(db.scalar(select(func.count(User.id))) or 0) == 0)


@router.post("/bootstrap", response_model=UserResponse, status_code=201)
def bootstrap(
    payload: BootstrapRequest,
    request: Request,
    response: Response,
    db: DbDependency,
    settings: SettingsDependency,
) -> UserResponse:
    if (db.scalar(select(func.count(User.id))) or 0) > 0:
        raise ApiError(409, "SETUP_ALREADY_COMPLETED", "系统已完成初始化")
    if not tokens_match(payload.bootstrap_token, settings.bootstrap_token):
        db.add(
            AuditLog(
                action="setup.bootstrap_failed",
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
        )
        db.commit()
        raise ApiError(403, "INVALID_BOOTSTRAP_TOKEN", "初始化令牌无效")

    user = User(
        email=str(payload.email).casefold(),
        password_hash=hash_password(payload.password),
        display_name=payload.display_name,
        is_admin=True,
    )
    db.add(user)
    db.flush()

    for code, name, symbol, sort_order in DEFAULT_CURRENCIES:
        db.add(
            Currency(
                code=code,
                name=name,
                symbol=symbol,
                sort_order=sort_order,
            )
        )
        db.add(
            UserCurrency(
                user_id=user.id, currency_code=code, is_base=code == settings.base_currency
            )
        )

    db.add_all(
        [
            AppSetting(key="currency_limit", value={"value": settings.currency_limit}),
            AppSetting(key="fx_sync_time", value={"value": settings.fx_sync_time}),
            AppSetting(key="system_initialized", value={"value": True}),
            Institution(
                user_id=user.id,
                name="现金",
                institution_type="cash",
                display_color="#1b7f68",
                is_active=True,
            ),
            AuditLog(
                user_id=user.id,
                action="setup.bootstrap",
                entity_type="user",
                entity_id=user.id,
                after_data={"email": user.email, "displayName": user.display_name},
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            ),
        ]
    )
    token = create_session(db, user)
    db.commit()
    db.refresh(user)
    set_session_cookie(response, token, settings)
    return UserResponse.model_validate(user)
