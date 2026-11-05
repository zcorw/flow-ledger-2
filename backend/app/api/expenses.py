import hashlib
import json
import uuid
from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.dependencies import CurrentAuthDependency
from app.core.config import get_settings
from app.core.errors import ApiError
from app.db.session import get_db
from app.models.asset import Account
from app.models.audit import AuditLog
from app.models.common import utc_now
from app.models.expense import Expense
from app.schemas.asset import AccountResponse
from app.schemas.expense import ExpenseCategory, ExpenseCreate, ExpenseFields, ExpenseResponse
from app.schemas.receipt import ReceiptCandidate
from app.services.fx import enabled_currency_codes
from app.services.receipt import MAX_IMAGE_BYTES, normalize_image, recognize_receipt

router = APIRouter()
DbDependency = Annotated[Session, Depends(get_db)]


@router.get("/receipt-recognition")
def receipt_status(auth: CurrentAuthDependency):
    settings = get_settings()
    return {"configured": bool(settings.openai_api_key.get_secret_value().strip())}


@router.post("/receipt-recognition", response_model=ReceiptCandidate)
async def receipt_recognition(
    request: Request,
    auth: CurrentAuthDependency,
    x_receipt_upload: Annotated[str | None, Header()] = None,
):
    # A non-simple header requires CORS preflight, preventing cross-site form uploads.
    if x_receipt_upload != "1":
        raise ApiError(400, "RECEIPT_UPLOAD_HEADER", "请从票据识别入口上传")
    settings = get_settings()
    if not settings.openai_api_key.get_secret_value().strip():
        raise ApiError(503, "RECEIPT_NOT_CONFIGURED", "收据识别尚未配置，请手工录入")
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type not in {"image/png", "image/jpeg"}:
        raise ApiError(415, "RECEIPT_IMAGE_TYPE", "仅支持 PNG、JPEG 图片")
    # Raw bounded streaming avoids multipart uploads spooling private images to disk.
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > MAX_IMAGE_BYTES:
            raise ApiError(413, "RECEIPT_IMAGE_SIZE", "图片须为 1 字节至 8 MB")
        raw.extend(chunk)
    image = await run_in_threadpool(normalize_image, bytes(raw), content_type)
    result = await recognize_receipt(image, settings, str(auth.user.id))
    return result


def _owned(db: Session, user_id: uuid.UUID, entity_id: uuid.UUID) -> Expense:
    item = db.scalar(
        select(Expense).where(
            Expense.id == entity_id, Expense.user_id == user_id, Expense.deleted_at.is_(None)
        )
    )
    if item is None:
        raise ApiError(404, "EXPENSE_NOT_FOUND", "开销记录不存在")
    return item


def _validate_links(
    db: Session, user_id: uuid.UUID, payload: ExpenseFields, previous: Expense | None = None
) -> None:
    if payload.currency_code not in enabled_currency_codes(db, user_id) and (
        previous is None or previous.currency_code != payload.currency_code
    ):
        raise ApiError(400, "CURRENCY_NOT_ENABLED", "请先在设置中启用该币种")
    if payload.account_id is not None and not db.scalar(
        select(Account.id).where(Account.id == payload.account_id, Account.user_id == user_id)
    ):
        raise ApiError(404, "ACCOUNT_NOT_FOUND", "关联账户不存在")


def _data(item: Expense) -> dict:
    return ExpenseResponse.model_validate(item).model_dump(mode="json", by_alias=False)


def _request_hash(payload: ExpenseCreate) -> str:
    values = payload.model_dump(mode="json", exclude={"request_key", "allow_duplicate"})
    values["amount"] = str(payload.amount.quantize(Decimal("0.000001")))
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()


def _replay(item: Expense, digest: str) -> Expense:
    if item.request_hash != digest:
        raise ApiError(409, "IDEMPOTENCY_CONFLICT", "该请求已用于不同内容，请重新开始录入")
    if item.deleted_at is not None:
        raise ApiError(409, "EXPENSE_ALREADY_DELETED", "该请求对应的开销已删除，请重新开始录入")
    return item


@router.get("/accounts", response_model=list[AccountResponse])
def expense_accounts(auth: CurrentAuthDependency, db: DbDependency):
    return list(
        db.scalars(select(Account).where(Account.user_id == auth.user.id).order_by(Account.name))
    )


