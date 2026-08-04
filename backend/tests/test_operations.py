import csv
import io
import json
import uuid
import zipfile

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db.session import get_session_factory
from app.models.audit import AuditLog
from app.models.operations import BackupExport
from app.services.imports import EXAMPLES, parse_csv

PASSWORD = "correct-horse-battery-staple"


def bootstrap(client: TestClient) -> None:
    response = client.post(
        "/api/v1/setup/bootstrap",
        json={
            "bootstrapToken": "test-bootstrap-token",
            "displayName": "Operations Admin",
            "email": "operations@example.com",
            "password": PASSWORD,
        },
    )
    assert response.status_code == 201


def csv_upload(client: TestClient, import_type: str, content: str):
    return client.post(
        f"/api/v1/imports/{import_type}/validate",
        files={"file": (f"{import_type}.csv", content.encode(), "text/csv")},
    )


def commit(client: TestClient, import_type: str, job_id: str):
    return client.post(
        f"/api/v1/imports/{import_type}/commit",
        json={"jobId": job_id},
    )


def hierarchy_csv(bank: str = "Imported Bank") -> str:
    return "\n".join(
        [
            "record_type,institution_name,account_name,project_name,institution_type,"
            "account_type,asset_type,currency_code,masked_identifier,liquidity_level,"
            "risk_level,notes",
            ",".join(["institution", bank, "", "", "bank", "", "", "", "", "", "", ""]),
            ",".join(
                [
                    "account",
                    bank,
                    "Imported Account",
                    "",
                    "",
                    "savings",
                    "",
                    "",
                    "尾号 2468",
                    "",
                    "",
                    "",
                ]
            ),
            ",".join(
                [
                    "project",
                    bank,
                    "Imported Account",
                    "Imported Project",
                    "",
                    "",
                    "bank_deposit",
                    "CNY",
                    "",
                    "t0",
                    "low",
                    "",
                ]
            ),
        ]
    )


def test_three_import_types_and_error_reports(client: TestClient) -> None:
    assert client.get("/api/v1/imports/templates/monthly_snapshot").status_code == 401
    bootstrap(client)
    expected_references = {
        "institution_account_project": [
            "record_type（记录类型）",
            "institution_type（机构类型）",
            "account_type（账户类型）",
            "asset_type（资产类型）",
        ],
        "monthly_snapshot": ["liquidity_level（流动性）", "risk_level（风险等级）"],
        "debt_event": ["debt_type（债权债务类型）", "event_type（事件类型）"],
    }
    for import_type, references in expected_references.items():
        template = client.get(f"/api/v1/imports/templates/{import_type}")
        assert template.status_code == 200
        assert template.content.startswith(b"\xef\xbb\xbf")
        template_text = template.content.decode("utf-8-sig")
        assert all(reference in template_text for reference in references)
        rows, errors = parse_csv(import_type, template.content)
        assert errors == []
        assert len(rows) == len(EXAMPLES[import_type])

    missing_columns = csv_upload(
        client,
        "monthly_snapshot",
        "snapshot_date,project_name\n2026-07-31,Missing\n",
    )
    assert missing_columns.status_code == 200
    invalid = missing_columns.json()
    assert invalid["status"] == "invalid"
    assert {error["field"] for error in invalid["error_report"]} >= {
        "institution_name",
        "original_amount",
    }
    assert all(error["row"] == 1 for error in invalid["error_report"])

    hierarchy = csv_upload(client, "institution_account_project", hierarchy_csv())
    assert hierarchy.status_code == 200
    assert hierarchy.json()["status"] == "validated"
    saved_hierarchy = commit(client, "institution_account_project", hierarchy.json()["id"])
    assert saved_hierarchy.status_code == 200
    assert saved_hierarchy.json()["status"] == "committed"

    snapshots = "\n".join(
        [
            "snapshot_date,institution_name,account_name,project_name,original_amount,"
            "liquidity_level,risk_level,change_note",
            "2026-07-31,Imported Bank,Imported Account,Imported Project,12345.67,"
            "t0,low,Imported snapshot",
        ]
    )
    snapshot_job = csv_upload(client, "monthly_snapshot", snapshots)
    assert snapshot_job.json()["status"] == "validated"
    assert commit(client, "monthly_snapshot", snapshot_job.json()["id"]).status_code == 200
    sheet = client.get("/api/v1/snapshots", params={"date": "2026-07-31"}).json()
    imported = next(row for row in sheet["rows"] if row["project_name"] == "Imported Project")
    assert imported["original_amount"] == "12345.670000"

    debts = "\n".join(
        [
            "debt_type,counterparty,currency_code,event_type,event_date,amount,note",
            "receivable,Imported Friend,CNY,issue,2026-07-01,5000,Imported debt",
        ]
    )
    debt_job = csv_upload(client, "debt_event", debts)
    assert debt_job.json()["status"] == "validated"
    assert commit(client, "debt_event", debt_job.json()["id"]).status_code == 200
    balances = client.get("/api/v1/debts/balances", params={"snapshotDate": "2026-07-31"}).json()
    debt = next(row for row in balances["items"] if row["counterparty"] == "Imported Friend")
    assert debt["balance"] == "5000.000000"


