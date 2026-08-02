from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import CurrentAuthDependency
from app.db.session import get_db
from app.models.fx import FxRate, FxSyncRun
from app.schemas.fx import FxRateResponse, FxSyncRunResponse
from app.services.fx import (
    FrankfurterFxProvider,
    enabled_currency_codes,
    get_fx_provider,
    sync_enabled_rates,
)

router = APIRouter()
DbDependency = Annotated[Session, Depends(get_db)]
ProviderDependency = Annotated[FrankfurterFxProvider, Depends(get_fx_provider)]


@router.get("/latest", response_model=list[FxRateResponse])
def latest_rates(auth: CurrentAuthDependency, db: DbDependency) -> list[FxRateResponse]:
    results: list[FxRate] = []
    for code in enabled_currency_codes(db, auth.user.id):
        if code == "CNY":
            continue
        rate = db.scalar(
            select(FxRate)
            .where(FxRate.quote_currency == code)
            .order_by(FxRate.rate_date.desc(), FxRate.fetched_at.desc())
            .limit(1)
        )
        if rate:
            results.append(rate)
    return [FxRateResponse.model_validate(rate) for rate in results]


@router.get("/history", response_model=list[FxRateResponse])
def rate_history(
    auth: CurrentAuthDependency,
    db: DbDependency,
    currency: Annotated[str, Query(min_length=3, max_length=3)],
    date_from: Annotated[date, Query(alias="from")],
    date_to: Annotated[date, Query(alias="to")],
) -> list[FxRateResponse]:
    if currency.upper() not in enabled_currency_codes(db, auth.user.id):
        return []
    rows = db.scalars(
        select(FxRate)
        .where(
            FxRate.quote_currency == currency.upper(),
            FxRate.rate_date.between(date_from, date_to),
        )
        .order_by(FxRate.rate_date)
    )
    return [FxRateResponse.model_validate(rate) for rate in rows]


@router.post("/sync", response_model=FxSyncRunResponse)
def sync_rates(
    auth: CurrentAuthDependency,
    db: DbDependency,
    provider: ProviderDependency,
) -> FxSyncRunResponse:
    run: FxSyncRun = sync_enabled_rates(
        db,
        auth.user.id,
        provider,
        triggered_by_user_id=auth.user.id,
    )
    return FxSyncRunResponse.model_validate(run)


@router.get("/sync-runs", response_model=list[FxSyncRunResponse])
def sync_runs(auth: CurrentAuthDependency, db: DbDependency) -> list[FxSyncRunResponse]:
    rows = db.scalars(
        select(FxSyncRun)
        .where(
            (FxSyncRun.triggered_by_user_id == auth.user.id)
            | (FxSyncRun.triggered_by_user_id.is_(None))
        )
        .order_by(FxSyncRun.started_at.desc())
        .limit(20)
    )
    return [FxSyncRunResponse.model_validate(run) for run in rows]