@router.get("")
def list_expenses(
    auth: CurrentAuthDependency,
    db: DbDependency,
    start_date: Annotated[date | None, Query(alias="startDate")] = None,
    end_date: Annotated[date | None, Query(alias="endDate")] = None,
    currency: Annotated[str | None, Query(pattern=r"^[A-Z]{3}$")] = None,
    category: ExpenseCategory | None = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
):
    if start_date and end_date and start_date > end_date:
        raise ApiError(400, "INVALID_DATE_RANGE", "开始日期不能晚于结束日期")
    statement = select(Expense).where(Expense.user_id == auth.user.id, Expense.deleted_at.is_(None))
    if start_date:
        statement = statement.where(Expense.expense_date >= start_date)
    if end_date:
        statement = statement.where(Expense.expense_date <= end_date)
    if currency:
        statement = statement.where(Expense.currency_code == currency)
    if category:
        statement = statement.where(Expense.category == category)
    # Decimal aggregation also stays exact on the development SQLite backend.
    aggregates = db.execute(
        statement.with_only_columns(
            Expense.expense_date, Expense.currency_code, Expense.category, Expense.amount
        )
    )
    totals: dict[str, Decimal] = defaultdict(Decimal)
    days: dict[tuple, Decimal] = defaultdict(Decimal)
    categories: dict[tuple, Decimal] = defaultdict(Decimal)
    count = 0
    for day, code, cat, amount in aggregates:
        count += 1
        totals[code] += amount
        days[(day.isoformat(), code)] += amount
        categories[(cat, code)] += amount
    items = db.scalars(
        statement.order_by(
            Expense.expense_date.desc(), Expense.created_at.desc(), Expense.id.desc()
        )
        .offset(offset)
        .limit(limit)
    )
    return {
        "items": [_data(item) for item in items],
        "total": count,
        "totals": [
            {"currency": code, "amount": str(amount)} for code, amount in sorted(totals.items())
        ],
        "by_day": [
            {"date": day, "currency": code, "amount": str(amount)}
            for (day, code), amount in sorted(days.items(), reverse=True)
        ],
        "by_category": [
            {"category": cat, "currency": code, "amount": str(amount)}
            for (cat, code), amount in sorted(categories.items())
        ],
    }


@router.post("", response_model=ExpenseResponse, status_code=201, response_model_by_alias=False)
def create_expense(
    payload: ExpenseCreate, auth: CurrentAuthDependency, db: DbDependency, response: Response
):
    digest = _request_hash(payload)
    previous = db.scalar(
        select(Expense).where(
            Expense.user_id == auth.user.id, Expense.request_key == payload.request_key
        )
    )
    if previous:
        response.status_code = 200
        return _replay(previous, digest)
    _validate_links(db, auth.user.id, payload)
    duplicate = db.scalar(
        select(Expense.id)
        .where(
            Expense.user_id == auth.user.id,
            Expense.deleted_at.is_(None),
            Expense.expense_date == payload.expense_date,
            Expense.amount == payload.amount,
            Expense.currency_code == payload.currency_code,
            Expense.merchant == payload.merchant,
        )
        .limit(1)
    )
    if duplicate and not payload.allow_duplicate:
        # A same-key concurrent request may commit between the first lookup and
        # the duplicate query. Return its result rather than a false warning.
        winner = db.scalar(
            select(Expense).where(
                Expense.user_id == auth.user.id, Expense.request_key == payload.request_key
            )
        )
        if winner is not None:
            response.status_code = 200
            return _replay(winner, digest)
        raise ApiError(
            409, "POSSIBLE_DUPLICATE", "同日存在相同币种、金额和商户的记录，请核对后确认仍保存"
        )
    item = Expense(
        id=uuid.uuid4(),
        user_id=auth.user.id,
        request_hash=digest,
        **payload.model_dump(exclude={"allow_duplicate"}),
    )
    db.add(item)
    try:
        db.flush()
        db.add(
            AuditLog(
                user_id=auth.user.id,
                action="expense.create",
                entity_type="expense",
                entity_id=item.id,
                after_data=_data(item),
            )
        )
        db.commit()
    except IntegrityError:
        # The DB unique constraint arbitrates concurrent requests, including retries.
        db.rollback()
        winner = db.scalar(
            select(Expense).where(
                Expense.user_id == auth.user.id, Expense.request_key == payload.request_key
            )
        )
        if winner is None:
            raise
        response.status_code = 200
        return _replay(winner, digest)
    return item


@router.put("/{entity_id}", response_model=ExpenseResponse, response_model_by_alias=False)
def update_expense(
    entity_id: uuid.UUID, payload: ExpenseFields, auth: CurrentAuthDependency, db: DbDependency
):
    item = _owned(db, auth.user.id, entity_id)
    _validate_links(db, auth.user.id, payload, item)
    before = _data(item)
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    db.flush()
    db.add(
        AuditLog(
            user_id=auth.user.id,
            action="expense.update",
            entity_type="expense",
            entity_id=item.id,
            before_data=before,
            after_data=_data(item),
        )
    )
    db.commit()
    return item


@router.delete("/{entity_id}", status_code=204)
def delete_expense(entity_id: uuid.UUID, auth: CurrentAuthDependency, db: DbDependency):
    item = _owned(db, auth.user.id, entity_id)
    db.add(
        AuditLog(
            user_id=auth.user.id,
            action="expense.delete",
            entity_type="expense",
            entity_id=item.id,
            before_data=_data(item),
        )
    )
    item.deleted_at = utc_now()
    db.commit()
    return Response(status_code=204)