def test_conflict_after_validation_rejects_whole_batch(client: TestClient) -> None:
    bootstrap(client)
    content = "\n".join(
        [
            "record_type,institution_name,account_name,project_name,institution_type,"
            "account_type,asset_type,currency_code,masked_identifier,liquidity_level,"
            "risk_level,notes",
            ",".join(["institution", "Atomic First", "", "", "bank", "", "", "", "", "", "", ""]),
            ",".join(
                [
                    "institution",
                    "Atomic Conflict",
                    "",
                    "",
                    "bank",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                    "",
                ]
            ),
        ]
    )
    job = csv_upload(client, "institution_account_project", content).json()
    assert job["status"] == "validated"
    created = client.post(
        "/api/v1/institutions",
        json={"name": "Atomic Conflict", "institutionType": "bank", "isActive": True},
    )
    assert created.status_code == 201

    rejected = commit(client, "institution_account_project", job["id"])
    assert rejected.status_code == 409
    assert rejected.json()["error"]["details"] == [
        {
            "row": 3,
            "field": "institution_name",
            "reason": "机构已存在或文件内重复",
        }
    ]
    names = {item["name"] for item in client.get("/api/v1/institutions").json()}
    assert "Atomic First" not in names
    assert "Atomic Conflict" in names


def test_master_data_export_contains_hierarchy_and_unassigned_accounts(
    client: TestClient,
) -> None:
    assert client.post("/api/v1/exports/master-data").status_code == 401
    bootstrap(client)
    institution = client.post(
        "/api/v1/institutions",
        json={
            "name": "Export Bank",
            "institutionType": "bank",
            "displayColor": "#397c93",
            "isActive": True,
        },
    ).json()
    account = client.post(
        "/api/v1/accounts",
        json={
            "institutionId": institution["id"],
            "name": "Export Account",
            "accountType": "savings",
            "maskedIdentifier": "尾号 1357",
            "displayColor": "#66558c",
            "isActive": True,
        },
    ).json()
    project = client.post(
        "/api/v1/projects",
        json={
            "accountId": account["id"],
            "name": "Export Project",
            "assetType": "bank_deposit",
            "currencyCode": "CNY",
            "defaultLiquidityLevel": "t0",
            "defaultRiskLevel": "low",
            "notes": "用于导出测试",
            "isActive": True,
        },
    ).json()
    unassigned = client.post(
        "/api/v1/accounts",
        json={
            "institutionId": None,
            "name": "Later Account",
            "accountType": "other",
            "maskedIdentifier": "待关联",
            "isActive": False,
        },
    ).json()

    response = client.post("/api/v1/exports/master-data")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "flow-ledger-master-data.zip" in response.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert set(archive.namelist()) == {
            "institutions.csv",
            "accounts.csv",
            "projects.csv",
        }
        for name in archive.namelist():
            assert archive.read(name).startswith(b"\xef\xbb\xbf")
        institutions = list(
            csv.DictReader(io.StringIO(archive.read("institutions.csv").decode("utf-8-sig")))
        )
        accounts = list(
            csv.DictReader(io.StringIO(archive.read("accounts.csv").decode("utf-8-sig")))
        )
        projects = list(
            csv.DictReader(io.StringIO(archive.read("projects.csv").decode("utf-8-sig")))
        )

    institution_row = next(
        item for item in institutions if item["institution_id"] == institution["id"]
    )
    assert institution_row["display_color"] == "#397c93"
    account_row = next(item for item in accounts if item["account_id"] == account["id"])
    assert account_row["institution_id"] == institution["id"]
    assert account_row["institution_name"] == "Export Bank"
    unassigned_row = next(item for item in accounts if item["account_id"] == unassigned["id"])
    assert unassigned_row["institution_id"] == ""
    assert unassigned_row["institution_name"] == ""
    assert unassigned_row["is_active"] == "false"
    project_row = next(item for item in projects if item["project_id"] == project["id"])
    assert project_row["account_id"] == account["id"]
    assert project_row["institution_id"] == institution["id"]
    assert project_row["notes"] == "用于导出测试"

    with get_session_factory()() as db:
        export_log = db.scalar(
            select(AuditLog)
            .where(AuditLog.action == "master_data.export")
            .order_by(AuditLog.created_at.desc())
        )
        assert export_log is not None
        assert export_log.after_data["accountCount"] >= 2


