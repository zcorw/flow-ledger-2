import copy
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db.base import Base
from app.db.session import get_db, get_session_factory
from app.main import app
from app.models.asset import Account
from app.models.audit import AuditLog
from app.models.expense import Expense
from app.models.user import User
from app.services.backup import (
    build_backup_payload,
    restore_backup_payload,
    validate_backup_payload,
)


def bootstrap(client):
    response = client.post(
        "/api/v1/setup/bootstrap",
        json={
            "bootstrapToken": "test-bootstrap-token",
            "displayName": "Expense tests",
            "email": "expense@example.com",
            "password": "correct-horse-battery-staple",
        },
    )
    assert response.status_code == 201


def payload(**changes):
    return {
        "expenseDate": "2026-11-01",
        "amount": "1234",
        "currencyCode": "JPY",
        "category": "food",
        "merchant": "合成店舗",
        "requestKey": str(uuid.uuid4()),
        **changes,
    }


def post(client, **changes):
    return client.post("/api/v1/expenses", json=payload(**changes))


def test_crud_filters_summaries_and_dashboard_unchanged(client):
    assert client.get("/api/v1/expenses").status_code == 401
    assert post(client).status_code == 401
    bootstrap(client)
    institution = client.post("/api/v1/institutions", json={
        "name": "合成银行", "institutionType": "bank",
    }).json()
    account = client.post(
        "/api/v1/accounts",
        json={
            "name": "合成资产账户",
            "accountType": "savings",
            "institutionId": institution["id"],
        },
    ).json()
    project = client.post(
        "/api/v1/projects",
        json={
            "accountId": account["id"],
            "name": "合成存款",
            "assetType": "bank_deposit",
            "currencyCode": "CNY",
            "defaultLiquidityLevel": "t0",
            "defaultRiskLevel": "low",
        },
    ).json()
    snapshot = client.put(
        "/api/v1/snapshots/bulk",
        json={
            "snapshotDate": "2026-11-01",
            "rows": [
                {
                    "projectId": project["id"],
                    "originalAmount": "10000",
                    "liquidityLevel": "t0",
                    "riskLevel": "low",
                    "changeNote": "合成快照",
                }
            ],
        },
    )
    assert snapshot.status_code == 200
    dashboard = client.get("/api/v1/dashboard/summary", params={"snapshotDate": "2026-11-01"})
    assert dashboard.status_code == 200
    before = dashboard.json()
    item = post(client, accountId=account["id"]).json()
    assert item["category"] == "food" and item["source"] == "manual"
    assert (
        post(client, amount="0.100001", currencyCode="CNY", category="shopping").status_code == 201
    )
    assert (
        post(
            client,
            expenseDate="2026-10-31",
            amount="0.200002",
            currencyCode="CNY",
            category="shopping",
        ).status_code
        == 201
    )
    data = client.get("/api/v1/expenses").json()
    assert data["total"] == 3
    assert data["totals"] == [
        {"currency": "CNY", "amount": "0.300003"},
        {"currency": "JPY", "amount": "1234.000000"},
    ]
    assert len(data["by_day"]) == 3
    assert data["by_category"][1]["amount"] == "0.300003"
    filtered = client.get(
        "/api/v1/expenses",
        params={
            "startDate": "2026-11-01",
            "endDate": "2026-11-01",
            "currency": "CNY",
            "category": "shopping",
            "limit": 1,
        },
    ).json()
    assert filtered["total"] == 1 and filtered["totals"][0]["amount"] == "0.100001"
    fields = {
        "expenseDate": "2026-02-28",
        "amount": "900.123456",
        "currencyCode": "JPY",
        "category": "uncategorized",
        "merchant": "  修正  ",
        "note": "合成",
    }
    changed = client.put(f"/api/v1/expenses/{item['id']}", json=fields)
    assert changed.status_code == 200 and changed.json()["merchant"] == "修正"
    assert changed.json()["amount"] == "900.123456"
    assert client.delete(f"/api/v1/expenses/{item['id']}").status_code == 204
    assert client.delete(f"/api/v1/expenses/{item['id']}").status_code == 404
    assert client.get("/api/v1/expenses").json()["total"] == 2
    after = client.get("/api/v1/dashboard/summary", params={"snapshotDate": "2026-11-01"})
    assert after.status_code == 200 and after.json() == before
    with get_session_factory()() as db:
        actions = set(db.scalars(select(AuditLog.action)))
        assert {"expense.create", "expense.update", "expense.delete"} <= actions


