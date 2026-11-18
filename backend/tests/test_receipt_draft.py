import copy
import uuid

from sqlalchemy import func, select

from app.db.session import get_session_factory
from app.models.audit import AuditLog
from app.models.expense import Expense
from app.models.receipt import Receipt
from app.models.user import User
from app.services.backup import (
    build_backup_payload,
    restore_backup_payload,
    validate_backup_payload,
)
from tests.test_receipt_devices import BASE, grant, upload

pytest_plugins = ["tests.test_receipt_devices"]


def setup(rig):
    owner, device, _, _ = rig
    token = grant(rig)["accessToken"]
    receipt_id = upload(device, token).headers["X-Receipt-Id"]
    headers = {"Authorization": "Bearer " + token}
    body = {
        "receiptId": receipt_id,
        "requestKey": str(uuid.uuid4()),
        "expectedRevision": 0,
        "values": {"amount": "614", "merchant": "草稿商户"},
    }
    return owner, device, headers, body


def test_draft_replay_conflicts_search_and_no_accounting(rig):
    owner, device, headers, body = setup(rig)
    saved = device.post(BASE + "/receipt-drafts", headers=headers, json=body)
    assert saved.status_code == 200 and saved.json()["revision"] == 1
    assert saved.json()["values"]["category"] == ""
    assert device.post(BASE + "/receipt-drafts", headers=headers, json=body).json() == saved.json()
    conflict = {**body, "values": {"amount": "615"}}
    assert device.post(BASE + "/receipt-drafts", headers=headers, json=conflict).status_code == 409
    conflict["requestKey"] = str(uuid.uuid4())
    assert device.post(BASE + "/receipt-drafts", headers=headers, json=conflict).status_code == 409
    conflict["expectedRevision"] = 1
    assert (
        device.post(BASE + "/receipt-drafts", headers=headers, json=conflict).json()["revision"]
        == 2
    )
    assert device.post(BASE + "/receipt-drafts", headers=headers, json=body).status_code == 409
    current = device.get(BASE + "/receipt-drafts/" + body["receiptId"], headers=headers).json()
    assert current["values"]["amount"] == "615"
    assert owner.get("/api/v1/expenses").json()["total"] == 0
    assert owner.get("/api/v1/receipts?drafts=true").json()["total"] == 1
    with get_session_factory()() as db:
        assert db.scalar(select(func.count()).select_from(Receipt)) == 1
        assert db.scalar(select(func.count()).select_from(Expense)) == 0
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(AuditLog.action == "receipt.draft_saved")
            )
            == 2
        )


def test_web_draft_continue_and_backup_compatibility(rig):
    owner, device, headers, body = setup(rig)
    assert owner.post("/api/v1/receipts/drafts", json=body).status_code == 200
    assert owner.get("/api/v1/receipts?drafts=true&q=草稿商户").json()["total"] == 1
    assert owner.get("/api/v1/receipts?drafts=true&q=不存在").json()["total"] == 0
    assert (
        device.get(BASE + "/receipt-drafts/" + str(uuid.uuid4()), headers=headers).status_code
        == 404
    )
    assert device.post(BASE + "/receipt-drafts", json=body).status_code == 401
    with get_session_factory()() as db:
        user_id = db.scalar(select(User.id))
        payload = build_backup_payload(db, user_id)
        assert payload["version"] == 4
        validate_backup_payload(payload)
        restore_backup_payload(db, user_id, payload)
        db.commit()
        row = db.scalar(select(Receipt))
        assert row.draft_values["amount"] == "614" and row.draft_revision == 1
        old = copy.deepcopy(payload)
        old["version"] = 3
        for item in old["tables"]["receipts"]:
            for field in [
                "draft_values",
                "draft_revision",
                "draft_request_key",
                "draft_request_hash",
            ]:
                item.pop(field)
        validate_backup_payload(old)
        restore_backup_payload(db, user_id, old)
        db.commit()
        db.expire_all()
        assert db.scalar(select(Receipt)).draft_revision == 0
        assert db.scalar(select(Receipt)).draft_values is None
