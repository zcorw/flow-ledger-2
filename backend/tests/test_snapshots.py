from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db.session import get_session_factory
from app.models.audit import AuditLog
from app.models.fx import FxRate


def bootstrap_hierarchy(client: TestClient) -> tuple[str, str, str, str]:
    assert (
        client.post(
            "/api/v1/setup/bootstrap",
            json={
                "bootstrapToken": "test-bootstrap-token",
                "displayName": "Snapshot Admin",
                "email": "snapshots@example.com",
                "password": "correct-horse-battery-staple",
            },
        ).status_code
        == 201
    )
    institution = client.post(
        "/api/v1/institutions",
        json={"name": "Test Bank", "institutionType": "bank", "isActive": True},
    ).json()
    account = client.post(
        "/api/v1/accounts",
        json={
            "institutionId": institution["id"],
            "name": "Assets",
            "accountType": "savings",
            "maskedIdentifier": "Tail 1234",
        },
    ).json()

    def project(name: str, currency: str) -> str:
        return client.post(
            "/api/v1/projects",
            json={
                "accountId": account["id"],
                "name": name,
                "assetType": "bank_deposit",
                "currencyCode": currency,
                "defaultLiquidityLevel": "t0",
                "defaultRiskLevel": "low",
            },
        ).json()["id"]

    return (
        project("CNY Balance", "CNY"),
        project("USD Balance", "USD"),
        account["id"],
        institution["id"],
    )


def test_snapshot_batch_rates_copy_changes_and_audit(client: TestClient) -> None:
    cny_id, usd_id, _, _ = bootstrap_hierarchy(client)
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

    rows = [
        {
            "projectId": cny_id,
            "originalAmount": "1000.00",
            "liquidityLevel": "t0",
            "riskLevel": "low",
            "changeNote": "",
        },
        {
            "projectId": usd_id,
            "originalAmount": "100.00",
            "liquidityLevel": "within_7d",
            "riskLevel": "medium",
            "changeNote": "USD savings",
        },
    ]
    duplicate = client.put(
        "/api/v1/snapshots/bulk",
        json={"snapshotDate": "2026-07-31", "rows": [rows[0], rows[0]]},
    )
    assert duplicate.status_code == 400
    saved = client.put(
        "/api/v1/snapshots/bulk",
        json={"snapshotDate": "2026-07-31", "rows": rows},
    )
    assert saved.status_code == 200
    sheet = saved.json()
    assert sheet["missing_project_ids"] == []
    usd = next(item for item in sheet["rows"] if item["project_id"] == usd_id)
    assert usd["converted_amount_cny"] == "700.000000"
    assert usd["fx_is_stale"] is True

    copied = client.post("/api/v1/snapshots/copy-from-previous", json={"targetDate": "2026-08-31"})
    assert copied.status_code == 200
    assert copied.json()["source_date"] == "2026-07-31"
    assert copied.json()["missing_project_ids"] == []

    changed_rows = [{**rows[0], "originalAmount": "40000"}, rows[1]]
    changed = client.put(
        "/api/v1/snapshots/bulk",
        json={"snapshotDate": "2026-08-31", "rows": changed_rows},
    )
    assert changed.status_code == 200
    warning_ids = {item["project_id"] for item in changed.json()["warnings"]}
    assert cny_id in warning_ids

    rows[0]["originalAmount"] = "1200"
    assert (
        client.put(
            "/api/v1/snapshots/bulk",
            json={"snapshotDate": "2026-07-31", "rows": rows},
        ).status_code
        == 200
    )
    with get_session_factory()() as db:
        updates = db.scalar(
            select(func.count(AuditLog.id)).where(AuditLog.action == "snapshot.update")
        )
        assert updates == 2


