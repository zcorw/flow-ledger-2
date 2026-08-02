import hashlib
import json
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Date, DateTime, Numeric, Uuid, delete, select
from sqlalchemy.orm import Session

from app.models.asset import Account, MonthlySnapshot, Project
from app.models.audit import AuditLog
from app.models.common import utc_now
from app.models.configuration import AppSetting, UserCurrency
from app.models.debt import DebtEvent, DebtItem
from app.models.fx import FxRate, FxSyncRun
from app.models.institution import Institution
from app.models.operations import BackupExport

USER_TABLES = {
    "user_currencies": UserCurrency,
    "institutions": Institution,
    "accounts": Account,
    "projects": Project,
    "monthly_snapshots": MonthlySnapshot,
    "debt_items": DebtItem,
    "debt_events": DebtEvent,
    "audit_logs": AuditLog,
}
GLOBAL_TABLES = {
    "app_settings": AppSetting,
    "fx_rates": FxRate,
    "fx_sync_runs": FxSyncRun,
}
RESTORE_ORDER = [
    "app_settings",
    "fx_rates",
    "fx_sync_runs",
    "user_currencies",
    "institutions",
    "accounts",
    "projects",
    "monthly_snapshots",
    "debt_items",
    "debt_events",
    "audit_logs",
]


def _json_value(value: Any) -> Any:
    if isinstance(value, (uuid.UUID, Decimal, date, datetime)):
        return str(value)
    return value


def _rows(items: list[Any]) -> list[dict[str, Any]]:
    return [
        {column.name: _json_value(getattr(item, column.name)) for column in item.__table__.columns}
        for item in items
    ]


def build_backup_payload(db: Session, user_id: uuid.UUID) -> dict[str, Any]:
    tables: dict[str, list[dict[str, Any]]] = {}
    for name, model in GLOBAL_TABLES.items():
        tables[name] = _rows(list(db.scalars(select(model))))
    for name, model in USER_TABLES.items():
        tables[name] = _rows(
            list(db.scalars(select(model).where(model.user_id == user_id)))  # type: ignore[attr-defined]
        )
    return {"version": 1, "exported_at": utc_now().isoformat(), "tables": tables}


def backup_checksum(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


def validate_backup_payload(payload: dict[str, Any]) -> None:
    if payload.get("version") != 1 or not isinstance(payload.get("tables"), dict):
        raise ValueError("不支持的备份格式")
    tables = payload["tables"]
    for table_name in RESTORE_ORDER:
        rows = tables.get(table_name)
        if not isinstance(rows, list):
            raise ValueError(f"备份缺少数据表：{table_name}")
        if any(not isinstance(row, dict) for row in rows):
            raise ValueError(f"备份数据表格式无效：{table_name}")


def create_backup(db: Session, user_id: uuid.UUID, purpose: str = "manual") -> BackupExport:
    payload = build_backup_payload(db, user_id)
    timestamp = utc_now().strftime("%Y%m%d-%H%M%S")
    item = BackupExport(
        id=uuid.uuid4(),
        user_id=user_id,
        file_name=f"flow-ledger-{purpose}-{timestamp}.json",
        checksum=backup_checksum(payload),
        payload=payload,
        purpose=purpose,
    )
    db.add(item)
    db.flush()
    return item


def _decoded_row(model: type[Any], raw: dict[str, Any]) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for column in model.__table__.columns:
        value = raw.get(column.name)
        if value is None:
            values[column.name] = None
        elif isinstance(column.type, Uuid):
            values[column.name] = uuid.UUID(str(value))
        elif isinstance(column.type, DateTime):
            values[column.name] = datetime.fromisoformat(str(value))
        elif isinstance(column.type, Date):
            values[column.name] = date.fromisoformat(str(value))
        elif isinstance(column.type, Numeric):
            values[column.name] = Decimal(str(value))
        else:
            values[column.name] = value
    return values


def restore_backup_payload(db: Session, user_id: uuid.UUID, payload: dict[str, Any]) -> None:
    tables = payload["tables"]
    for model in (
        AuditLog,
        DebtEvent,
        DebtItem,
        MonthlySnapshot,
        Project,
        Account,
        Institution,
        UserCurrency,
    ):
        db.execute(delete(model).where(model.user_id == user_id))  # type: ignore[attr-defined]
    for model in (FxSyncRun, FxRate, AppSetting):
        db.execute(delete(model))
    db.flush()
    models = {**GLOBAL_TABLES, **USER_TABLES}
    for table_name in RESTORE_ORDER:
        model = models[table_name]
        for raw in tables.get(table_name, []):
            values = _decoded_row(model, raw)
            if "user_id" in values:
                values["user_id"] = user_id
            if table_name == "fx_sync_runs" and values["triggered_by_user_id"] is not None:
                values["triggered_by_user_id"] = user_id
            db.add(model(**values))
        db.flush()
