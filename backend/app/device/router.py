"""Unmounted least-privilege router reusing the existing receipt/expense behavior."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from fastapi.routing import APIRoute
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.api.expenses import create_expense, recognize_receipt_request
from app.core.errors import ApiError, api_error_handler
from app.db.session import get_db
from app.device.grants import ReceiptGrants
from app.schemas.expense import ExpenseCreate, ExpenseResponse
from app.schemas.receipt import ReceiptCandidate

Db = Annotated[Session, Depends(get_db)]


def token_from(request: Request) -> str:
    # Never accept cookies, query strings or account passwords as device credentials.
    value = request.headers.get("authorization", "")
    if not value.startswith("Bearer ") or len(value) != 50:
        raise ApiError(401, "DEVICE_UNAUTHORIZED", "设备授权无效")
    return value[7:]


class PrivateRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request):
            try:
                response = await original(request)
            except ApiError as exc:
                response = await api_error_handler(request, exc)
            response.headers["Cache-Control"] = "no-store"
            return response

        return handler


def create_receipt_device_router(grants: ReceiptGrants) -> APIRouter:
    router = APIRouter(route_class=PrivateRoute)

    @router.post("/confirm")
    def confirm(request: Request, response: Response, db: Db):
        response.headers["Cache-Control"] = "no-store"
        return grants.confirm(db, token_from(request))

    @router.post("/receipt-recognition", response_model=ReceiptCandidate)
    async def recognize(request: Request, response: Response, db: Db):
        actor = grants.authenticate(db, token_from(request))
        response.headers["Cache-Control"] = "no-store"

        # Existing bounded in-memory raw upload, image normalization and provider policy.
        def reauthorize():
            db.expire_all()
            grants.authenticate(db, token_from(request))

        return await recognize_receipt_request(
            request,
            str(actor.user.id),
            request.headers.get("x-receipt-upload"),
            reauthorize,
        )

    @router.post(
        "/expenses", response_model=ExpenseResponse, status_code=201, response_model_by_alias=False
    )
    async def submit(request: Request, response: Response, db: Db):
        actor = grants.authenticate(db, token_from(request))
        response.headers["Cache-Control"] = "no-store"
        if request.headers.get("content-type", "").split(";", 1)[0] != "application/json":
            raise ApiError(415, "DEVICE_CONTENT_TYPE", "请提交 JSON")
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > 16_384:
                raise ApiError(413, "DEVICE_BODY_LIMIT", "请求过大")
            body.extend(chunk)
        try:
            payload = ExpenseCreate.model_validate_json(bytes(body))
        except ValidationError:
            # Do not echo receipt fields, raw JSON or credential values.
            raise ApiError(422, "INVALID_EXPENSE", "记录字段无效") from None
        if payload.source != "receipt_ocr":
            raise ApiError(422, "DEVICE_SOURCE", "仅允许确认后的收据记录")
        # Account ownership, enabled currency, duplicates, audit and same-key replay
        # remain authoritative in the shared implementation, not reimplemented here.
        db.expire_all()
        actor = grants.authenticate(db, token_from(request))
        return create_expense(payload, actor, db, response)

    return router
