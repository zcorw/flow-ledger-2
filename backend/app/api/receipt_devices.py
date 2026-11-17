"""Phone-approved receipt-only device API. Tokens never become web sessions."""

import json
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import ValidationError
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.dependencies import CurrentAuthDependency
from app.api.expenses import recognize_receipt_request
from app.core.config import get_settings
from app.core.errors import ApiError, api_error_handler
from app.db.session import get_db
from app.models.audit import AuditLog
from app.models.receipt_device import ReceiptDevice
from app.schemas.receipt import ReceiptCandidate
from app.schemas.receipt_review import CorrectionRequest
from app.services import receipt_device as devices
from app.services import receipt_review

Db = Annotated[Session, Depends(get_db)]


class PrivateRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request):
            try:
                response = await original(request)
            except ApiError as exc:
                response = await api_error_handler(request, exc)
            except RequestValidationError:
                response = await api_error_handler(
                    request, ApiError(422, "DEVICE_BODY_INVALID", "请求字段无效")
                )
            response.headers["Cache-Control"] = "no-store"
            return response

        return handler


router = APIRouter(route_class=PrivateRoute)


async def read_json(request: Request, allowed: set[str], max_bytes: int = 4096) -> dict:
    if request.headers.get("content-type", "").split(";", 1)[0] != "application/json":
        raise ApiError(415, "DEVICE_CONTENT_TYPE", "请提交 JSON")
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > max_bytes:
            raise ApiError(413, "DEVICE_BODY_LIMIT", "请求过大")
        raw.extend(chunk)
    try:
        body = json.loads(raw)
        if not isinstance(body, dict) or set(body) - allowed:
            raise ValueError("shape")
    except (ValueError, UnicodeDecodeError):
        raise ApiError(422, "DEVICE_BODY_INVALID", "请求字段无效") from None
    return body


def owner_intent(request: Request) -> None:
    if request.headers.get("x-device-approval") != "1":
        raise ApiError(400, "DEVICE_APPROVAL_HEADER", "请从设备授权页面操作")
    origin = request.headers.get("origin")
    if origin and origin != devices.public_origin():
        raise ApiError(403, "DEVICE_APPROVAL_ORIGIN", "授权来源无效")


@router.post("/pairings", status_code=201)
async def pair(request: Request, db: Db):
    body = await read_json(request, {"deviceName"})
    name = body.get("deviceName", "Rokid")
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 64:
        raise ApiError(422, "DEVICE_BODY_INVALID", "设备名称无效")
    return devices.start_pairing(db, name.strip(), request.client.host if request.client else "")


@router.post("/pairings/token")
async def token(request: Request, response: Response, db: Db):
    body = await read_json(request, {"deviceCode"})
    code = body.get("deviceCode")
    if not isinstance(code, str):
        raise ApiError(401, "DEVICE_CODE_INVALID", "设备授权无效")
    result = devices.exchange_pairing(db, code)
    if result.get("status") == "authorization_pending":
        response.status_code = 202
    return result


@router.post("/review-correction")
async def review_correction(request: Request, db: Db):
    authorization = request.headers.get("authorization", "")
    grant = devices.authenticate_device(db, authorization)
    body = await read_json(request, {"transcript", "values"}, 16384)
    try:
        payload = CorrectionRequest.model_validate(body)
    except ValidationError:
        raise ApiError(422, "REVIEW_FIELDS_INVALID", "语音或账单字段无效") from None
    result = await receipt_review.correct(db, grant.user_id, payload, get_settings())
    db.expire_all()
    devices.authenticate_device(db, authorization)
    return result


async def read_user_code(request: Request) -> str:
    body = await read_json(request, {"userCode"})
    if not isinstance(body.get("userCode"), str):
        raise ApiError(422, "DEVICE_BODY_INVALID", "授权码无效")
    return body["userCode"]


@router.post("/pairings/lookup")
async def pairing_status(request: Request, auth: CurrentAuthDependency, db: Db):
    code = await read_user_code(request)
    row = devices.owner_pairing(db, code, auth.user.id)
    return {
        "deviceName": row.device_name,
        "status": row.status,
        "expiresAt": devices.as_utc(row.expires_at).isoformat(),
        "scope": devices.SCOPE,
    }


@router.post("/pairings/approve")
async def approve(request: Request, auth: CurrentAuthDependency, db: Db):
    owner_intent(request)
    code = await read_user_code(request)
    return devices.decide_pairing(db, code, auth.user, True)


@router.post("/pairings/deny")
async def deny(request: Request, auth: CurrentAuthDependency, db: Db):
    owner_intent(request)
    code = await read_user_code(request)
    return devices.decide_pairing(db, code, auth.user, False)


@router.get("")
def list_devices(auth: CurrentAuthDependency, db: Db):
    rows = db.scalars(
        select(ReceiptDevice)
        .where(
            ReceiptDevice.user_id == auth.user.id,
            or_(ReceiptDevice.expires_at.is_(None), ReceiptDevice.expires_at > devices.now()),
            ReceiptDevice.revoked_at.is_(None),
            ReceiptDevice.password_fingerprint == devices.digest(auth.user.password_hash),
        )
        .order_by(ReceiptDevice.created_at.desc())
        .limit(50)
    ).all()
    return [
        {
            "id": str(row.id),
            "deviceName": row.device_name,
            "scope": devices.SCOPE,
            "expiresAt": devices.as_utc(row.expires_at).isoformat() if row.expires_at else None,
        }
        for row in rows
    ]


@router.delete("/{device_id}", status_code=204)
def revoke(device_id: uuid.UUID, request: Request, auth: CurrentAuthDependency, db: Db):
    owner_intent(request)
    row = db.scalar(
        select(ReceiptDevice).where(
            ReceiptDevice.id == device_id, ReceiptDevice.user_id == auth.user.id
        )
    )
    if row is None:
        raise ApiError(404, "DEVICE_NOT_FOUND", "设备不存在")
    if row.revoked_at is None:
        row.revoked_at = devices.now()
        db.add(
            AuditLog(
                user_id=auth.user.id,
                action="receipt_device.revoked",
                entity_type="receipt_device",
                entity_id=row.id,
            )
        )
        db.commit()


@router.post("/receipt-recognition", response_model=ReceiptCandidate)
async def recognize(request: Request, response: Response, db: Db):
    authorization = request.headers.get("authorization", "")
    grant = devices.authenticate_device(db, authorization)
    user_id = str(grant.user_id)

    def reauthorize():
        db.expire_all()
        devices.authenticate_device(db, authorization)

    result = await recognize_receipt_request(
        request,
        user_id,
        request.headers.get("x-receipt-upload"),
        reauthorize,
        db=db,
        response=response,
    )
    reauthorize()
    grant.last_used_at = devices.now()
    db.commit()
    return result
