import csv
import io
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.asset import Account, Project
from app.models.institution import Institution


@dataclass(frozen=True)
class MasterDataExport:
    content: bytes
    institution_count: int
    account_count: int
    project_count: int


def _timestamp(value: datetime) -> str:
    return value.isoformat()


def _csv_bytes(headers: list[str], rows: list[list[object]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(headers)
    writer.writerows(rows)
    return output.getvalue().encode("utf-8-sig")


def build_master_data_export(db: Session, user_id: uuid.UUID) -> MasterDataExport:
    institutions = list(
        db.scalars(
            select(Institution)
            .where(Institution.user_id == user_id)
            .order_by(Institution.name, Institution.id)
        )
    )
    accounts = list(
        db.scalars(
            select(Account)
            .where(Account.user_id == user_id)
            .order_by(Account.name, Account.id)
        )
    )
    projects = list(
        db.scalars(
            select(Project)
            .where(Project.user_id == user_id)
            .order_by(Project.name, Project.id)
        )
    )
    institution_by_id = {item.id: item for item in institutions}
    account_by_id = {item.id: item for item in accounts}

    institution_csv = _csv_bytes(
        [
            "institution_id",
            "name",
            "institution_type",
            "display_color",
            "is_active",
            "created_at",
            "updated_at",
        ],
        [
            [
                item.id,
                item.name,
                item.institution_type,
                item.display_color or "",
                str(item.is_active).lower(),
                _timestamp(item.created_at),
                _timestamp(item.updated_at),
            ]
            for item in institutions
        ],
    )
    account_csv = _csv_bytes(
        [
            "account_id",
            "institution_id",
            "institution_name",
            "name",
            "account_type",
            "masked_identifier",
            "display_color",
            "is_active",
            "created_at",
            "updated_at",
        ],
        [
            [
                item.id,
                item.institution_id or "",
                institution_by_id[item.institution_id].name
                if item.institution_id in institution_by_id
                else "",
                item.name,
                item.account_type,
                item.masked_identifier or "",
                item.display_color or "",
                str(item.is_active).lower(),
                _timestamp(item.created_at),
                _timestamp(item.updated_at),
            ]
            for item in accounts
        ],
    )
    project_rows: list[list[object]] = []
    for item in projects:
        account = account_by_id[item.account_id]
        institution = institution_by_id.get(account.institution_id)
        project_rows.append(
            [
                item.id,
                account.id,
                account.name,
                institution.id if institution else "",
                institution.name if institution else "",
                item.name,
                item.asset_type,
                item.currency_code,
                item.default_liquidity_level,
                item.default_risk_level,
                str(item.is_active).lower(),
                item.notes or "",
                _timestamp(item.created_at),
                _timestamp(item.updated_at),
            ]
        )
    project_csv = _csv_bytes(
        [
            "project_id",
            "account_id",
            "account_name",
            "institution_id",
            "institution_name",
            "name",
            "asset_type",
            "currency_code",
            "default_liquidity_level",
            "default_risk_level",
            "is_active",
            "notes",
            "created_at",
            "updated_at",
        ],
        project_rows,
    )

    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr("institutions.csv", institution_csv)
        bundle.writestr("accounts.csv", account_csv)
        bundle.writestr("projects.csv", project_csv)
    return MasterDataExport(
        content=archive.getvalue(),
        institution_count=len(institutions),
        account_count=len(accounts),
        project_count=len(projects),
    )
