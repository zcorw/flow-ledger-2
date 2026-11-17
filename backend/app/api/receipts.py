import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.dependencies import CurrentAuthDependency
from app.core.errors import ApiError
from app.db.session import get_db
from app.models.expense import Expense
from app.models.receipt import Receipt
from app.schemas.receipt_review import DraftRequest
from app.services import receipt_draft

router = APIRouter()
Db = Annotated[Session, Depends(get_db)]


def owned_receipt(db: Session, user_id: uuid.UUID, receipt_id: uuid.UUID) -> Receipt:
    item = db.scalar(select(Receipt).where(Receipt.id == receipt_id, Receipt.user_id == user_id))
    if item is None:
        raise ApiError(404, "RECEIPT_NOT_FOUND", "单据不存在")
    return item


def metadata(item: Receipt, expense_id: uuid.UUID | None = None):
    return {
        "id": str(item.id),
        "createdAt": item.created_at.isoformat(),
        "status": item.status,
        "mimeType": item.mime_type,
        "byteLength": item.byte_length,
        "sha256": item.sha256,
        "expenseId": str(expense_id) if expense_id else None,
        "amount": item.amount,
        "expenseDate": item.expense_date,
        "currencyCode": item.currency_code,
        "merchant": item.merchant,
        "warnings": item.warnings,
        "failureCode": item.failure_code,
        "draftValues": item.draft_values,
        "draftRevision": item.draft_revision,
    }


@router.get("")
def list_receipts(
    auth: CurrentAuthDependency,
    db: Db,
    response: Response,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=50)] = 25,
    drafts: bool = False,
    q: Annotated[str, Query(max_length=150)] = "",
):
    response.headers["Cache-Control"] = "no-store"
    query = select(Receipt).where(Receipt.user_id == auth.user.id)
    if drafts:
        query = query.where(
            Receipt.draft_revision > 0,
            ~select(Expense.id).where(Expense.receipt_id == Receipt.id).exists(),
        )
    if q:
        query = query.where(
            or_(
                Receipt.merchant.icontains(q, autoescape=True),
                Receipt.draft_values["merchant"].as_string().icontains(q, autoescape=True),
            )
        )
    rows = db.scalars(
        query.order_by(Receipt.created_at.desc(), Receipt.id.desc()).offset(offset).limit(limit)
    ).all()
    links = dict(
        db.execute(
            select(Expense.receipt_id, Expense.id).where(
                Expense.user_id == auth.user.id,
                Expense.receipt_id.in_([row.id for row in rows]),
            )
        ).all()
    )
    return {
        "items": [metadata(row, links.get(row.id)) for row in rows],
        "total": db.scalar(select(func.count()).select_from(query.subquery())),
    }


@router.get("/{receipt_id}")
def get_receipt(receipt_id: uuid.UUID, auth: CurrentAuthDependency, db: Db, response: Response):
    response.headers["Cache-Control"] = "no-store"
    item = owned_receipt(db, auth.user.id, receipt_id)
    linked = db.scalar(
        select(Expense.id).where(
            Expense.user_id == auth.user.id,
            Expense.receipt_id == receipt_id,
        )
    )
    return metadata(item, linked)


@router.get("/{receipt_id}/image")
def original_image(receipt_id: uuid.UUID, auth: CurrentAuthDependency, db: Db):
    item = owned_receipt(db, auth.user.id, receipt_id)
    extension = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[item.mime_type]
    return Response(
        content=item.original_image,
        media_type=item.mime_type,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": f'inline; filename="receipt-{item.id}.{extension}"',
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


@router.post("/drafts")
def save_draft(payload: DraftRequest, auth: CurrentAuthDependency, db: Db, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return receipt_draft.save(db, auth.user.id, payload)
