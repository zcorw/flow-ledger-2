import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class CurrencyResponse(BaseModel):
    code: str
    name: str
    symbol: str | None
    decimal_places: int
    enabled: bool
    is_base: bool


class EnabledCurrenciesRequest(BaseModel):
    enabled_currency_codes: list[str] = Field(alias="enabledCurrencyCodes", min_length=1)


class FxRateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    base_currency: str
    quote_currency: str
    rate_date: date
    rate_to_base: Decimal
    source: str
    fetched_at: datetime


class FxSyncRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    started_at: datetime
    finished_at: datetime | None
    status: str
    currencies: list[str]
    message: str | None