@pytest.mark.parametrize(
    "changes",
    [
        {"amount": "0"},
        {"amount": "-1"},
        {"amount": "NaN"},
        {"amount": "Infinity"},
        {"amount": "100000000000000"},
        {"amount": "1.0000001"},
        {"expenseDate": "2026-02-29"},
        {"expenseDate": "20261101"},
        {"expenseDate": "2026-11-01T00:00:00Z"},
        {"expenseDate": 0},
        {"category": "repayment"},
        {"source": "cloud"},
        {"currencyCode": "abc"},
        {"merchant": "x" * 151},
        {"note": "x" * 2001},
    ],
)
def test_rejects_invalid_data(client, changes):
    bootstrap(client)
    assert post(client, **changes).status_code == 422
    assert client.get("/api/v1/expenses").json()["total"] == 0


def test_exact_range_dates_optional_category_and_user_isolation(client):
    bootstrap(client)
    raw = payload(amount="99999999999999.999999", expenseDate="2024-02-29")
    del raw["category"]
    item = client.post("/api/v1/expenses", json=raw)
    assert item.status_code == 201 and item.json()["category"] == "uncategorized"
    assert item.json()["amount"] == raw["amount"]
    assert client.get("/api/v1/expenses").json()["totals"][0]["amount"] == raw["amount"]
    assert (
        client.get(
            "/api/v1/expenses",
            params={
                "startDate": "2026-12-01",
                "endDate": "2026-11-01",
            },
        ).status_code
        == 400
    )
    with get_session_factory()() as db:
        user = User(email="other@example.com", password_hash="synthetic", display_name="Other")
        db.add(user)
        db.flush()
        other_id = user.id
        other_account = Account(user_id=other_id, name="Other account", account_type="other")
        db.add(other_account)
        db.flush()
        other_account_id = other_account.id
        other = Expense(
            user_id=other_id,
            expense_date=date(2026, 11, 1),
            amount=Decimal("1"),
            currency_code="JPY",
            category="food",
            source="manual",
            request_key=uuid.uuid4(),
            request_hash="x" * 64,
        )
        db.add(other)
        db.commit()
        other_expense_id = other.id
    assert client.get("/api/v1/expenses").json()["total"] == 1
    fields = {k: v for k, v in raw.items() if k != "requestKey"}
    assert client.put(f"/api/v1/expenses/{other_expense_id}", json=fields).status_code == 404
    assert client.delete(f"/api/v1/expenses/{other_expense_id}").status_code == 404
    assert post(client, accountId=str(uuid.uuid4())).status_code == 404
    assert post(client, accountId=str(other_account_id)).status_code == 404
    assert str(other_account_id) not in str(client.get("/api/v1/expenses/accounts").json())
    assert post(client, currencyCode="GBP").status_code == 400


