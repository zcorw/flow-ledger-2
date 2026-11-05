from pydantic import BaseModel, ConfigDict, Field


class ReceiptExtraction(BaseModel):
    """Nullable strings preserve decimal precision and uncertainty from the image."""

    model_config = ConfigDict(extra="forbid", strict=True)

    is_receipt: bool
    amount: str | None = Field(max_length=32)
    expense_date: str | None = Field(max_length=32)
    currency_code: str | None = Field(max_length=16)
    merchant: str | None = Field(max_length=150)
    warnings: list[str] = Field(max_length=6)


class ReceiptCandidate(BaseModel):
    amount: str
    expenseDate: str
    currencyCode: str
    merchant: str
    warnings: list[str]
