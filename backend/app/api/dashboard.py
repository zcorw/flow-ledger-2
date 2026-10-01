from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.dependencies import CurrentAuthDependency
from app.db.session import get_db
from app.schemas.dashboard import DashboardCharts, DashboardMonths, DashboardSummary
from app.services.dashboard import (
    TrendRange,
    dashboard_charts,
    dashboard_months,
    dashboard_summary,
)

router = APIRouter()
DbDependency = Annotated[Session, Depends(get_db)]


@router.get("/months", response_model=DashboardMonths)
def months(
    auth: CurrentAuthDependency,
    db: DbDependency,
) -> DashboardMonths:
    return dashboard_months(db, auth.user.id)


@router.get("/summary", response_model=DashboardSummary)
def summary(
    auth: CurrentAuthDependency,
    db: DbDependency,
    snapshot_date: Annotated[date, Query(alias="snapshotDate")],
) -> DashboardSummary:
    return dashboard_summary(db, auth.user.id, snapshot_date)


@router.get("/charts", response_model=DashboardCharts)
def charts(
    auth: CurrentAuthDependency,
    db: DbDependency,
    snapshot_date: Annotated[date, Query(alias="snapshotDate")],
    trend_range: Annotated[TrendRange, Query(alias="trendRange")] = "12m",
) -> DashboardCharts:
    return dashboard_charts(db, auth.user.id, snapshot_date, trend_range)