def test_idempotency_duplicate_warning_and_deleted_replay(client):
    bootstrap(client)
    value = payload(source="receipt_ocr")
    first = client.post("/api/v1/expenses", json=value)
    replay = client.post("/api/v1/expenses", json={**value, "amount": "1234.000000"})
    assert first.status_code == 201 and replay.status_code == 200
    assert first.json()["id"] == replay.json()["id"]
    assert client.post("/api/v1/expenses", json={**value, "amount": "1235"}).status_code == 409
    suspected = post(client)
    assert (
        suspected.status_code == 409 and suspected.json()["error"]["code"] == "POSSIBLE_DUPLICATE"
    )
    assert post(client, allowDuplicate=True).status_code == 201
    assert client.delete(f"/api/v1/expenses/{first.json()['id']}").status_code == 204
    assert (
        client.post("/api/v1/expenses", json=value).json()["error"]["code"]
        == "EXPENSE_ALREADY_DELETED"
    )
    assert client.get("/api/v1/expenses").json()["total"] == 1


def test_backup_round_trip_v1_compatibility_and_idempotency(client):
    bootstrap(client)
    value = payload(amount="99999999999999.123456")
    saved = client.post("/api/v1/expenses", json=value).json()
    with get_session_factory()() as db:
        user_id = db.scalar(select(User.id))
        backup = build_backup_payload(db, user_id)
        assert backup["version"] == 2
        validate_backup_payload(backup)
        restore_backup_payload(db, user_id, backup)
        db.commit()
    assert client.get("/api/v1/expenses").json()["items"][0]["amount"] == value["amount"]
    assert client.post("/api/v1/expenses", json=value).json()["id"] == saved["id"]
    old = copy.deepcopy(backup)
    old["version"] = 1
    del old["tables"]["expenses"]
    validate_backup_payload(old)
    with get_session_factory()() as db:
        restore_backup_payload(db, user_id, old)
        db.commit()
    assert client.get("/api/v1/expenses").json()["total"] == 0
    old["version"] = 2
    with pytest.raises(ValueError):
        validate_backup_payload(old)


def test_concurrent_retry_uses_database_unique_constraint(tmp_path):
    # Dedicated synthetic file DB with separate connections, never the real configured DB.
    engine = create_engine(
        f"sqlite+pysqlite:///{(tmp_path / 'concurrency.db').as_posix()}",
        connect_args={"check_same_thread": False, "timeout": 15},
    )
    Base.metadata.create_all(engine)

    def override_db():
        with Session(engine, expire_on_commit=False, autoflush=False) as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as setup_client:
            bootstrap(setup_client)
            cookies = dict(setup_client.cookies)
        value = payload()

        def submit(_):
            with TestClient(app, cookies=cookies) as requester:
                return requester.post("/api/v1/expenses", json=value)

        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(submit, range(4)))
        assert sorted(result.status_code for result in results) == [200, 200, 200, 201]
        assert len({result.json()["id"] for result in results}) == 1
        with Session(engine) as db:
            assert len(list(db.scalars(select(Expense)))) == 1
            assert (
                len(list(db.scalars(select(AuditLog).where(AuditLog.action == "expense.create"))))
                == 1
            )
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_payment_accounts_include_institution_context_and_unassigned_accounts(client):
    assert client.get("/api/v1/expenses/accounts").status_code == 401
    bootstrap(client)
    expected = {}
    for name in ["Bank A", "Bank B"]:
        institution = client.post("/api/v1/institutions", json={
            "name": name, "institutionType": "bank",
        }).json()
        account = client.post("/api/v1/accounts", json={
            "name": "资产账户", "accountType": "savings",
            "institutionId": institution["id"], "maskedIdentifier": "尾号 1234",
        }).json()
        expected[account["id"]] = name
    unassigned = client.post("/api/v1/accounts", json={
        "name": "Wallet", "accountType": "cash_wallet", "isActive": False,
    }).json()
    expected[unassigned["id"]] = None

    response = client.get("/api/v1/expenses/accounts")
    assert response.status_code == 200
    rows = response.json()
    assert {row["id"]: row["institution_name"] for row in rows} == expected
    assert all(row["name"] == "资产账户" for row in rows if row["institution_id"])
    assert all(row["masked_identifier"] == "尾号 1234" for row in rows if row["institution_id"])
    assert next(row for row in rows if row["id"] == unassigned["id"])["is_active"] is False
