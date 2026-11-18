"""Explicit confirmation of a frozen draft using the existing accounting writer."""

import uuid
from collections.abc import Callable

from fastapi import Response
from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.expenses import create_expense_for_user
from app.core.errors import ApiError
from app.models.expense import Expense
from app.models.receipt import Receipt
from app.models.receipt_device import ReceiptDevice
from app.schemas.expense import ExpenseCreate, ExpenseResponse
from app.schemas.receipt_review import ConfirmationRequest, ReviewFields
from app.services.receipt_draft import owned
from app.services.receipt_review import validate_review


def record_result(item: Expense, request_key: uuid.UUID, receipt_id: uuid.UUID):
    return {
        "status": "deleted" if item.deleted_at is not None else "recorded",
        "receiptId": str(receipt_id),
        "requestKey": str(request_key),
        "record": ExpenseResponse.model_validate(item).model_dump(mode="json", by_alias=False),
    }


def outcome(db: Session, user_id: uuid.UUID, request_key: uuid.UUID, receipt_id: uuid.UUID):
    owned(db, user_id, receipt_id)
    keyed = db.scalar(
        select(Expense).where(Expense.user_id == user_id, Expense.request_key == request_key)
    )
    if keyed is not None and keyed.receipt_id != receipt_id:
        raise ApiError(409, "IDEMPOTENCY_CONFLICT", "该请求已经用于其他单据")
    item = keyed or db.scalar(
        select(Expense).where(Expense.user_id == user_id, Expense.receipt_id == receipt_id)
    )
    if item is not None:
        return record_result(item, request_key, receipt_id)
    return {"status": "not_found", "receiptId": str(receipt_id), "requestKey": str(request_key)}


def confirm(
    db: Session,
    grant: ReceiptDevice,
    payload: ConfirmationRequest,
    response: Response,
    reauthorize: Callable[[], ReceiptDevice],
):
    if not payload.confirmed:
        raise ApiError(422, "CONFIRMATION_REQUIRED", "必须明确确认这一笔开销")
    if not grant.expense_write_enabled:
        raise ApiError(403, "EXPENSE_PERMISSION_REQUIRED", "请先在手机设备授权页允许此设备确认入账")
    row = owned(db, grant.user_id, payload.receipt_id, lock=True)
    existing = outcome(db, grant.user_id, payload.request_key, payload.receipt_id)
    if existing["status"] == "deleted":
        raise ApiError(409, "EXPENSE_ALREADY_DELETED", "此单据对应的开销已删除，不会重新入账")
    if existing["status"] == "recorded":
        return existing
    if row.draft_revision != payload.revision or row.draft_values is None:
        raise ApiError(409, "DRAFT_VERSION_CONFLICT", "草稿已改变，请重新核对后确认")
    # A guarded write also serializes SQLite, whose SELECT FOR UPDATE is a no-op.
    locked = db.execute(
        update(Receipt)
        .where(Receipt.id == row.id, Receipt.draft_revision == payload.revision)
        .values(draft_revision=Receipt.draft_revision)
        .execution_options(synchronize_session=False)
    )
    if locked.rowcount != 1:
        db.rollback()
        raise ApiError(409, "DRAFT_VERSION_CONFLICT", "草稿已改变，请重新核对后确认")
    db.expire_all()
    grant = reauthorize()
    if not grant.expense_write_enabled:
        raise ApiError(403, "EXPENSE_PERMISSION_REQUIRED", "入账权限已撤销")
    existing = outcome(db, grant.user_id, payload.request_key, payload.receipt_id)
    if existing["status"] == "recorded":
        return existing
    if existing["status"] == "deleted":
        raise ApiError(409, "EXPENSE_ALREADY_DELETED", "此单据的开销已删除")
    try:
        values = validate_review(db, grant.user_id, ReviewFields.model_validate(row.draft_values))
        if not values.account_id or not values.category:
            raise ValueError("missing account/category")
        expense = ExpenseCreate(
            amount=values.amount,
            expenseDate=values.expense_date,
            currencyCode=values.currency_code,
            category=values.category,
            merchant=values.merchant,
            note=values.note,
            accountId=values.account_id,
            receiptId=payload.receipt_id,
            requestKey=payload.request_key,
            source="receipt_ocr",
            allowDuplicate=payload.allow_duplicate,
        )
    except (ValidationError, ValueError):
        raise ApiError(
            422, "REVIEW_INCOMPLETE", "请补全有效金额、日期、币种、账户和分类后确认"
        ) from None
    response.status_code = 201
    try:
        item = create_expense_for_user(expense, grant.user_id, db, response)
    except ApiError as failure:
        if failure.code != "RECEIPT_ALREADY_LINKED":
            raise
        db.rollback()
        current = outcome(db, grant.user_id, payload.request_key, payload.receipt_id)
        if current["status"] != "recorded":
            raise
        response.status_code = 200
        return current
    return record_result(item, payload.request_key, payload.receipt_id)
