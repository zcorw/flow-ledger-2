import csv
import io
import re
import uuid
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models.asset import Account, MonthlySnapshot, Project
from app.models.debt import DebtEvent, DebtItem
from app.models.institution import Institution
from app.services.debt import (
    debt_balance_at,
    debt_balance_latest,
    event_delta,
    validate_event_amount,
)
from app.services.fx import enabled_currency_codes, resolve_rate

IMPORT_TYPES = {"institution_account_project", "monthly_snapshot", "debt_event"}
HEADERS = {
    "institution_account_project": [
        "record_type",
        "institution_name",
        "account_name",
        "project_name",
        "institution_type",
        "account_type",
        "asset_type",
        "currency_code",
        "masked_identifier",
        "liquidity_level",
        "risk_level",
        "notes",
    ],
    "monthly_snapshot": [
        "snapshot_date",
        "institution_name",
        "account_name",
        "project_name",
        "original_amount",
        "liquidity_level",
        "risk_level",
        "change_note",
    ],
    "debt_event": [
        "debt_type",
        "counterparty",
        "currency_code",
        "event_type",
        "event_date",
        "amount",
        "note",
    ],
}
EXAMPLES = {
    "institution_account_project": [
        ["institution", "示例银行", "", "", "bank", "", "", "", "", "", "", ""],
        [
            "account",
            "示例银行",
            "工资卡",
            "",
            "",
            "savings",
            "",
            "",
            "尾号 8888",
            "",
            "",
            "",
        ],
        [
            "project",
            "示例银行",
            "工资卡",
            "活期余额",
            "",
            "",
            "bank_deposit",
            "CNY",
            "",
            "t0",
            "low",
            "",
        ],
    ],
    "monthly_snapshot": [
        [
            "2026-07-31",
            "示例银行",
            "工资卡",
            "活期余额",
            "10000.00",
            "t0",
            "low",
            "月末余额",
        ]
    ],
    "debt_event": [
        ["receivable", "朋友 A", "CNY", "issue", "2026-07-01", "50000.00", "新增借出款"]
    ],
}
INSTITUTION_TYPES = {"bank", "broker", "cash", "person", "other"}
ACCOUNT_TYPES = {
    "savings",
    "wealth_management",
    "brokerage",
    "cash_wallet",
    "loan_related",
    "other",
}
ASSET_TYPES = {"bank_deposit", "cash", "securities"}
LIQUIDITY_LEVELS = {"t0", "within_7d", "within_30d", "within_90d", "locked_or_unknown"}
RISK_LEVELS = {"low", "medium", "high"}
REFERENCE_ROWS = {
    "institution_account_project": [
        "# 参考说明：以下以 # 开头的行仅提供可选值，导入时会自动忽略，可以保留",
        "# record_type（记录类型）：institution（机构） | account（账户） | project（项目）",
        (
            "# institution_type（机构类型）：bank（银行） | broker（券商） | "
            "cash（现金） | person（个人） | other（其他）"
        ),
        (
            "# account_type（账户类型）：savings（储蓄账户） | "
            "wealth_management（理财账户） | brokerage（证券账户） | "
            "cash_wallet（现金钱包） | loan_related（借贷相关） | other（其他）"
        ),
        "# asset_type（资产类型）：bank_deposit（银行存款） | cash（现金） | securities（证券）",
        (
            "# liquidity_level（流动性）：t0（随时可用） | within_7d（7 天内） | "
            "within_30d（30 天内） | within_90d（90 天内） | "
            "locked_or_unknown（锁定或未知）"
        ),
        "# risk_level（风险等级）：low（低风险） | medium（中风险） | high（高风险）",
    ],
    "monthly_snapshot": [
        "# 参考说明：以下以 # 开头的行仅提供可选值，导入时会自动忽略，可以保留",
        (
            "# liquidity_level（流动性）：t0（随时可用） | within_7d（7 天内） | "
            "within_30d（30 天内） | within_90d（90 天内） | "
            "locked_or_unknown（锁定或未知）"
        ),
        "# risk_level（风险等级）：low（低风险） | medium（中风险） | high（高风险）",
    ],
    "debt_event": [
        "# 参考说明：以下以 # 开头的行仅提供可选值，导入时会自动忽略，可以保留",
        "# debt_type（债权债务类型）：receivable（债权/应收） | payable（债务/应付）",
        (
            "# event_type（事件类型）：issue（新增） | repayment（还款） | "
            "adjustment（调整） | settle（结清）"
        ),
    ],
}


def template_csv(import_type: str) -> str:
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(HEADERS[import_type])
    writer.writerows(EXAMPLES[import_type])
    writer.writerows([[reference] for reference in REFERENCE_ROWS[import_type]])
    return "\ufeff" + output.getvalue()


