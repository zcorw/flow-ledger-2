import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models.debt import DebtEvent


def event_delta(event_type: str, amount: Decimal) -> Decimal:
    if event_type in {"issue", "adjustment"}:
        return amount
    return -amount


def debt_balance_at(
    db: Session, debt_item_id: uuid.UUID, snapshot_date: date
) -> tuple[Decimal, date | None]:
    events = list(
        db.scalars(
            select(DebtEvent)
            .where(
                DebtEvent.debt_item_id == debt_item_id,
                DebtEvent.event_date <= snapshot_date,
            )
            .order_by(DebtEvent.event_date, DebtEvent.created_at, DebtEvent.id)
        )
    )
    balance = sum((event_delta(item.event_type, item.amount) for item in events), Decimal("0"))
    return balance, events[-1].event_date if events else None


def validate_event_amount(event_type: str, amount: Decimal) -> None:
    if event_type in {"issue", "repayment"} and amount <= 0:
        raise ApiError(400, "INVALID_EVENT_AMOUNT", "新增和还款金额必须大于零")
    if event_type == "adjustment" and amount == 0:
        raise ApiError(400, "INVALID_EVENT_AMOUNT", "调整金额不能为零")
