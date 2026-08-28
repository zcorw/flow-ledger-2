import uuid
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.asset import LiquidityLevel, RiskLevel


class SnapshotBulkRow(BaseModel):
    project_id: uuid.UUID = Field(alias="projectId")
    original_amount: Decimal = Field(alias="originalAmount", max_digits=20, decimal_places=6)
    liquidity_level: LiquidityLevel = Field(alias="liquidityLevel")
    risk_level: RiskLevel = Field(alias="riskLevel")
    change_note: str | None = Field(default=None, alias="changeNote", max_length=2000)


class SnapshotBulkRequest(BaseModel):
    snapshot_date: date = Field(alias="snapshotDate")
    rows: list[SnapshotBulkRow] = Field(min_length=1)


class CopyPreviousRequest(BaseModel):
    target_date: date = Field(alias="targetDate")


class SnapshotUpdateRequest(BaseModel):
    snapshot_date: date = Field(alias="snapshotDate")
    original_amount: Decimal = Field(alias="originalAmount", max_digits=20, decimal_places=6)


class SnapshotUpdateResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    snapshot_date: date
    currency_code: str
    original_amount: Decimal
    converted_amount_cny: Decimal
    fx_rate_to_cny: Decimal
    fx_is_stale: bool


class SnapshotRowResponse(BaseModel):
    id: uuid.UUID | None
    project_id: uuid.UUID
    institution_name: str
    account_name: str
    project_name: str
    asset_type: str
    currency_code: str
    original_amount: Decimal | None
    converted_amount_cny: Decimal | None
    previous_original_amount: Decimal | None
    fx_rate_to_cny: Decimal | None
    fx_is_stale: bool
    liquidity_level: str
    risk_level: str
    change_note: str | None
    change_amount_cny: Decimal | None
    change_percent: Decimal | None
    unusual_change: bool


class SnapshotWarning(BaseModel):
    project_id: uuid.UUID
    message: str


class SnapshotSheetResponse(BaseModel):
    snapshot_date: date
    source_date: date | None = None
    rows: list[SnapshotRowResponse]
    missing_project_ids: list[uuid.UUID]
    warnings: list[SnapshotWarning] = Field(default_factory=list)


HistoryLevel = Literal["institution", "account", "project"]


class SnapshotHistoryTrendPoint(BaseModel):
    snapshot_date: date
    amount_cny: Decimal


class SnapshotHistoryCompositionPoint(BaseModel):
    entity_id: uuid.UUID
    name: str
    amount_cny: Decimal


class SnapshotHistoryRow(BaseModel):
    id: uuid.UUID
    snapshot_date: date
    institution_name: str | None
    account_name: str
    project_name: str
    currency_code: str
    original_amount: Decimal
    fx_rate_to_cny: Decimal
    fx_is_stale: bool
    converted_amount_cny: Decimal
    change_amount_cny: Decimal | None
    change_percent: Decimal | None
    change_note: str | None


class SnapshotHistoryResponse(BaseModel):
    level: HistoryLevel
    entity_id: uuid.UUID
    entity_name: str
    date_from: date | None
    date_to: date | None
    latest_snapshot_date: date | None
    latest_amount_cny: Decimal | None
    latest_change_amount_cny: Decimal | None
    latest_change_percent: Decimal | None
    max_amount_cny: Decimal | None
    min_amount_cny: Decimal | None
    snapshot_count: int
    record_count: int
    trend: list[SnapshotHistoryTrendPoint]
    composition: list[SnapshotHistoryCompositionPoint]
    rows: list[SnapshotHistoryRow]
