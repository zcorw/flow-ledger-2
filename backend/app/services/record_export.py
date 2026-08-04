import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.asset import Account, MonthlySnapshot, Project
from app.models.debt import DebtEvent, DebtItem
from app.models.institution import Institution
from app.services.master_data_export import csv_bytes


@dataclass(frozen=True)
class CsvExport:
    content: bytes
    row_count: int


def build_monthly_snapshot_export(
    db: Session,
    user_id: uuid.UUID,
    date_from: date | None,
    date_to: date | None,
) -> CsvExport:
    statement = (
        select(MonthlySnapshot, Project, Account, Institution)
        .join(Project, MonthlySnapshot.project_id == Project.id)
        .join(Account, Project.account_id == Account.id)
        .outerjoin(Institution, Account.institution_id == Institution.id)
        .where(MonthlySnapshot.user_id == user_id)
        .order_by(
            MonthlySnapshot.snapshot_date,
            Institution.name,
            Account.name,
            Project.name,
        )
    )
    if date_from is not None:
        statement = statement.where(MonthlySnapshot.snapshot_date >= date_from)
    if date_to is not None:
        statement = statement.where(MonthlySnapshot.snapshot_date <= date_to)
    records = list(db.execute(statement))
    rows = [
        [
            snapshot.id,
            snapshot.snapshot_date,
            institution.id if institution else "",
            institution.name if institution else "",
            account.id,
            account.name,
            project.id,
            project.name,
            snapshot.currency_code,
            snapshot.original_amount,
            snapshot.fx_rate_to_cny,
            str(snapshot.fx_is_stale).lower(),
            snapshot.converted_amount_cny,
            snapshot.liquidity_level,
            snapshot.risk_level,
            snapshot.change_note or "",
            snapshot.created_at.isoformat(),
            snapshot.updated_at.isoformat(),
        ]
        for snapshot, project, account, institution in records
    ]
    return CsvExport(
        content=csv_bytes(
            [
                "snapshot_id",
                "snapshot_date",
                "institution_id",
                "institution_name",
                "account_id",
                "account_name",
                "project_id",
                "project_name",
                "currency_code",
                "original_amount",
                "fx_rate_to_cny",
                "fx_is_stale",
                "converted_amount_cny",
                "liquidity_level",
                "risk_level",
                "change_note",
                "created_at",
                "updated_at",
            ],
            rows,
        ),
        row_count=len(rows),
    )


def build_debt_event_export(
    db: Session,
    user_id: uuid.UUID,
    debt_type: str | None,
    date_from: date | None,
    date_to: date | None,
) -> CsvExport:
    statement = (
        select(DebtEvent, DebtItem)
        .join(DebtItem, DebtEvent.debt_item_id == DebtItem.id)
        .where(DebtEvent.user_id == user_id)
        .order_by(DebtEvent.event_date, DebtItem.counterparty, DebtEvent.created_at)
    )
    if debt_type is not None:
        statement = statement.where(DebtItem.debt_type == debt_type)
    if date_from is not None:
        statement = statement.where(DebtEvent.event_date >= date_from)
    if date_to is not None:
        statement = statement.where(DebtEvent.event_date <= date_to)
    records = list(db.execute(statement))
    rows = [
        [
            event.id,
            item.id,
            item.debt_type,
            item.counterparty,
            event.counterparty,
            item.currency_code,
            item.status,
            event.event_type,
            event.event_date,
            event.amount,
            event.note or "",
            item.notes or "",
            event.created_at.isoformat(),
            event.updated_at.isoformat(),
        ]
        for event, item in records
    ]
    return CsvExport(
        content=csv_bytes(
            [
                "event_id",
                "debt_item_id",
                "debt_type",
                "item_counterparty",
                "event_counterparty",
                "currency_code",
                "item_status",
                "event_type",
                "event_date",
                "amount",
                "note",
                "item_notes",
                "created_at",
                "updated_at",
            ],
            rows,
        ),
        row_count=len(rows),
    )