def parse_csv(
    import_type: str, content: bytes
) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    errors: list[dict[str, Any]] = []
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return [], [{"row": 1, "field": "file", "reason": "文件必须使用 UTF-8 编码"}]
    reader = csv.DictReader(io.StringIO(text))
    missing = [field for field in HEADERS[import_type] if field not in (reader.fieldnames or [])]
    if missing:
        return [], [{"row": 1, "field": field, "reason": "缺少必需列"} for field in missing]
    unexpected = [field for field in (reader.fieldnames or []) if field not in HEADERS[import_type]]
    if unexpected:
        return [], [{"row": 1, "field": field, "reason": "存在未知列"} for field in unexpected]
    rows: list[dict[str, str]] = []
    for index, raw in enumerate(reader, 2):
        first_value = raw.get(HEADERS[import_type][0]) or ""
        if first_value.lstrip().startswith("#"):
            continue
        if raw.get(None):
            _error(errors, index, "file", "数据列数超过表头")
            continue
        rows.append({key: (raw.get(key) or "").strip() for key in HEADERS[import_type]})
    if not rows:
        if not errors:
            errors.append({"row": 2, "field": "file", "reason": "文件没有数据行"})
    return rows, errors


def _error(errors: list[dict[str, Any]], row: int, field: str, reason: str) -> None:
    errors.append({"row": row, "field": field, "reason": reason})


def _existing_hierarchy(
    db: Session, user_id: uuid.UUID
) -> tuple[set[str], set[tuple[str, str]], set[tuple[str, str, str]]]:
    institutions = set(db.scalars(select(Institution.name).where(Institution.user_id == user_id)))
    accounts = set(
        db.execute(
            select(Institution.name, Account.name)
            .join(Account, Account.institution_id == Institution.id)
            .where(Account.user_id == user_id)
        ).tuples()
    )
    projects = set(
        db.execute(
            select(Institution.name, Account.name, Project.name)
            .join(Account, Account.institution_id == Institution.id)
            .join(Project, Project.account_id == Account.id)
            .where(Project.user_id == user_id)
        ).tuples()
    )
    return institutions, accounts, projects


def _validate_hierarchy(
    db: Session,
    user_id: uuid.UUID,
    rows: list[dict[str, str]],
    currencies: set[str],
) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    existing_institutions, existing_accounts, existing_projects = _existing_hierarchy(db, user_id)
    new_institutions: set[str] = set()
    new_accounts: set[tuple[str, str]] = set()
    new_projects: set[tuple[str, str, str]] = set()
    planned_institutions = {
        row["institution_name"] for row in rows if row["record_type"] == "institution"
    }
    planned_accounts = {
        (row["institution_name"], row["account_name"])
        for row in rows
        if row["record_type"] == "account"
    }
    for index, row in enumerate(rows, 2):
        record_type = row["record_type"]
        institution_name = row["institution_name"]
        if record_type not in {"institution", "account", "project"}:
            _error(errors, index, "record_type", "必须是 institution、account 或 project")
            continue
        if not institution_name:
            _error(errors, index, "institution_name", "不能为空")
        if record_type == "institution":
            if row["institution_type"] not in INSTITUTION_TYPES:
                _error(errors, index, "institution_type", "机构类型无效")
            if institution_name in existing_institutions or institution_name in new_institutions:
                _error(errors, index, "institution_name", "机构已存在或文件内重复")
            new_institutions.add(institution_name)
            continue
        account_key = (institution_name, row["account_name"])
        if institution_name not in existing_institutions | planned_institutions:
            _error(errors, index, "institution_name", "引用的机构不存在")
        if not row["account_name"]:
            _error(errors, index, "account_name", "不能为空")
        if record_type == "account":
            if row["account_type"] not in ACCOUNT_TYPES:
                _error(errors, index, "account_type", "账户类型无效")
            if account_key in existing_accounts or account_key in new_accounts:
                _error(errors, index, "account_name", "账户已存在或文件内重复")
            if re.search(r"\d{7,}", row["masked_identifier"]):
                _error(errors, index, "masked_identifier", "不能保存完整账号，只允许尾号或简称")
            new_accounts.add(account_key)
            continue
        project_key = (*account_key, row["project_name"])
        if account_key not in existing_accounts | planned_accounts:
            _error(errors, index, "account_name", "引用的账户不存在")
        if not row["project_name"]:
            _error(errors, index, "project_name", "不能为空")
        if row["asset_type"] not in ASSET_TYPES:
            _error(errors, index, "asset_type", "资产类型无效")
        if row["currency_code"] not in currencies:
            _error(errors, index, "currency_code", "币种未启用")
        if row["liquidity_level"] not in LIQUIDITY_LEVELS:
            _error(errors, index, "liquidity_level", "流动性等级无效")
        if row["risk_level"] not in RISK_LEVELS:
            _error(errors, index, "risk_level", "风险等级无效")
        if project_key in existing_projects or project_key in new_projects:
            _error(errors, index, "project_name", "项目已存在或文件内重复")
        new_projects.add(project_key)
    return errors