def test_backup_restore_reauthentication_prebackup_and_consistency(
    client: TestClient,
) -> None:
    bootstrap(client)
    imported = csv_upload(client, "institution_account_project", hierarchy_csv())
    assert commit(client, "institution_account_project", imported.json()["id"]).status_code == 200
    names_before = {item["name"] for item in client.get("/api/v1/institutions").json()}

    exported = client.post("/api/v1/backups/export")
    assert exported.status_code == 200
    assert exported.headers["x-backup-checksum"]
    backup_json = json.loads(exported.content)
    assert set(backup_json["tables"]) >= {"institutions", "monthly_snapshots", "audit_logs"}
    uploaded = client.post(
        "/api/v1/backups/upload",
        files={"file": ("backup.json", exported.content, "application/json")},
    )
    assert uploaded.status_code == 200
    backup_id = uploaded.json()["id"]

    mutation = client.post(
        "/api/v1/institutions",
        json={"name": "After Backup", "institutionType": "other", "isActive": True},
    )
    assert mutation.status_code == 201
    denied = client.post(
        "/api/v1/backups/restore",
        json={"backupFileId": backup_id, "password": "wrong-password"},
    )
    assert denied.status_code == 403
    assert "After Backup" in {item["name"] for item in client.get("/api/v1/institutions").json()}

    restored = client.post(
        "/api/v1/backups/restore",
        json={"backupFileId": backup_id, "password": PASSWORD},
    )
    assert restored.status_code == 200
    assert restored.json()["restored_from_id"] == backup_id
    names_after = {item["name"] for item in client.get("/api/v1/institutions").json()}
    assert names_after == names_before
    assert "After Backup" not in names_after

    with get_session_factory()() as db:
        prebackup = db.get(BackupExport, uuid.UUID(restored.json()["pre_restore_backup_id"]))
        assert prebackup is not None and prebackup.purpose == "pre-restore"
        restore_logs = db.scalar(
            select(func.count(AuditLog.id)).where(AuditLog.action == "backup.restore")
        )
        assert restore_logs == 1
