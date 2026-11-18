import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from alembic.config import Config
from sqlalchemy import MetaData, Table, create_engine, inspect, select
from sqlalchemy.orm import Session

from alembic import command
from app.core.config import get_settings
from app.models.receipt_device import ReceiptDevice
from app.models.user import User
from app.services.receipt_device import as_utc


def test_persistent_device_upgrade_preserves_finite_grants_and_rollback_invalidates_permanent(
    tmp_path, monkeypatch
):
    root = Path(__file__).resolve().parents[1]
    url = f"sqlite+pysqlite:///{(tmp_path / 'device-migration.db').as_posix()}"
    monkeypatch.setattr(get_settings(), "database_url", url)
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    command.upgrade(config, "0011_receipt_devices")
    engine = create_engine(url)
    finite_until = datetime.now(UTC) + timedelta(minutes=15)
    with Session(engine) as db:
        user = User(
            email="migration@example.com", display_name="Synthetic", password_hash="synthetic"
        )
        db.add(user)
        db.flush()
        owner_id = user.id
        legacy = Table("receipt_devices", MetaData(), autoload_with=engine)
        db.execute(
            legacy.insert().values(
                id=uuid.uuid4().hex,
                user_id=owner_id.hex,
                token_hash="a" * 64,
                password_fingerprint="b" * 64,
                resource="https://ledger.example",
                device_name="Finite",
                expires_at=finite_until,
                created_at=datetime.now(UTC),
            )
        )
        db.commit()
    command.upgrade(config, "head")
    command.check(config)
    assert next(
        c for c in inspect(engine).get_columns("receipt_devices") if c["name"] == "expires_at"
    )["nullable"]
    with Session(engine) as db:
        assert as_utc(db.scalar(select(ReceiptDevice)).expires_at) == finite_until
        assert db.scalar(select(ReceiptDevice)).expense_write_enabled is False
        db.add(
            ReceiptDevice(
                user_id=owner_id,
                token_hash="c" * 64,
                password_fingerprint="b" * 64,
                resource="https://ledger.example",
                device_name="Permanent",
                expires_at=None,
                expense_write_enabled=True,
            )
        )
        db.commit()
    command.downgrade(config, "0011_receipt_devices")
    assert not next(
        c for c in inspect(engine).get_columns("receipt_devices") if c["name"] == "expires_at"
    )["nullable"]
    with Session(engine) as db:
        legacy = Table("receipt_devices", MetaData(), autoload_with=engine)
        rows = {row["device_name"]: row for row in db.execute(select(legacy)).mappings()}
        assert as_utc(rows["Finite"]["expires_at"]) == finite_until
        assert as_utc(rows["Permanent"]["expires_at"]) <= datetime.now(UTC)
    command.upgrade(config, "head")
    command.check(config)
    with Session(engine) as db:
        assert all(not row.expense_write_enabled for row in db.scalars(select(ReceiptDevice)))
    engine.dispose()
