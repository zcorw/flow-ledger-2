"""Private original-byte storage, accounting links and coherent backup tests."""

import base64
import hashlib
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import SESSION_COOKIE_NAME
from app.db.session import get_session_factory
from app.main import app
from app.models.expense import Expense
from app.models.receipt import Receipt
from app.models.user import User
from app.services.auth import create_session
from app.services.backup import (
    build_backup_payload,
    restore_backup_payload,
    validate_backup_payload,
)
from tests.test_expenses import bootstrap
from tests.test_receipt import provider, synthetic_image  # noqa: F401

URL = "/api/v1/expenses/receipt-recognition"
pytestmark = pytest.mark.usefixtures("provider")


def upload(client, raw, mime="image/png"):
    return client.post(URL, headers={"Content-Type": mime, "X-Receipt-Upload": "1"}, content=raw)


@pytest.mark.parametrize(
    ("fmt", "mime"), [("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")]
)
def test_original_survives_recognition_byte_for_byte_and_is_private(client, fmt, mime):
    bootstrap(client)
    raw = synthetic_image(fmt)
    response = upload(client, raw, mime)
    assert response.status_code == 200
    assert set(response.json()) == {"amount", "expenseDate", "currencyCode", "merchant", "warnings"}
    receipt_id = str(uuid.UUID(response.headers["X-Receipt-Id"]))
    metadata = client.get("/api/v1/receipts/" + receipt_id).json()
    assert metadata["status"] == "recognized"
    assert metadata["sha256"] == hashlib.sha256(raw).hexdigest()
    assert metadata["expenseId"] is None
    image = client.get(f"/api/v1/receipts/{receipt_id}/image")
    assert image.content == raw
    assert image.headers["content-type"] == mime
    assert image.headers["cache-control"] == "private, no-store"
    with TestClient(app) as anonymous:
        assert anonymous.get(f"/api/v1/receipts/{receipt_id}/image").status_code == 401
        assert anonymous.get("/api/v1/receipts").status_code == 401
    assert client.get("/api/v1/expenses").json()["total"] == 0
    assert "original_image" not in client.get("/api/v1/receipts").text


def test_expense_link_replay_and_backups_keep_the_original(client):
    bootstrap(client)
    raw = synthetic_image()
    receipt_id = upload(client, raw).headers["X-Receipt-Id"]
    payload = {
        "expenseDate": "2026-11-01",
        "amount": "1234",
        "currencyCode": "JPY",
        "merchant": "合成商户",
        "requestKey": str(uuid.uuid4()),
        "source": "receipt_ocr",
        "receiptId": receipt_id,
    }
    created = client.post("/api/v1/expenses", json=payload)
    assert created.status_code == 201
    expense_id = created.json()["id"]
    assert created.json()["receipt_id"] == receipt_id
    assert client.post("/api/v1/expenses", json=payload).json()["id"] == expense_id
    assert (
        client.post(
            "/api/v1/expenses", json={**payload, "requestKey": str(uuid.uuid4())}
        ).status_code
        == 409
    )
    assert client.get("/api/v1/receipts/" + receipt_id).json()["expenseId"] == expense_id
    # Old clients omit receiptId when editing: the existing relation survives.
    fields = {key: payload[key] for key in ("expenseDate", "amount", "currencyCode", "merchant")}
    assert (
        client.put("/api/v1/expenses/" + expense_id, json=fields).json()["receipt_id"] == receipt_id
    )
    with get_session_factory()() as db:
        user_id = db.scalar(select(User.id))
        backup = build_backup_payload(db, user_id)
        assert backup["version"] == 3
        assert base64.b64decode(backup["tables"]["receipts"][0]["original_image"]) == raw
        validate_backup_payload(backup)
        db.get(Receipt, uuid.UUID(receipt_id)).original_image = b"changed"
        db.flush()
        restore_backup_payload(db, user_id, backup)
        db.commit()
        assert db.get(Receipt, uuid.UUID(receipt_id)).original_image == raw
        assert db.get(Expense, uuid.UUID(expense_id)).receipt_id == uuid.UUID(receipt_id)
        backup["tables"]["receipts"][0]["sha256"] = "0" * 64
        with pytest.raises(ValueError, match="校验"):
            validate_backup_payload(backup)


def test_failed_recognition_keeps_original_but_invalid_images_do_not_create_records(
    client, request
):
    bootstrap(client)
    assert upload(client, b"not an image").status_code == 422
    assert client.get("/api/v1/receipts").json()["total"] == 0
    request.getfixturevalue("provider")["status"] = 502
    raw = synthetic_image()
    response = upload(client, raw)
    assert response.status_code == 502
    receipt_id = response.json()["error"]["details"][-1]["receiptId"]
    assert client.get(f"/api/v1/receipts/{receipt_id}/image").content == raw
    assert client.get("/api/v1/receipts").json()["items"][0]["status"] == "failed"
    assert client.get("/api/v1/expenses").json()["total"] == 0


def test_other_signed_in_owner_cannot_read_or_link_private_original(client, monkeypatch):
    bootstrap(client)
    receipt_id = upload(client, synthetic_image()).headers["X-Receipt-Id"]
    with get_session_factory()() as db:
        original = db.scalar(select(User))
        other = User(
            id=uuid.uuid4(),
            email="another@example.com",
            display_name="Another owner",
            password_hash=original.password_hash,
        )
        db.add(other)
        token = create_session(db, other)
        db.commit()
    monkeypatch.setattr("app.api.expenses.enabled_currency_codes", lambda db, user: {"JPY"})
    with TestClient(app) as other_client:
        other_client.cookies.set(SESSION_COOKIE_NAME, token)
        assert other_client.get(f"/api/v1/receipts/{receipt_id}").status_code == 404
        assert other_client.get(f"/api/v1/receipts/{receipt_id}/image").status_code == 404
        assert other_client.get("/api/v1/receipts").json()["total"] == 0
        response = other_client.post(
            "/api/v1/expenses",
            json={
                "expenseDate": "2026-11-17",
                "amount": "42",
                "currencyCode": "JPY",
                "receiptId": receipt_id,
                "requestKey": str(uuid.uuid4()),
            },
        )
        assert response.status_code == 404


def test_failed_original_commit_never_calls_paid_provider(client, monkeypatch, request):
    bootstrap(client)
    original_commit = Session.commit

    def reject_original(db):
        if any(isinstance(item, Receipt) for item in db.new):
            raise SQLAlchemyError("private-image-data-must-not-leak")
        return original_commit(db)

    monkeypatch.setattr(Session, "commit", reject_original)
    response = upload(client, synthetic_image())
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "RECEIPT_ARCHIVE_FAILED"
    assert "private-image-data" not in response.text
    assert request.getfixturevalue("provider")["calls"] == []
    assert client.get("/api/v1/receipts").json()["total"] == 0


def test_archive_rate_limit_rejects_before_persisting_another_image(client, monkeypatch):
    bootstrap(client)
    monkeypatch.setattr(get_settings(), "receipt_requests_per_minute", 1)
    assert upload(client, synthetic_image()).status_code == 200
    assert upload(client, synthetic_image()).status_code == 429
    assert client.get("/api/v1/receipts").json()["total"] == 1