def test_snapshot_missing_rate_and_inactive_history(client: TestClient) -> None:
    cny_id, _, account_id, _ = bootstrap_hierarchy(client)
    jpy = client.post(
        "/api/v1/projects",
        json={
            "accountId": account_id,
            "name": "JPY Cash",
            "assetType": "cash",
            "currencyCode": "JPY",
            "defaultLiquidityLevel": "t0",
            "defaultRiskLevel": "low",
        },
    ).json()
    missing_rate = client.put(
        "/api/v1/snapshots/bulk",
        json={
            "snapshotDate": "2026-07-31",
            "rows": [
                {
                    "projectId": jpy["id"],
                    "originalAmount": "1000",
                    "liquidityLevel": "t0",
                    "riskLevel": "low",
                }
            ],
        },
    )
    assert missing_rate.status_code == 409
    assert missing_rate.json()["error"]["code"] == "FX_RATE_MISSING"

    row = {
        "projectId": cny_id,
        "originalAmount": "500",
        "liquidityLevel": "t0",
        "riskLevel": "low",
    }
    assert (
        client.put(
            "/api/v1/snapshots/bulk", json={"snapshotDate": "2026-07-31", "rows": [row]}
        ).status_code
        == 200
    )
    assert client.post(f"/api/v1/projects/{cny_id}/deactivate").status_code == 200
    historical = client.get("/api/v1/snapshots", params={"date": "2026-07-31"}).json()
    assert any(item["project_id"] == cny_id for item in historical["rows"])
    current = client.get("/api/v1/snapshots", params={"date": "2026-09-30"}).json()
    assert all(item["project_id"] != cny_id for item in current["rows"])


def test_inactive_parent_hides_descendants_and_rejects_snapshot_writes(
    client: TestClient,
) -> None:
    cny_id, usd_id, account_id, institution_id = bootstrap_hierarchy(client)
    row = {
        "projectId": cny_id,
        "originalAmount": "500",
        "liquidityLevel": "t0",
        "riskLevel": "low",
    }
    assert (
        client.put(
            "/api/v1/snapshots/bulk",
            json={"snapshotDate": "2026-07-31", "rows": [row]},
        ).status_code
        == 200
    )

    institution_payload = {
        "name": "Test Bank",
        "institutionType": "bank",
        "isActive": False,
    }
    deactivated = client.put(
        f"/api/v1/institutions/{institution_id}", json=institution_payload
    )
    assert deactivated.status_code == 200

    historical = client.get("/api/v1/snapshots", params={"date": "2026-07-31"}).json()
    current = client.get("/api/v1/snapshots", params={"date": "2026-09-30"}).json()
    assert {cny_id, usd_id}.isdisjoint(item["project_id"] for item in historical["rows"])
    assert {cny_id, usd_id}.isdisjoint(item["project_id"] for item in current["rows"])

    rejected = client.put(
        "/api/v1/snapshots/bulk",
        json={"snapshotDate": "2026-07-31", "rows": [row]},
    )
    assert rejected.status_code == 400
    assert rejected.json()["error"]["code"] == "INSTITUTION_INACTIVE"

    import_content = "\n".join(
        [
            "snapshot_date,institution_name,account_name,project_name,original_amount,"
            "liquidity_level,risk_level,change_note",
            "2026-08-31,Test Bank,Assets,CNY Balance,600,t0,low,",
        ]
    )
    import_job = client.post(
        "/api/v1/imports/monthly_snapshot/validate",
        files={"file": ("snapshot.csv", import_content.encode(), "text/csv")},
    ).json()
    assert import_job["status"] == "invalid"
    assert any(error["field"] == "project_name" for error in import_job["error_report"])

    institution_payload["isActive"] = True
    assert (
        client.put(
            f"/api/v1/institutions/{institution_id}", json=institution_payload
        ).status_code
        == 200
    )
    restored = client.get("/api/v1/snapshots", params={"date": "2026-07-31"}).json()
    assert any(item["project_id"] == cny_id for item in restored["rows"])

    account_payload = {
        "institutionId": institution_id,
        "name": "Assets",
        "accountType": "savings",
        "maskedIdentifier": "Tail 1234",
        "isActive": False,
    }
    assert (
        client.put(f"/api/v1/accounts/{account_id}", json=account_payload).status_code
        == 200
    )
    hidden_by_account = client.get(
        "/api/v1/snapshots", params={"date": "2026-07-31"}
    ).json()
    assert hidden_by_account["rows"] == []
    rejected = client.put(
        "/api/v1/snapshots/bulk",
        json={"snapshotDate": "2026-07-31", "rows": [row]},
    )
    assert rejected.status_code == 400
    assert rejected.json()["error"]["code"] == "ACCOUNT_INACTIVE"


