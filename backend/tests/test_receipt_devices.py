"""Real pairing/router/database contracts with synthetic photos and fake OCR."""

import io
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import SecretStr
from sqlalchemy import select

from app.api import expenses
from app.core.config import get_settings
from app.core.security import SESSION_COOKIE_NAME
from app.db.session import get_session_factory
from app.main import app
from app.models.receipt_device import ReceiptDevice, ReceiptPairing
from app.models.user import User
from app.schemas.receipt import ReceiptCandidate
from app.services import receipt_device as devices
from app.services.auth import create_session
from tests.test_expenses import bootstrap

BASE = "/api/v1/receipt-devices"
INTENT = {"X-Device-Approval": "1"}


@pytest.fixture
def rig(client, monkeypatch):
    bootstrap(client)
    clock = [datetime(2026, 11, 16, tzinfo=UTC)]
    monkeypatch.setattr(devices, "now", lambda: clock[0])
    monkeypatch.setattr(get_settings(), "app_base_url", "https://ledger.example")
    monkeypatch.setattr(get_settings(), "openai_api_key", SecretStr("synthetic-never-sent"))
    calls = []

    async def recognize(image, settings, owner):
        calls.append((image, owner))
        return ReceiptCandidate(
            amount="88.50",
            expenseDate="2026-11-15",
            currencyCode="CNY",
            merchant="合成商户",
            warnings=[],
        )

    monkeypatch.setattr(expenses, "recognize_receipt", recognize)
    with TestClient(app) as device:
        yield client, device, clock, calls


def pair(rig):
    _, device, _, _ = rig
    response = device.post(BASE + "/pairings", json={"deviceName": "Rokid"})
    assert response.status_code == 201
    assert response.headers["cache-control"] == "no-store"
    return response.json()


def grant(rig):
    owner, device, _, _ = rig
    pairing = pair(rig)
    assert (
        owner.post(
            BASE + "/pairings/approve", json={"userCode": pairing["userCode"]}, headers=INTENT
        ).status_code
        == 200
    )
    response = device.post(BASE + "/pairings/token", json={"deviceCode": pairing["deviceCode"]})
    assert response.status_code == 200
    return response.json()


def upload(device, token, image=None):
    if image is None:
        encoded = io.BytesIO()
        Image.new("RGB", (40, 80), "white").save(encoded, "PNG")
        image = encoded.getvalue()
    return device.post(
        BASE + "/receipt-recognition",
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "image/png",
            "X-Receipt-Upload": "1",
        },
        content=image,
    )


def test_explicit_phone_approval_then_real_receipt_handler(rig):
    owner, device, _, calls = rig
    pairing = pair(rig)
    assert pairing["verificationUri"] == "https://ledger.example/receipt-devices"
    assert (
        device.post(
            BASE + "/pairings/token", json={"deviceCode": pairing["deviceCode"]}
        ).status_code
        == 202
    )
    status = owner.post(BASE + "/pairings/lookup", json={"userCode": pairing["userCode"]})
    assert status.json()["status"] == "pending"
    assert "deviceCode" not in status.text and pairing["deviceCode"] not in status.text
    assert (
        owner.post(
            BASE + "/pairings/approve", json={"userCode": pairing["userCode"]}, headers=INTENT
        ).json()["status"]
        == "approved"
    )
    response = device.post(BASE + "/pairings/token", json={"deviceCode": pairing["deviceCode"]})
    token = response.json()["accessToken"]
    assert response.json()["scope"] == "receipt:recognize"
    assert response.json()["expiresAt"] is None
    result = upload(device, token)
    assert result.status_code == 200 and result.json()["amount"] == "88.50"
    assert result.headers["cache-control"] == "no-store"
    assert len(calls) == 1 and calls[0][0].startswith(b"\xff\xd8")
    assert (
        device.post(
            BASE + "/pairings/token", json={"deviceCode": pairing["deviceCode"]}
        ).status_code
        == 409
    )
    with get_session_factory()() as db:
        row = db.scalar(select(ReceiptDevice))
        assert token not in str(row.__dict__)
        pairing_row = db.scalar(select(ReceiptPairing))
        assert pairing["deviceCode"] not in str(pairing_row.__dict__)
    assert token not in owner.get(BASE).text