def _find_project(db: Session, user_id: uuid.UUID, row: dict[str, str]) -> Project | None:
    return db.scalar(
        select(Project)
        .join(Account, Project.account_id == Account.id)
        .join(Institution, Account.institution_id == Institution.id)
        .where(
            Project.user_id == user_id,
            Institution.name == row["institution_name"],
            Account.name == row["account_name"],
            Project.name == row["project_name"],
            Institution.is_active.is_(True),
            Account.is_active.is_(True),
            Project.is_active.is_(True),
        )
    )


def _validate_snapshots(
    db: Session, user_id: uuid.UUID, rows: list[dict[str, str]]
) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()
    for index, row in enumerate(rows, 2):
        snapshot_date: date | None = None
        try:
            snapshot_date = date.fromisoformat(row["snapshot_date"])
        except ValueError:
            _error(errors, index, "snapshot_date", "日期格式必须为 YYYY-MM-DD")
        try:
            Decimal(row["original_amount"])
        except InvalidOperation:
            _error(errors, index, "original_amount", "金额必须是数字")
        key = (
            row["snapshot_date"],
            row["institution_name"],
            row["account_name"],
            row["project_name"],
        )
        if key in seen:
            _error(errors, index, "project_name", "同一日期项目重复")
        seen.add(key)
        if row["liquidity_level"] not in LIQUIDITY_LEVELS:
            _error(errors, index, "liquidity_level", "流动性等级无效")
        if row["risk_level"] not in RISK_LEVELS:
            _error(errors, index, "risk_level", "风险等级无效")
        project = _find_project(db, user_id, row)
        if project is None:
            _error(errors, index, "project_name", "引用的项目不存在或所属层级已停用")
            continue
        if snapshot_date is None:
            continue
        conflict = db.scalar(
            select(MonthlySnapshot.id).where(
                MonthlySnapshot.project_id == project.id,
                MonthlySnapshot.snapshot_date == snapshot_date,
            )
        )
        if conflict:
            _error(errors, index, "snapshot_date", "该项目在此日期已有快照")
        try:
            resolve_rate(db, project.currency_code, snapshot_date)
        except ApiError as exc:
            _error(errors, index, "snapshot_date", exc.message)
    return errors


