"""One optimistic, idempotent draft per original receipt."""

import hashlib
import json
import uuid

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models.audit import AuditLog
from app.models.expense import Expense
from app.models.receipt import Receipt
from app.schemas.receipt_review import DraftRequest
from app.services.receipt_review import validate_review


def owned(db: Session, user_id: uuid.UUID, receipt_id: uuid.UUID, *, lock: bool = False) -> Receipt:
    query = select(Receipt).where(Receipt.id == receipt_id, Receipt.user_id == user_id)
    row = db.scalar(query.with_for_update() if lock else query)
    if row is None:
        raise ApiError(404, "RECEIPT_NOT_FOUND", "单据不存在")
    return row


def result(row: Receipt):
    return {
        "receiptId": str(row.id),
        "revision": row.draft_revision,
        "values": row.draft_values,
        "requestKey": row.draft_request_key,
        "saved": row.draft_revision > 0,
    }


def save(db: Session, user_id: uuid.UUID, payload: DraftRequest):
    row = owned(db, user_id, payload.receipt_id, lock=True)
    values = validate_review(db, user_id, payload.values).model_dump(by_alias=True)
    digest = hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()
    key = str(payload.request_key)

    def replay(current):
        if current.draft_request_hash != digest:
            raise ApiError(409, "DRAFT_KEY_CONFLICT", "该保存请求已用于不同内容")
        return result(current)

    if row.draft_request_key == key:
        return replay(row)
    if db.scalar(select(Expense.id).where(Expense.receipt_id == row.id)):
        raise ApiError(409, "RECEIPT_ALREADY_LINKED", "该单据已入账，不能覆盖草稿")
    changed = db.execute(
        update(Receipt)
        .where(
            Receipt.id == row.id,
            Receipt.user_id == user_id,
            Receipt.draft_revision == payload.expected_revision,
        )
        .values(
            draft_values=values,
            draft_revision=Receipt.draft_revision + 1,
            draft_request_key=key,
            draft_request_hash=digest,
        )
        .execution_options(synchronize_session=False)
    )
    if changed.rowcount != 1:
        db.rollback()
        current = owned(db, user_id, payload.receipt_id)
        if current.draft_request_key == key:
            return replay(current)
        raise ApiError(409, "DRAFT_VERSION_CONFLICT", "草稿已有更新，请刷新后继续编辑")
    db.add(
        AuditLog(
            user_id=user_id,
            action="receipt.draft_saved",
            entity_type="receipt",
            entity_id=row.id,
            after_data={"revision": payload.expected_revision + 1},
        )
    )
    db.commit()
    db.refresh(row)
    return result(row)
