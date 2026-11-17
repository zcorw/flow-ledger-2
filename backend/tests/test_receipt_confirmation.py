import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.expense import Expense
from app.models.receipt import Receipt
from app.models.receipt_device import ReceiptDevice
from app.models.user import User
from app.services import receipt_device as devices
from tests.test_expenses import bootstrap
from tests.test_receipt_devices import BASE, INTENT, grant, upload

pytest_plugins = ["tests.test_receipt_devices"]


def setup(rig):
    owner, device, _, _ = rig
    credentials = grant(rig)
    headers = {"Authorization": "Bearer " + credentials["accessToken"]}
    receipt_id = upload(device, credentials["accessToken"]).headers["X-Receipt-Id"]
    account = owner.post(
        "/api/v1/accounts", json={"name": "合成现金", "accountType": "cash_wallet"}
    )
    assert account.status_code == 201
    fields = {
        "amount": "88.50",
        "expenseDate": "2026-11-15",
        "currencyCode": "CNY",
        "category": "food",
        "accountId": account.json()["id"],
        "merchant": "合成商户",
    }
    draft = {
        "receiptId": receipt_id,
        "requestKey": str(uuid.uuid4()),
        "expectedRevision": 0,
        "values": fields,
    }
    assert device.post(BASE + "/receipt-drafts", headers=headers, json=draft).status_code == 200
    confirmation = {
        "receiptId": receipt_id,
        "revision": 1,
        "requestKey": str(uuid.uuid4()),
        "confirmed": True,
    }
    return owner, device, headers, credentials["deviceId"], draft, confirmation


def test_explicit_permission_confirmation_replay_and_deleted_tombstone(rig):
    owner, device, headers, device_id, _, payload = setup(rig)
    url = BASE + f"/{device_id}/expense-permission"
    assert device.get(BASE + "/capabilities", headers=headers).json()["canCreateExpenses"] is False
    assert (
        device.post(BASE + "/receipt-confirmations", headers=headers, json=payload).status_code
        == 403
    )
    assert owner.post(url, json={"enabled": True}).status_code == 400
    assert (
        device.post(url, headers={**headers, **INTENT}, json={"enabled": True}).status_code == 401
    )
    assert owner.post(url, headers=INTENT, json={"enabled": True}).status_code == 200
    assert (
        device.post(
            BASE + "/receipt-confirmations", headers=headers, json={**payload, "confirmed": False}
        ).status_code
        == 422
    )
    created = device.post(BASE + "/receipt-confirmations", headers=headers, json=payload)
    assert created.status_code == 201 and created.json()["status"] == "recorded"
    expense_id = created.json()["record"]["id"]
    assert created.json()["record"]["receipt_id"] == payload["receiptId"]
    assert (
        device.post(BASE + "/receipt-confirmations", headers=headers, json=payload).json()[
            "record"
        ]["id"]
        == expense_id
    )
    assert (
        device.post(
            BASE + "/receipt-confirmations",
            headers=headers,
            json={**payload, "requestKey": str(uuid.uuid4())},
        ).json()["record"]["id"]
        == expense_id
    )
    outcome = (
        BASE
        + "/receipt-confirmations/"
        + payload["requestKey"]
        + "?receiptId="
        + payload["receiptId"]
    )
    assert device.get(outcome, headers=headers).json()["status"] == "recorded"
    assert owner.get("/api/v1/expenses").json()["total"] == 1
    assert owner.delete("/api/v1/expenses/" + expense_id).status_code == 204
    assert device.get(outcome, headers=headers).json()["status"] == "deleted"
    assert (
        device.post(BASE + "/receipt-confirmations", headers=headers, json=payload).status_code
        == 409
    )