def _validate_debts(rows: list[dict[str, str]], currencies: set[str]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    for index, row in enumerate(rows, 2):
        if row["debt_type"] not in {"receivable", "payable"}:
            _error(errors, index, "debt_type", "债权债务类型无效")
        if not row["counterparty"]:
            _error(errors, index, "counterparty", "不能为空")
        if row["event_type"] not in {"issue", "repayment", "adjustment", "settle"}:
            _error(errors, index, "event_type", "事件类型无效")
        if row["currency_code"] not in currencies:
            _error(errors, index, "currency_code", "币种未启用")
        try:
            date.fromisoformat(row["event_date"])
        except ValueError:
            _error(errors, index, "event_date", "日期格式必须为 YYYY-MM-DD")
        try:
            amount = Decimal(row["amount"])
            validate_event_amount(row["event_type"], amount)
        except InvalidOperation:
            _error(errors, index, "amount", "金额必须是数字")
        except ApiError as exc:
            _error(errors, index, "amount", exc.message)
    return errors


def validate_rows(
    db: Session, user_id: uuid.UUID, import_type: str, rows: list[dict[str, str]]
) -> list[dict[str, Any]]:
    currencies = set(enabled_currency_codes(db, user_id))
    if import_type == "institution_account_project":
        return _validate_hierarchy(db, user_id, rows, currencies)
    if import_type == "monthly_snapshot":
        return _validate_snapshots(db, user_id, rows)
    return _validate_debts(rows, currencies)


def _hierarchy(db: Session, user_id: uuid.UUID, rows: list[dict[str, str]]) -> None:
    institutions = {
        item.name: item
        for item in db.scalars(select(Institution).where(Institution.user_id == user_id))
    }
    accounts = {
        (institution_name, account.name): account
        for account, institution_name in db.execute(
            select(Account, Institution.name)
            .join(Institution, Account.institution_id == Institution.id)
            .where(Account.user_id == user_id)
        )
    }
    for record_type in ("institution", "account", "project"):
        for row in (item for item in rows if item["record_type"] == record_type):
            if record_type == "institution":
                item = Institution(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    name=row["institution_name"],
                    institution_type=row["institution_type"],
                    is_active=True,
                )
                db.add(item)
                db.flush()
                institutions[item.name] = item
            elif record_type == "account":
                institution = institutions.get(row["institution_name"])
                if institution is None:
                    raise ValueError(f"机构不存在：{row['institution_name']}")
                item = Account(
                    id=uuid.uuid4(),
                    user_id=user_id,
                    institution_id=institution.id,
                    name=row["account_name"],
                    account_type=row["account_type"],
                    masked_identifier=row["masked_identifier"] or None,
                    is_active=True,
                )
                db.add(item)
                db.flush()
                accounts[(institution.name, item.name)] = item
            else:
                account = accounts.get((row["institution_name"], row["account_name"]))
                if account is None:
                    raise ValueError(f"账户不存在：{row['account_name']}")
                db.add(
                    Project(
                        id=uuid.uuid4(),
                        user_id=user_id,
                        account_id=account.id,
                        name=row["project_name"],
                        asset_type=row["asset_type"],
                        currency_code=row["currency_code"],
                        default_liquidity_level=row["liquidity_level"],
                        default_risk_level=row["risk_level"],
                        notes=row["notes"] or None,
                        is_active=True,
                    )
                )


def _snapshots(db: Session, user_id: uuid.UUID, rows: list[dict[str, str]]) -> None:
    for row in rows:
        project = _find_project(db, user_id, row)
        if project is None:
            raise ValueError(f"项目不存在：{row['project_name']}")
        snapshot_date = date.fromisoformat(row["snapshot_date"])
        conflict = db.scalar(
            select(MonthlySnapshot.id).where(
                MonthlySnapshot.project_id == project.id,
                MonthlySnapshot.snapshot_date == snapshot_date,
            )
        )
        if conflict:
            raise ValueError(f"快照已存在：{row['project_name']} {snapshot_date}")
        rate = resolve_rate(db, project.currency_code, snapshot_date)
        original = Decimal(row["original_amount"])
        db.add(
            MonthlySnapshot(
                id=uuid.uuid4(),
                user_id=user_id,
                project_id=project.id,
                snapshot_date=snapshot_date,
                snapshot_month=snapshot_date.strftime("%Y-%m"),
                currency_code=project.currency_code,
                original_amount=original,
                fx_rate_id=rate.fx_rate_id,
                fx_rate_to_cny=rate.rate_to_cny,
                fx_is_stale=rate.is_stale,
                converted_amount_cny=(original * rate.rate_to_cny).quantize(
                    Decimal("0.000001"), rounding=ROUND_HALF_UP
                ),
                liquidity_level=row["liquidity_level"],
                risk_level=row["risk_level"],
                change_note=row["change_note"] or None,
            )
        )


def _debts(db: Session, user_id: uuid.UUID, rows: list[dict[str, str]]) -> None:
    for row in rows:
        item = db.scalar(
            select(DebtItem).where(
                DebtItem.user_id == user_id,
                DebtItem.debt_type == row["debt_type"],
                DebtItem.counterparty == row["counterparty"],
                DebtItem.currency_code == row["currency_code"],
            )
        )
        if item is None:
            item = DebtItem(
                id=uuid.uuid4(),
                user_id=user_id,
                debt_type=row["debt_type"],
                counterparty=row["counterparty"],
                currency_code=row["currency_code"],
                status="active",
            )
            db.add(item)
            db.flush()
        event_date = date.fromisoformat(row["event_date"])
        amount = Decimal(row["amount"])
        before, _ = debt_balance_at(db, item.id, event_date)
        stored = before if row["event_type"] == "settle" else amount
        if before + event_delta(row["event_type"], stored) < 0:
            raise ValueError(f"事件导致负余额：{row['counterparty']}")
        db.add(
            DebtEvent(
                id=uuid.uuid4(),
                user_id=user_id,
                debt_item_id=item.id,
                event_type=row["event_type"],
                event_date=event_date,
                amount=stored,
                counterparty=row["counterparty"],
                note=row["note"] or None,
            )
        )
        db.flush()
        balance, _ = debt_balance_latest(db, item.id)
        item.status = "settled" if balance == 0 else "active"


def commit_rows(
    db: Session, user_id: uuid.UUID, import_type: str, rows: list[dict[str, str]]
) -> None:
    if import_type == "institution_account_project":
        _hierarchy(db, user_id, rows)
    elif import_type == "monthly_snapshot":
        _snapshots(db, user_id, rows)
    else:
        _debts(db, user_id, rows)
