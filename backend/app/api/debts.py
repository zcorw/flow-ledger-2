import uuid
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import CurrentAuthDependency
from app.core.errors import ApiError
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.debt import DebtEvent, DebtItem
from app.schemas.debt import (
    DebtBalanceResponse,
    DebtBalanceSheetResponse,
    DebtCreateRequest,
    DebtEventRequest,
    DebtEventResponse,
)
from app.services.debt import (
    debt_balance_at,
    debt_balance_latest,
    event_delta,
    validate_event_amount,
)
from app.services.fx import enabled_currency_codes, resolve_rate

router = APIRouter()
DbDependency = Annotated[Session, Depends(get_db)]
MONEY_QUANTIZER = Decimal("0.000001")


def _debt(db: Session, user_id: uuid.UUID, entity_id: uuid.UUID) -> DebtItem:
    item = db.scalar(select(DebtItem).where(DebtItem.id == entity_id, DebtItem.user_id == user_id))
    if item is None:
        raise ApiError(404, "DEBT_NOT_FOUND", "债权债务项目不存在")
    return item


def _build_balance_response(
    db: Session,
    item: DebtItem,
    balance: Decimal,
    last_event_date: date | None,
    rate_date: date,
) -> DebtBalanceResponse:
    rate = resolve_rate(db, item.currency_code, rate_date)
    converted = (balance * rate.rate_to_cny).quantize(MONEY_QUANTIZER, rounding=ROUND_HALF_UP)
    return DebtBalanceResponse(
        id=item.id,
        debt_type=item.debt_type,
        counterparty=item.counterparty,
        currency_code=item.currency_code,
        status=item.status,
        notes=item.notes,
        balance=balance,
        converted_amount_cny=converted,
        fx_rate_to_cny=rate.rate_to_cny,
        fx_is_stale=rate.is_stale,
        last_event_date=last_event_date,
    )


def _balance_response_at(db: Session, item: DebtItem, snapshot_date: date) -> DebtBalanceResponse:
    balance, last_event_date = debt_balance_at(db, item.id, snapshot_date)
    return _build_balance_response(db, item, balance, last_event_date, snapshot_date)


def _latest_balance_response(db: Session, item: DebtItem) -> DebtBalanceResponse:
    balance, last_event_date = debt_balance_latest(db, item.id)
    return _build_balance_response(db, item, balance, last_event_date, date.today())


@router.get("", response_model=list[DebtBalanceResponse])
def list_debts(
    auth: CurrentAuthDependency,
    db: DbDependency,
    debt_type: Annotated[str, Query(alias="type", pattern="^(receivable|payable)$")],
) -> list[DebtBalanceResponse]:
    items = db.scalars(
        select(DebtItem)
        .where(DebtItem.user_id == auth.user.id, DebtItem.debt_type == debt_type)
        .order_by(DebtItem.updated_at.desc())
    )
    return [_latest_balance_response(db, item) for item in items]


@router.post("", response_model=DebtBalanceResponse, status_code=status.HTTP_201_CREATED)
def create_debt(
    payload: DebtCreateRequest, auth: CurrentAuthDependency, db: DbDependency
) -> DebtBalanceResponse:
    if payload.currency_code not in enabled_currency_codes(db, auth.user.id):
        raise ApiError(400, "CURRENCY_NOT_ENABLED", "债权债务币种尚未启用")
    item = DebtItem(
        id=uuid.uuid4(),
        user_id=auth.user.id,
        debt_type=payload.debt_type,
        counterparty=payload.counterparty,
        currency_code=payload.currency_code,
        status="active",
        notes=payload.notes,
    )
    db.add(item)
    db.add(
        AuditLog(
            user_id=auth.user.id,
            action="debt.create",
            entity_type="debt_item",
            entity_id=item.id,
            after_data=payload.model_dump(mode="json"),
        )
    )
    db.commit()
    return _latest_balance_response(db, item)


@router.get("/balances", response_model=DebtBalanceSheetResponse)
def debt_balances(
    auth: CurrentAuthDependency,
    db: DbDependency,
    snapshot_date: Annotated[date, Query(alias="snapshotDate")],
) -> DebtBalanceSheetResponse:
    items = [
        _balance_response_at(db, item, snapshot_date)
        for item in db.scalars(select(DebtItem).where(DebtItem.user_id == auth.user.id))
    ]
    return DebtBalanceSheetResponse(
        snapshot_date=snapshot_date,
        items=items,
        total_receivable_cny=sum(
            (item.converted_amount_cny for item in items if item.debt_type == "receivable"),
            Decimal("0"),
        ),
        total_payable_cny=sum(
            (item.converted_amount_cny for item in items if item.debt_type == "payable"),
            Decimal("0"),
        ),
    )


@router.get("/{entity_id}/events", response_model=list[DebtEventResponse])
def list_debt_events(
    entity_id: uuid.UUID, auth: CurrentAuthDependency, db: DbDependency
) -> list[DebtEvent]:
    _debt(db, auth.user.id, entity_id)
    return list(
        db.scalars(
            select(DebtEvent)
            .where(DebtEvent.debt_item_id == entity_id, DebtEvent.user_id == auth.user.id)
            .order_by(DebtEvent.event_date.desc(), DebtEvent.created_at.desc())
        )
    )


@router.post("/{entity_id}/events", response_model=DebtEventResponse, status_code=201)
def create_debt_event(
    entity_id: uuid.UUID,
    payload: DebtEventRequest,
    auth: CurrentAuthDependency,
    db: DbDependency,
) -> DebtEvent:
    item = _debt(db, auth.user.id, entity_id)
    validate_event_amount(payload.event_type, payload.amount)
    before_balance, _ = debt_balance_at(db, item.id, payload.event_date)
    stored_amount = before_balance if payload.event_type == "settle" else payload.amount
    if payload.event_type == "settle" and before_balance <= 0:
        raise ApiError(400, "NOTHING_TO_SETTLE", "当前没有可结清本金")
    resulting_balance = before_balance + event_delta(payload.event_type, stored_amount)
    allow_negative = payload.event_type == "adjustment" and payload.confirm_negative
    if resulting_balance < 0 and not allow_negative:
        code = (
            "NEGATIVE_CONFIRMATION_REQUIRED"
            if payload.event_type == "adjustment"
            else "NEGATIVE_BALANCE"
        )
        raise ApiError(409, code, "该事件会导致未偿本金为负数")
    event = DebtEvent(
        id=uuid.uuid4(),
        user_id=auth.user.id,
        debt_item_id=item.id,
        event_type=payload.event_type,
        event_date=payload.event_date,
        amount=stored_amount,
        counterparty=payload.counterparty.strip(),
        note=payload.note.strip() if payload.note else None,
    )
    db.add(event)
    db.flush()
    current_balance, _ = debt_balance_latest(db, item.id)
    if current_balance == 0:
        item.status = "settled"
    elif payload.event_type == "repayment":
        item.status = "partially_settled"
    else:
        item.status = "active"
    db.add(
        AuditLog(
            user_id=auth.user.id,
            action="debt.event.create",
            entity_type="debt_event",
            entity_id=event.id,
            after_data={
                **payload.model_dump(mode="json"),
                "storedAmount": str(stored_amount),
                "resultingBalance": str(resulting_balance),
            },
        )
    )
    db.commit()
    db.refresh(event)
    return event
