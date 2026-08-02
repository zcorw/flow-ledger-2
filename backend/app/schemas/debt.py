import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

DebtType = Literal["receivable", "payable"]
DebtStatus = Literal["active", "partially_settled", "settled", "overdue", "written_off"]
EventType = Literal["issue", "repayment", "adjustment", "settle"]


class DebtCreateRequest(BaseModel):
    debt_type: DebtType = Field(alias="debtType")
    counterparty: str = Field(min_length=1, max_length=150)
    currency_code: str = Field(alias="currencyCode", min_length=3, max_length=3)
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("counterparty")
    @classmethod
    def normalize_counterparty(cls, value: str) -> str:
        return value.strip()

    @field_validator("currency_code")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        return value.upper()


class DebtEventRequest(BaseModel):
    event_type: EventType = Field(alias="eventType")
    event_date: date = Field(alias="eventDate")
    amount: Decimal = Field(max_digits=20, decimal_places=6)
    counterparty: str = Field(min_length=1, max_length=150)
    note: str | None = Field(default=None, max_length=2000)
    confirm_negative: bool = Field(default=False, alias="confirmNegative")


class DebtEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    debt_item_id: uuid.UUID
    event_type: str
    event_date: date
    amount: Decimal
    counterparty: str
    note: str | None
    created_at: datetime


class DebtBalanceResponse(BaseModel):
    id: uuid.UUID
    debt_type: str
    counterparty: str
    currency_code: str
    status: str
    notes: str | None
    balance: Decimal
    converted_amount_cny: Decimal
    fx_rate_to_cny: Decimal
    fx_is_stale: bool
    last_event_date: date | None


class DebtBalanceSheetResponse(BaseModel):
    snapshot_date: date
    items: list[DebtBalanceResponse]
    total_receivable_cny: Decimal
    total_payable_cny: Decimal
