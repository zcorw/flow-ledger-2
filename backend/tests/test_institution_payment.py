import copy
import csv
import io
import uuid
import zipfile
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, select, text

from alembic import command
from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models.institution import Institution
from app.models.user import User
from app.services.backup import (
    build_backup_payload,
    restore_backup_payload,
    validate_backup_payload,
)
from app.services.imports import _hierarchy, parse_csv, template_csv, validate_rows
from app.services.master_data_export import build_master_data_export
from tests.test_expenses import bootstrap, payload


def test_payment_eligibility_history_replay_and_legacy_update(client):
    bootstrap(client)
    institution = client.post(
        "/api/v1/institutions",
        json={
            "name": "Payment bank",
            "institutionType": "bank",
        },
    ).json()
    assert institution["can_be_payment_account"] is True
    account = client.post(
        "/api/v1/accounts",
        json={
            "name": "Card",
            "accountType": "savings",
            "institutionId": institution["id"],
        },
    ).json()
    standalone = client.post(
        "/api/v1/accounts",
        json={
            "name": "Independent",
            "accountType": "cash_wallet",
        },
    ).json()
    value = payload(accountId=account["id"])
    saved = client.post("/api/v1/expenses", json=value)
    assert saved.status_code == 201
    update = {
        "name": "Payment bank",
        "institutionType": "bank",
        "isActive": True,
        "canBePaymentAccount": False,
    }
    changed = client.put(f"/api/v1/institutions/{institution['id']}", json=update)
    assert changed.json()["can_be_payment_account"] is False
    assert changed.json()["is_active"] is True
    del update["canBePaymentAccount"]
    assert (
        client.put(f"/api/v1/institutions/{institution['id']}", json=update).json()[
            "can_be_payment_account"
        ]
        is False
    )
    options = {x["id"]: x for x in client.get("/api/v1/expenses/accounts").json()}
    assert options[account["id"]]["can_be_payment_account"] is False
    assert options[account["id"]]["institution_name"] == "Payment bank"
    assert options[standalone["id"]]["can_be_payment_account"] is True
    assert client.post("/api/v1/expenses", json=value).status_code == 200
    assert (
        client.post("/api/v1/expenses", json={**value, "requestKey": str(uuid.uuid4())}).status_code
        == 400
    )
    fields = {k: v for k, v in value.items() if k != "requestKey"}
    assert (
        client.put(
            f"/api/v1/expenses/{saved.json()['id']}",
            json={
                **fields,
                "note": "Historical edit",
            },
        ).status_code
        == 200
    )
    fields["accountId"] = standalone["id"]
    assert client.put(f"/api/v1/expenses/{saved.json()['id']}", json=fields).status_code == 200
    fields["accountId"] = account["id"]
    assert client.put(f"/api/v1/expenses/{saved.json()['id']}", json=fields).status_code == 400
    assert (
        client.post("/api/v1/expenses", json=payload(accountId=None, amount="1")).status_code == 201
    )
    assert (
        client.post(
            "/api/v1/expenses", json=payload(accountId=standalone["id"], amount="2")
        ).status_code
        == 201
    )


def test_backup_csv_and_old_backup_default(client):
    bootstrap(client)
    client.post(
        "/api/v1/institutions",
        json={
            "name": "Investment only",
            "institutionType": "broker",
            "canBePaymentAccount": False,
        },
    )
    with get_session_factory()() as db:
        uid = db.scalar(select(User.id))
        backup = build_backup_payload(db, uid)
        validate_backup_payload(backup)
        restore_backup_payload(db, uid, backup)
        db.commit()
        assert (
            db.scalar(
                select(Institution).where(Institution.name == "Investment only")
            ).can_be_payment_account
            is False
        )
        exported = build_master_data_export(db, uid)
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            rows = list(
                csv.DictReader(io.StringIO(archive.read("institutions.csv").decode("utf-8-sig")))
            )
            assert (
                next(x for x in rows if x["name"] == "Investment only")["can_be_payment_account"]
                == "false"
            )
        old = copy.deepcopy(backup)
        for row in old["tables"]["institutions"]:
            row.pop("can_be_payment_account")
        validate_backup_payload(old)
        restore_backup_payload(db, uid, old)
        db.commit()
        assert all(x.can_be_payment_account for x in db.scalars(select(Institution)))
        backup["tables"]["institutions"][0]["can_be_payment_account"] = "false"
        with pytest.raises(ValueError):
            validate_backup_payload(backup)
        rows, errors = parse_csv(
            "institution_account_project",
            template_csv("institution_account_project").encode("utf-8"),
        )
        assert not errors
        rows = [rows[0]]
        rows[0]["institution_name"] = "Imported"
        rows[0]["can_be_payment_account"] = "false"
        assert not validate_rows(db, uid, "institution_account_project", rows)
        _hierarchy(db, uid, rows)
        assert (
            db.scalar(
                select(Institution).where(Institution.name == "Imported")
            ).can_be_payment_account
            is False
        )
        rows[0]["can_be_payment_account"] = "invalid"
        assert validate_rows(db, uid, "institution_account_project", rows)


def test_old_csv_template_and_nonboolean_flag(client):
    bootstrap(client)
    assert (
        client.post(
            "/api/v1/institutions",
            json={
                "name": "Bad",
                "institutionType": "bank",
                "canBePaymentAccount": "false",
            },
        ).status_code
        == 422
    )
    current = template_csv("institution_account_project")
    rows = list(csv.reader(io.StringIO(current.lstrip("\ufeff"))))
    index = rows[0].index("can_be_payment_account")
    old = io.StringIO()
    writer = csv.writer(old)
    for row in rows:
        if len(row) > index:
            del row[index]
        writer.writerow(row)
    parsed, errors = parse_csv("institution_account_project", old.getvalue().encode())
    assert not errors
    assert parsed[0]["can_be_payment_account"] == ""
    with get_session_factory()() as db:
        uid = db.scalar(select(User.id))
        _hierarchy(db, uid, parsed)
        assert all(x.can_be_payment_account for x in db.scalars(select(Institution)))


def test_migration_preserves_existing_institutions(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[1]
    url = f"sqlite+pysqlite:///{(tmp_path / 'payment.db').as_posix()}"
    monkeypatch.setattr(get_settings(), "database_url", url)
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    command.upgrade(config, "0015_device_expense_grants")
    engine = create_engine(url)
    with engine.begin() as db:
        db.execute(
            text(
                "INSERT INTO institutions "
                "(id,user_id,name,institution_type,is_active,created_at,updated_at) "
                "VALUES (:id,:uid,'Old','bank',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
            ),
            {"id": uuid.uuid4().hex, "uid": uuid.uuid4().hex},
        )
    command.upgrade(config, "head")
    with engine.connect() as db:
        assert db.execute(
            text("SELECT can_be_payment_account,is_active FROM institutions")
        ).one() == (1, 0)
    command.check(config)
    command.downgrade(config, "0015_device_expense_grants")
    command.upgrade(config, "head")
    engine.dispose()
