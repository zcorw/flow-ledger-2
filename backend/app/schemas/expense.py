import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ExpenseCategory = Literal[
    "uncategorized",
    "food",
    "groceries",
    "transport",
    "housing",
    "utilities",
    "shopping",
    "health",
    "entertainment",
    "education",
    "travel",
    "other",
]


class ExpenseFields(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    expense_date: date = Field(alias="expenseDate")
    amount: Decimal = Field(gt=0, lt=Decimal("100000000000000"), max_digits=20, decimal_places=6)
    currency_code: str = Field(alias="currencyCode", pattern=r"^[A-Z]{3}$")
    category: ExpenseCategory = "uncategorized"
    merchant: str | None = Field(default=None, max_length=150)
    account_id: uuid.UUID | None = Field(default=None, alias="accountId")
    note: str | None = Field(default=None, max_length=2000)

    @field_validator("expense_date", mode="before")
    @classmethod
    def calendar_date_only(cls, value):
        if isinstance(value, str):
            # No implicit timestamp/timezone conversion for a user's calendar date.
            parsed = date.fromisoformat(value)
            if parsed.isoformat() != value:
                raise ValueError("消费日期须为 YYYY-MM-DD")
            return parsed
        if isinstance(value, datetime) or not isinstance(value, date):
            raise ValueError("消费日期须为 YYYY-MM-DD")
        return value

    @field_validator("merchant", "note")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        return (value.strip() or None) if value else None


class ExpenseCreate(ExpenseFields):
    request_key: uuid.UUID = Field(alias="requestKey")
    source: Literal["manual", "receipt_ocr"] = "manual"
    allow_duplicate: bool = Field(default=False, alias="allowDuplicate")


class ExpenseResponse(ExpenseFields):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    source: str
    created_at: datetime
    updated_at: datetime
