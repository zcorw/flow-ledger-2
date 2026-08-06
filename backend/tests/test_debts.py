import uuid
from datetime import date, timedelta
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.session import get_session_factory
from app.models.audit import AuditLog
from app.models.debt import DebtEvent
from app.models.fx import FxRate


def bootstrap(client: TestClient) -> None:
    assert (
        client.post(
            "/api/v1/setup/bootstrap",
            json={
                "bootstrapToken": "test-bootstrap-token",
                "displayName": "Debt Admin",
                "email": "debts@example.com",
                "password": "correct-horse-battery-staple",
            },
        ).status_code
        == 201
    )


def create_debt(client: TestClient, debt_type: str = "receivable", currency: str = "CNY") -> str:
    response = client.post(
        "/api/v1/debts",
        json={
            "debtType": debt_type,
            "counterparty": "Friend A",
            "currencyCode": currency,
            "notes": "Test ledger",
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def event(
    client: TestClient,
    debt_id: str,
    event_type: str,
    event_date: str,
    amount: str,
    confirm_negative: bool = False,
):
    return client.post(
        f"/api/v1/debts/{debt_id}/events",
        json={
            "eventType": event_type,
            "eventDate": event_date,
            "amount": amount,
            "counterparty": "Friend A",
            "note": event_type,
            "confirmNegative": confirm_negative,
        },
    )


def test_debt_event_sequence_as_of_dates_and_status(client: TestClient) -> None:
    bootstrap(client)
    debt_id = create_debt(client)
    assert event(client, debt_id, "issue", "2026-07-01", "50000").status_code == 201
    assert event(client, debt_id, "repayment", "2026-07-15", "10000").status_code == 201
    assert event(client, debt_id, "adjustment", "2026-07-20", "-5000").status_code == 201

    early = client.get("/api/v1/debts/balances", params={"snapshotDate": "2026-07-10"})
    assert early.json()["items"][0]["balance"] == "50000.000000"
    later = client.get("/api/v1/debts/balances", params={"snapshotDate": "2026-07-25"})
    assert later.json()["items"][0]["balance"] == "35000.000000"

    settled = event(client, debt_id, "settle", "2026-07-31", "0")
    assert settled.status_code == 201
    final = client.get("/api/v1/debts", params={"type": "receivable"}).json()[0]
    assert final["balance"] == "0.000000"
    assert final["status"] == "settled"
    timeline = client.get(f"/api/v1/debts/{debt_id}/events").json()
    assert [item["event_type"] for item in timeline] == [
        "settle",
        "adjustment",
        "repayment",
        "issue",
    ]


def test_debt_list_uses_latest_recorded_event_balance(client: TestClient) -> None:
    bootstrap(client)
    debt_id = create_debt(client)
    issue_date = date.today() + timedelta(days=30)
    repayment_date = issue_date + timedelta(days=1)
    assert event(client, debt_id, "issue", issue_date.isoformat(), "10000").status_code == 201
    assert event(
        client,
        debt_id,
        "repayment",
        repayment_date.isoformat(),
        "3000",
    ).status_code == 201

    current = client.get("/api/v1/debts", params={"type": "receivable"}).json()[0]
    assert current["balance"] == "7000.000000"
    assert current["last_event_date"] == repayment_date.isoformat()
    assert current["status"] == "partially_settled"

    historical = client.get(
        "/api/v1/debts/balances",
        params={"snapshotDate": date.today().isoformat()},
    ).json()["items"][0]
    assert Decimal(historical["balance"]) == 0
    assert historical["last_event_date"] is None


def test_delete_event_recalculates_balance_and_delete_item_cascades(client: TestClient) -> None:
    bootstrap(client)
    debt_id = create_debt(client)
    assert event(client, debt_id, "issue", "2026-07-01", "10000").status_code == 201
    repayment = event(client, debt_id, "repayment", "2026-07-02", "3000")
    assert repayment.status_code == 201

    deleted_event = client.delete(
        f"/api/v1/debts/{debt_id}/events/{repayment.json()['id']}"
    )
    assert deleted_event.status_code == 204
    remaining_events = client.get(f"/api/v1/debts/{debt_id}/events").json()
    assert len(remaining_events) == 1
    item = client.get("/api/v1/debts", params={"type": "receivable"}).json()[0]
    assert item["balance"] == "10000.000000"
    assert item["status"] == "active"

    deleted_item = client.delete(f"/api/v1/debts/{debt_id}")
    assert deleted_item.status_code == 204
    assert client.get("/api/v1/debts", params={"type": "receivable"}).json() == []
    missing_events = client.get(f"/api/v1/debts/{debt_id}/events")
    assert missing_events.status_code == 404

    with get_session_factory()() as db:
        assert (
            db.scalar(
                select(DebtEvent).where(DebtEvent.debt_item_id == uuid.UUID(debt_id))
            )
            is None
        )
        audit_actions = set(db.scalars(select(AuditLog.action)))
        assert "debt.event.delete" in audit_actions
        assert "debt.delete" in audit_actions


def test_negative_rules_and_currency_conversion(client: TestClient) -> None:
    bootstrap(client)
    debt_id = create_debt(client, "payable")
    assert event(client, debt_id, "repayment", "2026-07-01", "1").status_code == 409
    requires_confirmation = event(client, debt_id, "adjustment", "2026-07-01", "-1")
    assert requires_confirmation.status_code == 409
    assert requires_confirmation.json()["error"]["code"] == "NEGATIVE_CONFIRMATION_REQUIRED"
    assert event(client, debt_id, "adjustment", "2026-07-01", "-1", True).status_code == 201

    with get_session_factory()() as db:
        db.add(
            FxRate(
                base_currency="CNY",
                quote_currency="USD",
                rate_date=date(2026, 6, 30),
                rate_to_base=Decimal("7.0000000000"),
                source="test",
            )
        )
        db.commit()
    usd_id = create_debt(client, "receivable", "USD")
    assert event(client, usd_id, "issue", "2026-07-01", "100").status_code == 201
    sheet = client.get("/api/v1/debts/balances", params={"snapshotDate": "2026-07-02"}).json()
    usd = next(item for item in sheet["items"] if item["id"] == usd_id)
    assert usd["converted_amount_cny"] == "700.000000"
    assert usd["fx_is_stale"] is True
    assert sheet["total_receivable_cny"] == "700.000000"