def test_stale_draft_revoked_permission_and_missing_fields_do_not_write(rig):
    owner, device, headers, device_id, draft, payload = setup(rig)
    url = BASE + f"/{device_id}/expense-permission"
    owner.post(url, headers=INTENT, json={"enabled": True})
    next_draft = {
        **draft,
        "requestKey": str(uuid.uuid4()),
        "expectedRevision": 1,
        "values": {"amount": "614"},
    }
    assert (
        device.post(BASE + "/receipt-drafts", headers=headers, json=next_draft).status_code == 200
    )
    assert (
        device.post(BASE + "/receipt-confirmations", headers=headers, json=payload).status_code
        == 409
    )
    assert (
        device.post(
            BASE + "/receipt-confirmations", headers=headers, json={**payload, "revision": 2}
        ).status_code
        == 422
    )
    owner.post(url, headers=INTENT, json={"enabled": False})
    assert (
        device.post(
            BASE + "/receipt-confirmations", headers=headers, json={**payload, "revision": 2}
        ).status_code
        == 403
    )
    assert (
        device.get(BASE + "/receipt-drafts/" + payload["receiptId"], headers=headers).status_code
        == 200
    )
    assert owner.get("/api/v1/expenses").json()["total"] == 0


def test_concurrent_device_confirmation_creates_one_expense(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite+pysqlite:///{(tmp_path / 'confirm.db').as_posix()}",
        connect_args={"check_same_thread": False, "timeout": 15},
    )
    Base.metadata.create_all(engine)

    def override_db():
        with Session(engine, expire_on_commit=False, autoflush=False) as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    monkeypatch.setattr(get_settings(), "app_base_url", "https://ledger.example")
    try:
        with TestClient(app) as owner:
            bootstrap(owner)
            account = owner.post(
                "/api/v1/accounts", json={"name": "合成账户", "accountType": "cash_wallet"}
            ).json()
        with Session(engine) as db:
            user = db.scalar(select(User))
            receipt = Receipt(
                user_id=user.id,
                original_image=b"synthetic",
                mime_type="image/png",
                byte_length=9,
                sha256="a" * 64,
                status="recognized",
                draft_revision=1,
                draft_values={
                    "amount": "88.50",
                    "expenseDate": "2026-11-15",
                    "currencyCode": "CNY",
                    "category": "food",
                    "accountId": account["id"],
                },
            )
            db.add(receipt)
            db.add(
                ReceiptDevice(
                    user_id=user.id,
                    token_hash=devices.digest("t" * 43),
                    password_fingerprint=devices.digest(user.password_hash),
                    resource="https://ledger.example",
                    device_name="Synthetic",
                    expense_write_enabled=True,
                )
            )
            db.commit()
            receipt_id = str(receipt.id)
        payload = {
            "receiptId": receipt_id,
            "revision": 1,
            "requestKey": str(uuid.uuid4()),
            "confirmed": True,
        }

        def submit(_):
            with TestClient(app) as device:
                return device.post(
                    BASE + "/receipt-confirmations",
                    json=payload,
                    headers={"Authorization": "Bearer " + "t" * 43},
                )

        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(submit, range(4)))
        assert all(item.status_code in (200, 201) for item in results)
        assert len({item.json()["record"]["id"] for item in results}) == 1
        with Session(engine) as db:
            assert db.scalar(select(func.count()).select_from(Expense)) == 1
            assert (
                db.scalar(
                    select(func.count())
                    .select_from(AuditLog)
                    .where(AuditLog.action == "expense.create")
                )
                == 1
            )
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_duplicate_receipts_require_an_explicit_second_confirmation(rig):
    owner, device, headers, device_id, draft, payload = setup(rig)
    owner.post(BASE + f"/{device_id}/expense-permission", headers=INTENT, json={"enabled": True})
    assert (
        device.post(BASE + "/receipt-confirmations", headers=headers, json=payload).status_code
        == 201
    )
    receipt_id = upload(device, headers["Authorization"][7:]).headers["X-Receipt-Id"]
    second_draft = {**draft, "receiptId": receipt_id, "requestKey": str(uuid.uuid4())}
    assert (
        device.post(BASE + "/receipt-drafts", headers=headers, json=second_draft).status_code == 200
    )
    second = {**payload, "receiptId": receipt_id, "requestKey": str(uuid.uuid4())}
    warning = device.post(BASE + "/receipt-confirmations", headers=headers, json=second)
    assert warning.status_code == 409 and warning.json()["error"]["code"] == "POSSIBLE_DUPLICATE"
    assert owner.get("/api/v1/expenses").json()["total"] == 1
    assert (
        device.post(
            BASE + "/receipt-confirmations",
            headers=headers,
            json={**second, "allowDuplicate": True},
        ).status_code
        == 201
    )
    assert owner.get("/api/v1/expenses").json()["total"] == 2
