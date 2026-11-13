"""Synthetic-account HTTP integration; no real OCR or ledger writes."""

import io
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select
from test_expenses import bootstrap, payload

from app.core.errors import ApiError, api_error_handler
from app.db.session import get_engine, get_session_factory
from app.device.grants import DeviceBase, ReceiptDeviceGrant, ReceiptGrants
from app.device.router import create_receipt_device_router
from app.models.expense import Expense
from app.models.user import User
from app.schemas.receipt import ReceiptCandidate


@pytest.fixture
def rig(client):
    bootstrap(client)
    DeviceBase.metadata.create_all(get_engine())
    clock = [datetime(2026, 11, 13, tzinfo=UTC)]
    grants = ReceiptGrants("https://ledger.example", lambda: clock[0])
    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)
    app.include_router(create_receipt_device_router(grants), prefix="/device")
    with get_session_factory()() as db:
        user = db.scalar(select(User))
        owner = user.id
        grant = grants.approve(db, owner)
    with TestClient(app) as device:
        yield device, grants, grant, owner, clock
    DeviceBase.metadata.drop_all(get_engine())


def bearer(grant):
    return {"Authorization": "Bearer " + grant["token"]}


def confirm(rig):
    device, _, grant, _, _ = rig
    assert device.post("/device/confirm", headers=bearer(grant)).status_code == 200


def submit(rig, data=None):
    device, _, grant, _, _ = rig
    return device.post(
        "/device/expenses", headers=bearer(grant), json=data or payload(source="receipt_ocr")
    )


def test_confirm_create_same_key_replay_and_conflict(rig):
    assert submit(rig).status_code == 401
    confirm(rig)
    data = payload(source="receipt_ocr")
    first = submit(rig, data)
    assert first.status_code == 201
    assert first.headers["cache-control"] == "no-store"
    repeated = submit(rig, data)
    assert repeated.status_code == 200
    assert repeated.json()["id"] == first.json()["id"]
    assert submit(rig, {**data, "amount": "12"}).json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    with get_session_factory()() as db:
        assert len(db.scalars(select(Expense)).all()) == 1


def test_duplicate_requires_explicit_same_key_confirmation(rig):
    confirm(rig)
    assert submit(rig).status_code == 201
    data = payload(source="receipt_ocr")
    assert submit(rig, data).json()["error"]["code"] == "POSSIBLE_DUPLICATE"
    assert submit(rig, {**data, "allowDuplicate": True}).status_code == 201


def test_no_cookie_query_issuance_or_other_privileges(rig, client):
    device, _, grant, _, _ = rig
    confirm(rig)
    assert device.post("/device/confirm?token=" + grant["token"]).status_code == 401
    assert (
        device.post(
            "/device/expenses", cookies=client.cookies, json=payload(source="receipt_ocr")
        ).status_code
        == 401
    )
    for path in ["/approve", "/renew", "/users", "/accounts", "/expenses"]:
        assert device.get("/device" + path, headers=bearer(grant)).status_code in {404, 405}
    assert (
        device.delete("/device/expenses/" + str(uuid.uuid4()), headers=bearer(grant)).status_code
        == 404
    )
    assert device.post("/device/approve", headers=bearer(grant)).status_code == 404
    # The actual application does not mount the capability router.
    assert client.post("/api/v1/device/confirm", headers=bearer(grant)).status_code == 404
    client.cookies.clear()
    assert client.get("/api/v1/expenses", headers=bearer(grant)).status_code == 401


def test_expiry_confirmation_retry_and_restart(rig):
    device, grants, grant, _, clock = rig
    with get_session_factory()() as db:
        restarted = ReceiptGrants(grants.resource, lambda: clock[0])
        first = restarted.confirm(db, grant["token"])
        clock[0] += timedelta(minutes=6)
        assert restarted.confirm(db, grant["token"]) == first
        assert restarted.authenticate(db, grant["token"]).user
    clock[0] += timedelta(minutes=9)
    assert submit(rig).status_code == 401
    assert device.post("/device/confirm", headers=bearer(grant)).status_code == 401


def test_unconfirmed_deadline_is_exact(rig):
    device, _, grant, _, clock = rig
    clock[0] += timedelta(minutes=5)
    assert device.post("/device/confirm", headers=bearer(grant)).status_code == 401
    assert submit(rig).status_code == 401


def test_revocation_password_change_and_resource_isolation(rig):
    _, grants, grant, owner, clock = rig
    confirm(rig)
    with get_session_factory()() as db:
        with pytest.raises(ApiError):
            ReceiptGrants("https://other.example", lambda: clock[0]).authenticate(
                db, grant["token"]
            )
        with pytest.raises(ApiError):
            grants.revoke(db, uuid.uuid4(), uuid.UUID(grant["deviceId"]))
        assert grants.authenticate(db, grant["token"]).user.id == owner
        row = db.get(ReceiptDeviceGrant, uuid.UUID(grant["deviceId"]))
        assert grant["token"] not in str(row.__dict__)
        grants.revoke(db, owner, row.id)
    assert submit(rig).status_code == 401
    with get_session_factory()() as db:
        newer = grants.approve(db, owner)
        grants.confirm(db, newer["token"])
        user = db.get(User, owner)
        user.password_hash = "new-synthetic-password-hash"
        db.commit()
        with pytest.raises(ApiError):
            grants.authenticate(db, newer["token"])