def test_owner_approval_requires_session_custom_header_and_matching_origin(rig):
    owner, device, _, _ = rig
    pairing = pair(rig)
    path = BASE + "/pairings/approve"
    payload = {"userCode": pairing["userCode"]}
    assert device.post(path, json=payload, headers=INTENT).status_code == 401
    assert owner.post(path, json=payload).status_code == 400
    assert (
        owner.post(
            path, json=payload, headers={**INTENT, "Origin": "https://evil.example"}
        ).status_code
        == 403
    )
    assert (
        owner.post(BASE + "/pairings/lookup", json={"userCode": pairing["userCode"]}).json()[
            "status"
        ]
        == "pending"
    )
    assert (
        owner.post(
            path, json=payload, headers={**INTENT, "Origin": "https://ledger.example"}
        ).status_code
        == 200
    )
    assert owner.post(path, json=payload, headers=INTENT).status_code == 200


def test_receipt_token_has_no_web_or_expense_privileges_and_cookies_are_not_device_credentials(rig):
    owner, device, _, calls = rig
    token = grant(rig)["accessToken"]
    assert upload(owner, "").status_code == 401
    assert (
        device.get("/api/v1/expenses", headers={"Authorization": "Bearer " + token}).status_code
        == 401
    )
    assert (
        device.post(
            "/api/v1/expenses", headers={"Authorization": "Bearer " + token}, json={}
        ).status_code
        == 401
    )
    assert device.get(BASE).status_code == 401
    assert (
        device.post(BASE + "/receipt-recognition?token=" + token, content=b"not sent").status_code
        == 401
    )
    assert calls == []


def test_device_revocation_and_legacy_expiry_block_recognition(rig):
    owner, device, clock, calls = rig
    first = grant(rig)
    assert owner.delete(BASE + "/" + first["deviceId"]).status_code == 400
    assert owner.delete(BASE + "/" + first["deviceId"], headers=INTENT).status_code == 204
    assert owner.delete(BASE + "/" + first["deviceId"], headers=INTENT).status_code == 204
    assert upload(device, first["accessToken"]).status_code == 401
    second = grant(rig)
    # Existing finite grants retain their original expiry across the migration.
    with get_session_factory()() as db:
        row = db.scalar(
            select(ReceiptDevice).where(
                ReceiptDevice.token_hash == devices.digest(second["accessToken"])
            )
        )
        row.expires_at = clock[0] + timedelta(seconds=900)
        db.commit()
    clock[0] += timedelta(seconds=900)
    assert upload(device, second["accessToken"]).status_code == 401
    assert owner.get(BASE).json() == []
    assert calls == []


def test_permanent_grant_survives_years_and_pairing_cleanup_until_revoked(rig):
    owner, device, clock, calls = rig
    granted = grant(rig)
    assert granted["expiresAt"] is None
    clock[0] += timedelta(days=3650)
    assert upload(device, granted["accessToken"]).status_code == 200
    assert len(calls) == 1
    pair(rig)  # Cleanup must not delete a grant without an expiration date.
    current = owner.get(BASE).json()
    assert len(current) == 1 and current[0]["expiresAt"] is None
    assert current[0]["id"] == granted["deviceId"]
    assert owner.delete(BASE + "/" + granted["deviceId"], headers=INTENT).status_code == 204
    assert upload(device, granted["accessToken"]).status_code == 401
    assert len(calls) == 1


