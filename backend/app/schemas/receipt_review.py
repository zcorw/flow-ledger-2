import re
import uuid
from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.expense import ExpenseCategory


class ReviewFields(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, populate_by_name=True)

    amount: str = Field(default="", max_length=32)
    expense_date: str = Field(default="", alias="expenseDate", max_length=10)
    currency_code: str = Field(default="", alias="currencyCode", max_length=3)
    merchant: str = Field(default="", max_length=150)
    category: ExpenseCategory | str = Field(default="", max_length=40)
    account_id: str = Field(default="", alias="accountId", max_length=36)
    account_name: str = Field(default="", alias="accountName", max_length=150)
    note: str = Field(default="", max_length=2000)

    @field_validator("amount")
    @classmethod
    def decimal_string(cls, value):
        if value and (
            not re.fullmatch(r"[0-9]{1,14}(?:\.[0-9]{1,6})?", value)
            or not any(c in "123456789" for c in value)
        ):
            raise ValueError("Invalid amount")
        return value

    @field_validator("expense_date")
    @classmethod
    def calendar_date(cls, value):
        if value and date.fromisoformat(value).isoformat() != value:
            raise ValueError("Invalid calendar date")
        return value

    @field_validator("currency_code")
    @classmethod
    def iso_code(cls, value):
        if value and not re.fullmatch(r"[A-Z]{3}", value):
            raise ValueError("Invalid currency")
        return value


class CorrectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    transcript: str = Field(min_length=1, max_length=1000)
    values: ReviewFields

    @field_validator("transcript")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Empty transcript")
        return value.strip()


class VoicePatch(BaseModel):
    """Null means unchanged; an empty string is an explicit field clear."""

    model_config = ConfigDict(extra="forbid", strict=True)

    amount: str | None = Field(max_length=32)
    expenseDate: str | None = Field(max_length=10)
    currencyCode: str | None = Field(max_length=3)
    merchant: str | None = Field(max_length=150)
    category: str | None = Field(max_length=40)
    accountName: str | None = Field(max_length=150)
    note: str | None = Field(max_length=2000)
    warnings: list[str] = Field(max_length=6)


class DraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    receipt_id: uuid.UUID = Field(alias="receiptId")
    request_key: uuid.UUID = Field(alias="requestKey")
    expected_revision: int = Field(alias="expectedRevision", ge=0, strict=True)
    values: ReviewFields