def test_owner_scope_body_limits_and_redacted_validation(rig):
    device, _, grant, _, _ = rig
    confirm(rig)
    assert (
        submit(rig, payload(source="receipt_ocr", accountId=str(uuid.uuid4()))).status_code == 404
    )
    assert submit(rig, payload(source="manual")).status_code == 422
    bad = submit(
        rig,
        {
            **payload(source="receipt_ocr"),
            "userId": str(uuid.uuid4()),
            "note": "private receipt text",
        },
    )
    assert bad.status_code == 422 and "private receipt text" not in bad.text
    assert (
        device.post(
            "/device/expenses",
            headers={**bearer(grant), "Content-Type": "application/json"},
            content=b" " * 16385,
        ).status_code
        == 413
    )
    assert device.post("/device/expenses", headers=bearer(grant), content=b"{}").status_code == 415


def test_scoped_ocr_reuses_normalization_without_real_provider(rig, monkeypatch):
    from pydantic import SecretStr

    from app.api import expenses

    device, _, grant, owner, _ = rig
    confirm(rig)
    monkeypatch.setattr(
        expenses.get_settings(), "openai_api_key", SecretStr("synthetic-never-sent")
    )
    seen = []

    async def fake_recognize(image, settings, user_id):
        seen.append((image, user_id))
        return ReceiptCandidate(
            amount="12",
            expenseDate="2026-11-13",
            currencyCode="JPY",
            merchant="Synthetic",
            warnings=[],
        )

    monkeypatch.setattr(expenses, "recognize_receipt", fake_recognize)
    photo = io.BytesIO()
    Image.new("RGB", (32, 32), "white").save(photo, "PNG")
    headers = {**bearer(grant), "Content-Type": "image/png", "X-Receipt-Upload": "1"}
    result = device.post("/device/receipt-recognition", headers=headers, content=photo.getvalue())
    assert result.status_code == 200 and result.json()["currencyCode"] == "JPY"
    assert len(seen) == 1 and seen[0][1] == str(owner)
    assert (
        device.post(
            "/device/receipt-recognition", headers=headers, content=b"not an image"
        ).status_code
        == 422
    )
    assert (
        device.post(
            "/device/receipt-recognition",
            headers={**bearer(grant), "Content-Type": "image/png"},
            content=photo.getvalue(),
        ).status_code
        == 400
    )
    assert len(seen) == 1


@pytest.mark.parametrize(
    "resource",
    [
        "http://ledger.example",
        "https://u:p@ledger.example",
        "https://ledger.example/path",
        "https://ledger.example?x=1",
    ],
)
def test_invalid_resource(resource):
    with pytest.raises(ValueError):
        ReceiptGrants(resource)


def test_cross_account_links_are_rejected(rig):
    from app.models.asset import Account

    confirm(rig)
    with get_session_factory()() as db:
        other = User(
            id=uuid.uuid4(),
            email="other@example.com",
            display_name="Other",
            password_hash="synthetic",
        )
        db.add(other)
        db.flush()
        account = Account(
            id=uuid.uuid4(), user_id=other.id, name="Other account", account_type="savings"
        )
        db.add(account)
        db.commit()
        other_id, account_id = other.id, account.id
    result = submit(rig, payload(source="receipt_ocr", accountId=str(account_id)))
    assert result.status_code == 404
    assert "Other account" not in result.text
    assert (
        submit(rig, {**payload(source="receipt_ocr"), "userId": str(other_id)}).status_code == 422
    )


def test_revocation_during_body_read_blocks_write(rig):
    import asyncio
    import json

    from fastapi import Request, Response

    _, grants, grant, owner, _ = rig
    confirm(rig)
    endpoint = next(
        r.endpoint for r in create_receipt_device_router(grants).routes if r.path == "/expenses"
    )
    with get_session_factory()() as db:

        async def receive():
            grants.revoke(db, owner, uuid.UUID(grant["deviceId"]))
            return {
                "type": "http.request",
                "body": json.dumps(payload(source="receipt_ocr")).encode(),
                "more_body": False,
            }

        request = Request(
            {
                "type": "http",
                "headers": [
                    (b"authorization", ("Bearer " + grant["token"]).encode()),
                    (b"content-type", b"application/json"),
                ],
                "method": "POST",
                "path": "/expenses",
            },
            receive,
        )
        with pytest.raises(ApiError, match="设备授权无效"):
            asyncio.run(endpoint(request, Response(), db))
        assert db.scalars(select(Expense)).all() == []


def test_revocation_during_image_processing_blocks_provider(rig, monkeypatch):
    from pydantic import SecretStr

    from app.api import expenses

    device, grants, grant, owner, _ = rig
    confirm(rig)
    monkeypatch.setattr(expenses.get_settings(), "openai_api_key", SecretStr("never-sent"))

    def normalize(raw, mime):
        with get_session_factory()() as db:
            grants.revoke(db, owner, uuid.UUID(grant["deviceId"]))
        return b"synthetic-normalized"

    async def forbidden(*args):
        raise AssertionError("Revoked request must not reach provider")

    monkeypatch.setattr(expenses, "normalize_image", normalize)
    monkeypatch.setattr(expenses, "recognize_receipt", forbidden)
    result = device.post(
        "/device/receipt-recognition",
        headers={**bearer(grant), "Content-Type": "image/png", "X-Receipt-Upload": "1"},
        content=b"photo",
    )
    assert result.status_code == 401
    assert result.headers["cache-control"] == "no-store"
    assert grant["token"] not in result.text
