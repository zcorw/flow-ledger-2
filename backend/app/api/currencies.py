from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.dependencies import CurrentAuthDependency
from app.core.config import Settings, get_settings
from app.core.errors import ApiError
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.configuration import AppSetting, Currency, UserCurrency
from app.schemas.fx import CurrencyResponse, EnabledCurrenciesRequest

router = APIRouter()
DbDependency = Annotated[Session, Depends(get_db)]
SettingsDependency = Annotated[Settings, Depends(get_settings)]


def currency_rows(db: Session, user_id) -> list[CurrencyResponse]:
    enabled = {
        row.currency_code: row.is_base
        for row in db.scalars(select(UserCurrency).where(UserCurrency.user_id == user_id))
    }
    currencies = db.scalars(
        select(Currency).where(Currency.is_enabled_globally.is_(True)).order_by(Currency.sort_order)
    )
    return [
        CurrencyResponse(
            code=currency.code,
            name=currency.name,
            symbol=currency.symbol,
            decimal_places=currency.decimal_places,
            enabled=currency.code in enabled,
            is_base=enabled.get(currency.code, False),
        )
        for currency in currencies
    ]


@router.get("", response_model=list[CurrencyResponse])
def list_currencies(auth: CurrentAuthDependency, db: DbDependency) -> list[CurrencyResponse]:
    return currency_rows(db, auth.user.id)


@router.put("/enabled", response_model=list[CurrencyResponse])
def update_enabled_currencies(
    payload: EnabledCurrenciesRequest,
    request: Request,
    auth: CurrentAuthDependency,
    db: DbDependency,
    settings: SettingsDependency,
) -> list[CurrencyResponse]:
    codes = list(dict.fromkeys(code.upper() for code in payload.enabled_currency_codes))
    if settings.base_currency not in codes:
        raise ApiError(400, "BASE_CURRENCY_REQUIRED", "CNY 基础币种必须保持启用")
    limit_setting = db.scalar(select(AppSetting).where(AppSetting.key == "currency_limit"))
    limit = (
        int(limit_setting.value.get("value", settings.currency_limit))
        if limit_setting
        else settings.currency_limit
    )
    if len(codes) > limit:
        raise ApiError(400, "CURRENCY_LIMIT_EXCEEDED", f"最多只能启用 {limit} 个币种")
    available = set(db.scalars(select(Currency.code).where(Currency.is_enabled_globally.is_(True))))
    unknown = sorted(set(codes) - available)
    if unknown:
        raise ApiError(400, "UNKNOWN_CURRENCY", f"未知币种：{', '.join(unknown)}")

    before = [
        row.currency_code
        for row in db.scalars(select(UserCurrency).where(UserCurrency.user_id == auth.user.id))
    ]
    db.execute(delete(UserCurrency).where(UserCurrency.user_id == auth.user.id))
    db.add_all(
        [
            UserCurrency(
                user_id=auth.user.id,
                currency_code=code,
                is_base=code == settings.base_currency,
            )
            for code in codes
        ]
    )
    db.add(
        AuditLog(
            user_id=auth.user.id,
            action="currencies.enabled_updated",
            entity_type="user_currencies",
            before_data={"codes": before},
            after_data={"codes": codes},
            ip_address=request.client.host if request.client else None,
        )
    )
    db.commit()
    return currency_rows(db, auth.user.id)
