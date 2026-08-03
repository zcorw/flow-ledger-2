import re
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

InstitutionType = Literal["bank", "broker", "cash", "person", "other"]
AccountType = Literal[
    "savings", "wealth_management", "brokerage", "cash_wallet", "loan_related", "other"
]
AssetType = Literal["bank_deposit", "cash", "securities"]
LiquidityLevel = Literal["t0", "within_7d", "within_30d", "within_90d", "locked_or_unknown"]
RiskLevel = Literal["low", "medium", "high"]


class NamedPayload(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    display_color: str | None = Field(default=None, alias="displayColor", max_length=20)
    is_active: bool = Field(default=True, alias="isActive")

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return value.strip()


class InstitutionPayload(NamedPayload):
    institution_type: InstitutionType = Field(alias="institutionType")


class InstitutionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    institution_type: str
    display_color: str | None
    is_active: bool
    account_count: int = 0
    project_count: int = 0


class AccountPayload(NamedPayload):
    institution_id: uuid.UUID | None = Field(default=None, alias="institutionId")
    account_type: AccountType = Field(alias="accountType")
    masked_identifier: str | None = Field(default=None, alias="maskedIdentifier", max_length=80)

    @field_validator("masked_identifier")
    @classmethod
    def reject_full_account_numbers(cls, value: str | None) -> str | None:
        normalized = value.strip() if value else None
        if normalized and re.search(r"\d{7,}", normalized):
            raise ValueError("只允许保存尾号或脱敏简称，不能保存完整账号")
        return normalized


class AccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    institution_id: uuid.UUID | None
    name: str
    account_type: str
    masked_identifier: str | None
    display_color: str | None
    is_active: bool
    project_count: int = 0


class ProjectPayload(BaseModel):
    account_id: uuid.UUID = Field(alias="accountId")
    name: str = Field(min_length=1, max_length=150)
    asset_type: AssetType = Field(alias="assetType")
    currency_code: str = Field(alias="currencyCode", min_length=3, max_length=3)
    default_liquidity_level: LiquidityLevel = Field(alias="defaultLiquidityLevel")
    default_risk_level: RiskLevel = Field(alias="defaultRiskLevel")
    is_active: bool = Field(default=True, alias="isActive")
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return value.strip()

    @field_validator("currency_code")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        return value.upper()


class ProjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    account_id: uuid.UUID
    name: str
    asset_type: str
    currency_code: str
    default_liquidity_level: str
    default_risk_level: str
    is_active: bool
    notes: str | None