def test_history_uses_current_hierarchy_and_keeps_inactive_records_visible(
    client: TestClient,
) -> None:
    cny_id, _, account_id, original_institution_id = bootstrap_hierarchy(client)
    for snapshot_date, amount in (("2026-07-31", "100"), ("2026-08-31", "150")):
        saved = client.put(
            "/api/v1/snapshots/bulk",
            json={
                "snapshotDate": snapshot_date,
                "rows": [
                    {
                        "projectId": cny_id,
                        "originalAmount": amount,
                        "liquidityLevel": "t0",
                        "riskLevel": "low",
                    }
                ],
            },
        )
        assert saved.status_code == 200

    institution_history = client.get(
        "/api/v1/snapshots/history",
        params={"level": "institution", "entityId": original_institution_id},
    )
    assert institution_history.status_code == 200
    history = institution_history.json()
    assert history["latest_amount_cny"] == "150.000000"
    assert history["latest_change_amount_cny"] == "50.000000"
    assert history["max_amount_cny"] == "150.000000"
    assert history["min_amount_cny"] == "100.000000"
    assert history["snapshot_count"] == 2
    assert history["record_count"] == 2
    assert history["composition"][0]["name"] == "Assets"
    assert history["rows"][0]["change_amount_cny"] == "50.000000"

    filtered = client.get(
        "/api/v1/snapshots/history",
        params={
            "level": "account",
            "entityId": account_id,
            "dateFrom": "2026-08-01",
            "dateTo": "2026-08-31",
        },
    ).json()
    assert filtered["snapshot_count"] == 1
    assert filtered["latest_change_amount_cny"] == "50.000000"
    assert filtered["composition"][0]["name"] == "CNY Balance"

    project_history = client.get(
        "/api/v1/snapshots/history",
        params={"level": "project", "entityId": cny_id},
    ).json()
    assert project_history["composition"] == []
    assert project_history["rows"][0]["project_name"] == "CNY Balance"

    corrected_institution = client.post(
        "/api/v1/institutions",
        json={"name": "Correct Bank", "institutionType": "bank", "isActive": True},
    ).json()
    account_payload = {
        "institutionId": corrected_institution["id"],
        "name": "Assets",
        "accountType": "savings",
        "maskedIdentifier": "Tail 1234",
        "isActive": True,
    }
    assert client.put(f"/api/v1/accounts/{account_id}", json=account_payload).status_code == 200

    old_history = client.get(
        "/api/v1/snapshots/history",
        params={"level": "institution", "entityId": original_institution_id},
    ).json()
    corrected_history = client.get(
        "/api/v1/snapshots/history",
        params={"level": "institution", "entityId": corrected_institution["id"]},
    ).json()
    assert old_history["rows"] == []
    assert len(corrected_history["rows"]) == 2

    assert client.put(
        f"/api/v1/institutions/{corrected_institution['id']}",
        json={"name": "Correct Bank", "institutionType": "bank", "isActive": False},
    ).status_code == 200
    account_payload["isActive"] = False
    assert client.put(f"/api/v1/accounts/{account_id}", json=account_payload).status_code == 200
    assert client.post(f"/api/v1/projects/{cny_id}/deactivate").status_code == 200
    inactive_history = client.get(
        "/api/v1/snapshots/history",
        params={"level": "institution", "entityId": corrected_institution["id"]},
    ).json()
    assert len(inactive_history["rows"]) == 2
