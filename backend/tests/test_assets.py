from fastapi.testclient import TestClient


def bootstrap(client: TestClient) -> None:
    response = client.post(
        "/api/v1/setup/bootstrap",
        json={
            "bootstrapToken": "test-bootstrap-token",
            "displayName": "Asset Admin",
            "email": "assets@example.com",
            "password": "correct-horse-battery-staple",
        },
    )
    assert response.status_code == 201


def test_asset_hierarchy_crud_uniqueness_and_deactivation(client: TestClient) -> None:
    bootstrap(client)
    institutions = client.get("/api/v1/institutions")
    assert institutions.status_code == 200
    cash = institutions.json()[0]
    assert cash["name"] == "现金"
    assert cash["institution_type"] == "cash"

    bank_payload = {
        "name": "招商银行",
        "institutionType": "bank",
        "displayColor": "#b3261e",
        "isActive": True,
    }
    bank = client.post("/api/v1/institutions", json=bank_payload)
    assert bank.status_code == 201
    bank_id = bank.json()["id"]
    assert client.post("/api/v1/institutions", json=bank_payload).status_code == 409

    invalid_number = client.post(
        "/api/v1/accounts",
        json={
            "institutionId": bank_id,
            "name": "完整卡号",
            "accountType": "savings",
            "maskedIdentifier": "6225888888888888",
        },
    )
    assert invalid_number.status_code == 422

    account_payload = {
        "institutionId": bank_id,
        "name": "工资卡",
        "accountType": "savings",
        "maskedIdentifier": "尾号 8888",
        "displayColor": "#d97706",
        "isActive": True,
    }
    account = client.post("/api/v1/accounts", json=account_payload)
    assert account.status_code == 201
    account_id = account.json()["id"]
    assert client.post("/api/v1/accounts", json=account_payload).status_code == 409

    project_payload = {
        "accountId": account_id,
        "name": "活期余额",
        "assetType": "bank_deposit",
        "currencyCode": "CNY",
        "defaultLiquidityLevel": "t0",
        "defaultRiskLevel": "low",
        "notes": "日常资金",
    }
    project = client.post("/api/v1/projects", json=project_payload)
    assert project.status_code == 201
    project_id = project.json()["id"]
    assert client.post("/api/v1/projects", json=project_payload).status_code == 409

    disabled_currency = client.post(
        "/api/v1/projects", json={**project_payload, "name": "英镑", "currencyCode": "GBP"}
    )
    assert disabled_currency.status_code == 400
    assert disabled_currency.json()["error"]["code"] == "CURRENCY_NOT_ENABLED"

    deactivate = client.post(f"/api/v1/projects/{project_id}/deactivate")
    assert deactivate.status_code == 200
    assert deactivate.json()["is_active"] is False
    history = client.get(f"/api/v1/accounts/{account_id}/projects")
    assert history.status_code == 200
    assert history.json()[0]["id"] == project_id
    assert history.json()[0]["is_active"] is False

    accounts = client.get(f"/api/v1/institutions/{bank_id}/accounts").json()
    assert accounts[0]["project_count"] == 1
    institutions = client.get("/api/v1/institutions").json()
    bank_summary = next(item for item in institutions if item["id"] == bank_id)
    assert bank_summary["account_count"] == 1
    assert bank_summary["project_count"] == 1


def test_cash_wallet_and_owner_boundaries(client: TestClient) -> None:
    bootstrap(client)
    cash = client.get("/api/v1/institutions").json()[0]
    wallet = client.post(
        "/api/v1/accounts",
        json={
            "institutionId": cash["id"],
            "name": "人民币现金",
            "accountType": "cash_wallet",
            "maskedIdentifier": "家用备用金",
        },
    )
    assert wallet.status_code == 201
    missing = client.get("/api/v1/institutions/00000000-0000-0000-0000-000000000000/accounts")
    assert missing.status_code == 404


def test_account_can_be_created_then_associated_with_an_institution(
    client: TestClient,
) -> None:
    bootstrap(client)
    cash = client.get("/api/v1/institutions").json()[0]
    account_payload = {
        "name": "待整理账户",
        "accountType": "savings",
        "maskedIdentifier": "尾号 1357",
        "isActive": True,
    }

    account = client.post("/api/v1/accounts", json=account_payload)
    assert account.status_code == 201
    account_id = account.json()["id"]
    assert account.json()["institution_id"] is None
    assert client.post("/api/v1/accounts", json=account_payload).status_code == 409

    unassigned = client.get("/api/v1/accounts/unassigned")
    assert unassigned.status_code == 200
    assert unassigned.json()[0]["id"] == account_id

    project = client.post(
        "/api/v1/projects",
        json={
            "accountId": account_id,
            "name": "待关联余额",
            "assetType": "bank_deposit",
            "currencyCode": "CNY",
            "defaultLiquidityLevel": "t0",
            "defaultRiskLevel": "low",
        },
    )
    assert project.status_code == 201
    project_id = project.json()["id"]
    snapshot = client.get("/api/v1/snapshots", params={"date": "2026-07-31"})
    assert all(item["project_id"] != project_id for item in snapshot.json()["rows"])

    associated_payload = {**account_payload, "institutionId": cash["id"]}
    associated = client.put(f"/api/v1/accounts/{account_id}", json=associated_payload)
    assert associated.status_code == 200
    assert associated.json()["institution_id"] == cash["id"]
    assert client.get("/api/v1/accounts/unassigned").json() == []
    assert client.get(f"/api/v1/institutions/{cash['id']}/accounts").json()[0]["id"] == account_id

    snapshot = client.get("/api/v1/snapshots", params={"date": "2026-07-31"})
    assert any(item["project_id"] == project_id for item in snapshot.json()["rows"])

    unlinked = client.put(
        f"/api/v1/accounts/{account_id}",
        json={**account_payload, "institutionId": None},
    )
    assert unlinked.status_code == 200
    assert unlinked.json()["institution_id"] is None
    snapshot = client.get("/api/v1/snapshots", params={"date": "2026-07-31"})
    assert all(item["project_id"] != project_id for item in snapshot.json()["rows"])
