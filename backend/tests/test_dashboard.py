from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.session import get_session_factory
from app.models.asset import Account
from app.models.fx import FxRate
from app.models.institution import Institution


def bootstrap(client: TestClient) -> tuple[str, str, str]:
    assert (
        client.post(
            "/api/v1/setup/bootstrap",
            json={
                "bootstrapToken": "test-bootstrap-token",
                "displayName": "Dashboard Admin",
                "email": "dashboard@example.com",
                "password": "correct-horse-battery-staple",
            },
        ).status_code
        == 201
    )
    institution = client.post(
        "/api/v1/institutions",
        json={"name": "Dashboard Bank", "institutionType": "bank", "isActive": True},
    ).json()
    account = client.post(
        "/api/v1/accounts",
        json={
            "institutionId": institution["id"],
            "name": "Portfolio",
            "accountType": "brokerage",
        },
    ).json()

    def project(name: str, currency: str) -> str:
        return client.post(
            "/api/v1/projects",
            json={
                "accountId": account["id"],
                "name": name,
                "assetType": "securities",
                "currencyCode": currency,
                "defaultLiquidityLevel": "within_7d",
                "defaultRiskLevel": "medium",
            },
        ).json()["id"]

    return project("CNY Fund", "CNY"), project("USD Fund", "USD"), project("Negative", "CNY")


def snapshot_row(project_id: str, amount: str) -> dict[str, str]:
    return {
        "projectId": project_id,
        "originalAmount": amount,
        "liquidityLevel": "within_7d",
        "riskLevel": "medium",
        "changeNote": "dashboard fixture",
    }


def debt_with_issue(client: TestClient, debt_type: str, amount: str) -> None:
    item = client.post(
        "/api/v1/debts",
        json={
            "debtType": debt_type,
            "counterparty": f"{debt_type} party",
            "currencyCode": "CNY",
            "notes": "dashboard fixture",
        },
    ).json()
    assert (
        client.post(
            f"/api/v1/debts/{item['id']}/events",
            json={
                "eventType": "issue",
                "eventDate": "2026-07-01",
                "amount": amount,
                "counterparty": item["counterparty"],
                "note": "opening",
            },
        ).status_code
        == 201
    )


def test_dashboard_accounting_rules_and_charts(client: TestClient) -> None:
    cny_id, usd_id, negative_id = bootstrap(client)
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
    assert (
        client.put(
            "/api/v1/snapshots/bulk",
            json={"snapshotDate": "2026-06-30", "rows": [snapshot_row(cny_id, "800")]},
        ).status_code
        == 200
    )
    assert (
        client.put(
            "/api/v1/snapshots/bulk",
            json={
                "snapshotDate": "2026-07-31",
                "rows": [
                    snapshot_row(cny_id, "1000"),
                    snapshot_row(usd_id, "100"),
                    snapshot_row(negative_id, "-100"),
                ],
            },
        ).status_code
        == 200
    )
    debt_with_issue(client, "receivable", "500")
    debt_with_issue(client, "payable", "200")

    summary = client.get("/api/v1/dashboard/summary", params={"snapshotDate": "2026-07-31"})
    assert summary.status_code == 200
    data = summary.json()
    assert data["total_assets_cny"] == "2200.000000"
    assert data["total_liabilities_cny"] == "200.000000"
    assert data["net_worth_cny"] == "2000.000000"
    assert data["net_worth_change_from_previous_month_cny"] == "1200.000000"
    assert data["foreign_asset_ratio"] == "0.3181818181818181818181818182"
    assert data["fx_warnings"] == ["USD 项目使用历史汇率"]

    charts = client.get("/api/v1/dashboard/charts", params={"snapshotDate": "2026-07-31"}).json()
    assert charts["trend"][-1]["value"] == "2000.000000"
    assert charts["top_institutions"] == [{"name": "Dashboard Bank", "value": "1700.000000"}]
    currencies = {item["name"]: item["value"] for item in charts["currency_distribution"]}
    assert currencies == {"CNY": "1500.000000", "USD": "700.000000"}
    assert all(item["project_name"] != "Negative" for item in charts["project_changes"])
    assert charts["project_changes"][0]["project_name"] == "USD Fund"


