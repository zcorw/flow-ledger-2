from datetime import date
from decimal import Decimal

from pydantic import BaseModel


class DashboardSummary(BaseModel):
    snapshot_date: date
    total_assets_cny: Decimal
    total_liabilities_cny: Decimal
    net_worth_cny: Decimal
    net_worth_change_from_previous_month_cny: Decimal | None
    foreign_asset_ratio: Decimal
    fx_warnings: list[str]


class DashboardMonths(BaseModel):
    available_months: list[str]
    latest_month: str | None


class ChartPoint(BaseModel):
    name: str
    value: Decimal


class TrendPoint(BaseModel):
    date: date
    value: Decimal


class ProjectChangePoint(BaseModel):
    project_name: str
    institution_name: str
    value: Decimal


class DashboardCharts(BaseModel):
    trend: list[TrendPoint]
    asset_composition: list[ChartPoint]
    liquidity_distribution: list[ChartPoint]
    risk_distribution: list[ChartPoint]
    currency_distribution: list[ChartPoint]
    top_institutions: list[ChartPoint]
    project_changes: list[ProjectChangePoint]
