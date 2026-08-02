import uuid
from datetime import date
from decimal import Decimal

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