def test_dashboard_uses_latest_active_snapshot_within_each_month(
    client: TestClient,
) -> None:
    cny_id, usd_id, _negative_id = bootstrap(client)
    with get_session_factory()() as db:
        db.add(
            FxRate(
                base_currency="CNY",
                quote_currency="USD",
                rate_date=date(2026, 6, 1),
                rate_to_base=Decimal("7.0000000000"),
                source="test",
            )
        )
        db.commit()
    assert (
        client.put(
            "/api/v1/snapshots/bulk",
            json={"snapshotDate": "2026-06-27", "rows": [snapshot_row(usd_id, "100")]},
        ).status_code
        == 200
    )
    assert (
        client.put(
            "/api/v1/snapshots/bulk",
            json={"snapshotDate": "2026-06-28", "rows": [snapshot_row(cny_id, "1000")]},
        ).status_code
        == 200
    )
    assert (
        client.put(
            "/api/v1/snapshots/bulk",
            json={"snapshotDate": "2026-07-29", "rows": [snapshot_row(cny_id, "1200")]},
        ).status_code
        == 200
    )
    assert (
        client.put(
            "/api/v1/snapshots/bulk",
            json={"snapshotDate": "2026-08-01", "rows": [snapshot_row(cny_id, "1250")]},
        ).status_code
        == 200
    )
    assert (
        client.put(
            "/api/v1/snapshots/bulk",
            json={"snapshotDate": "2026-08-05", "rows": [snapshot_row(cny_id, "1300")]},
        ).status_code
        == 200
    )

    summary = client.get("/api/v1/dashboard/summary", params={"snapshotDate": "2026-08-05"})
    assert summary.status_code == 200
    assert summary.json()["total_assets_cny"] == "1300.000000"
    assert summary.json()["net_worth_cny"] == "1300.000000"
    assert summary.json()["net_worth_change_from_previous_month_cny"] == "100.000000"

    charts = client.get(
        "/api/v1/dashboard/charts", params={"snapshotDate": "2026-08-05"}
    ).json()
    assert len(charts["trend"]) == 12
    assert charts["trend"][-3:] == [
        {"date": "2026-06-30", "value": "1700.000000"},
        {"date": "2026-07-31", "value": "1200.000000"},
        {"date": "2026-08-05", "value": "1300.000000"},
    ]
    assert charts["top_institutions"] == [
        {"name": "Dashboard Bank", "value": "1300.000000"}
    ]

    charts_24_months = client.get(
        "/api/v1/dashboard/charts",
        params={"snapshotDate": "2026-08-05", "trendRange": "24m"},
    ).json()
    assert len(charts_24_months["trend"]) == 24
    assert charts_24_months["trend"][-1] == {
        "date": "2026-08-05",
        "value": "1300.000000",
    }

    charts_all = client.get(
        "/api/v1/dashboard/charts",
        params={"snapshotDate": "2026-08-05", "trendRange": "all"},
    ).json()
    assert charts_all["trend"] == [
        {"date": "2026-06-30", "value": "1700.000000"},
        {"date": "2026-07-31", "value": "1200.000000"},
        {"date": "2026-08-05", "value": "1300.000000"},
    ]
    assert (
        client.get(
            "/api/v1/dashboard/charts",
            params={"snapshotDate": "2026-08-05", "trendRange": "invalid"},
        ).status_code
        == 422
    )

    assert client.post(f"/api/v1/projects/{usd_id}/deactivate").status_code == 200
    with get_session_factory()() as db:
        account = db.scalar(select(Account))
        institution = db.scalar(select(Institution))
        assert account is not None
        assert institution is not None
        account.is_active = False
        institution.is_active = False
        db.commit()

    disabled_summary = client.get(
        "/api/v1/dashboard/summary", params={"snapshotDate": "2026-08-05"}
    ).json()
    assert disabled_summary["total_assets_cny"] == "1300.000000"
    disabled_charts = client.get(
        "/api/v1/dashboard/charts", params={"snapshotDate": "2026-08-05"}
    ).json()
    assert disabled_charts["trend"][-3:] == [
        {"date": "2026-06-30", "value": "1700.000000"},
        {"date": "2026-07-31", "value": "1200.000000"},
        {"date": "2026-08-05", "value": "1300.000000"},
    ]