def test_denied_and_expired_pairings_never_issue_tokens(rig):
    owner, device, clock, _ = rig
    first = pair(rig)
    assert (
        owner.post(
            BASE + "/pairings/deny", json={"userCode": first["userCode"]}, headers=INTENT
        ).status_code
        == 200
    )
    assert (
        device.post(BASE + "/pairings/token", json={"deviceCode": first["deviceCode"]}).status_code
        == 403
    )
    second = pair(rig)
    clock[0] += timedelta(seconds=600)
    assert (
        owner.post(BASE + "/pairings/lookup", json={"userCode": second["userCode"]}).status_code
        == 404
    )
    assert (
        device.post(BASE + "/pairings/token", json={"deviceCode": second["deviceCode"]}).status_code
        == 410
    )


def test_pairing_rate_poll_interval_and_body_bounds(rig):
    _, device, clock, _ = rig
    first = pair(rig)
    payload = {"deviceCode": first["deviceCode"]}
    assert device.post(BASE + "/pairings/token", json=payload).status_code == 202
    assert device.post(BASE + "/pairings/token", json=payload).status_code == 429
    clock[0] += timedelta(seconds=3)
    assert device.post(BASE + "/pairings/token", json=payload).status_code == 202
    for _ in range(5):
        pair(rig)
    assert device.post(BASE + "/pairings", json={"deviceName": "Rokid"}).status_code == 429
    assert (
        device.post(
            BASE + "/pairings", headers={"Content-Type": "application/json"}, content=b" " * 4097
        ).status_code
        == 413
    )
    invalid = device.post(BASE + "/pairings", json={"userId": "private-value"})
    assert invalid.status_code == 422 and "private-value" not in invalid.text
    assert invalid.headers["cache-control"] == "no-store"


def test_password_change_invalidates_both_pending_approval_and_issued_token(rig):
    owner, device, _, _ = rig
    token = grant(rig)["accessToken"]
    pending = pair(rig)
    owner.post(BASE + "/pairings/approve", json={"userCode": pending["userCode"]}, headers=INTENT)
    with get_session_factory()() as db:
        user = db.scalar(select(User))
        user.password_hash = "changed-password-fingerprint"
        db.commit()
    assert upload(device, token).status_code == 401
    assert (
        device.post(
            BASE + "/pairings/token", json={"deviceCode": pending["deviceCode"]}
        ).status_code
        == 410
    )


def test_owner_isolation_for_codes_and_device_revocation(rig):
    owner, device, _, _ = rig
    grant_data = grant(rig)
    pending = pair(rig)
    owner.post(BASE + "/pairings/approve", json={"userCode": pending["userCode"]}, headers=INTENT)
    with get_session_factory()() as db:
        other = User(email="other@example.com", display_name="Other", password_hash="synthetic")
        db.add(other)
        db.flush()
        session = create_session(db, other)
        db.commit()
    device.cookies.set(SESSION_COOKIE_NAME, session)
    assert (
        device.post(BASE + "/pairings/lookup", json={"userCode": pending["userCode"]}).status_code
        == 404
    )
    assert device.delete(BASE + "/" + grant_data["deviceId"], headers=INTENT).status_code == 404
    assert device.get(BASE).json() == []


def test_revocation_during_image_processing_prevents_provider_call(rig, monkeypatch):
    _, device, _, calls = rig
    token = grant(rig)["accessToken"]

    def normalize(raw, mime):
        with get_session_factory()() as db:
            row = db.scalar(select(ReceiptDevice))
            row.revoked_at = devices.now()
            db.commit()
        return b"synthetic-normalized"

    monkeypatch.setattr(expenses, "normalize_image", normalize)
    assert upload(device, token).status_code == 401
    assert calls == []


def test_invalid_photo_and_missing_upload_header_never_call_provider(rig):
    _, device, _, calls = rig
    token = grant(rig)["accessToken"]
    assert upload(device, token, b"invalid-image").status_code == 422
    assert (
        device.post(
            BASE + "/receipt-recognition",
            headers={"Authorization": "Bearer " + token, "Content-Type": "image/png"},
            content=b"invalid-image",
        ).status_code
        == 400
    )
    assert calls == []
