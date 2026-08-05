import uuid
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from app.models.asset import Account, MonthlySnapshot, Project
from app.models.debt import DebtEvent, DebtItem
from app.models.institution import Institution
from app.schemas.dashboard import (
    ChartPoint,
    DashboardCharts,
    DashboardSummary,
    ProjectChangePoint,
    TrendPoint,
)
from app.services.fx import resolve_rate


def _active_snapshot_rows(
    db: Session,
    user_id: uuid.UUID,
    target_date: date,
    *,
    positive_only: bool = False,
):
    ranked_snapshots = (
        select(
            MonthlySnapshot.id.label("snapshot_id"),
            func.row_number()
            .over(
                partition_by=MonthlySnapshot.project_id,
                order_by=MonthlySnapshot.snapshot_date.desc(),
            )
            .label("position"),
        )
        .where(
            MonthlySnapshot.user_id == user_id,
            MonthlySnapshot.snapshot_date <= target_date,
        )
        .subquery()
    )
    statement = (
        select(MonthlySnapshot, Project, Account, Institution)
        .join(
            ranked_snapshots,
            MonthlySnapshot.id == ranked_snapshots.c.snapshot_id,
        )
        .join(Project, MonthlySnapshot.project_id == Project.id)
        .join(Account, Project.account_id == Account.id)
        .join(Institution, Account.institution_id == Institution.id)
        .where(
            ranked_snapshots.c.position == 1,
            Project.is_active.is_(True),
            Account.is_active.is_(True),
            Institution.is_active.is_(True),
        )
    )
    if positive_only:
        statement = statement.where(MonthlySnapshot.converted_amount_cny > 0)
    return list(db.execute(statement))


def _shift_month(value: date, offset: int) -> date:
    month_index = value.year * 12 + value.month - 1 + offset
    year, month = divmod(month_index, 12)
    return date(year, month + 1, 1)


def _previous_month_end(value: date) -> date:
    return value.replace(day=1) - timedelta(days=1)


def _trend_cutoffs(target_date: date, count: int = 12) -> list[date]:
    current_month = target_date.replace(day=1)
    cutoffs = []
    for offset in range(-(count - 1), 1):
        month_start = _shift_month(current_month, offset)
        cutoffs.append(
            target_date
            if offset == 0
            else _shift_month(month_start, 1) - timedelta(days=1)
        )
    return cutoffs


def _debt_values(
    db: Session, user_id: uuid.UUID, target_date: date
) -> tuple[Decimal, Decimal, dict[str, Decimal], list[str]]:
    receivable = Decimal("0")
    payable = Decimal("0")
    receivable_currencies: dict[str, Decimal] = defaultdict(Decimal)
    warnings: list[str] = []
    balance_expression = func.coalesce(
        func.sum(
            case(
                (
                    DebtEvent.event_type.in_(["issue", "adjustment"]),
                    DebtEvent.amount,
                ),
                else_=-DebtEvent.amount,
            )
        ),
        Decimal("0"),
    )
    rows = db.execute(
        select(DebtItem, balance_expression)
        .outerjoin(
            DebtEvent,
            and_(
                DebtEvent.debt_item_id == DebtItem.id,
                DebtEvent.event_date <= target_date,
            ),
        )
        .where(DebtItem.user_id == user_id)
        .group_by(DebtItem.id)
    )
    rates = {}
    for item, balance in rows:
        if balance <= 0:
            continue
        rate = rates.get(item.currency_code)
        if rate is None:
            rate = resolve_rate(db, item.currency_code, target_date)
            rates[item.currency_code] = rate
        converted = balance * rate.rate_to_cny
        if rate.is_stale:
            warnings.append(f"{item.currency_code} 借贷余额使用历史汇率")
        if item.debt_type == "receivable":
            receivable += converted
            receivable_currencies[item.currency_code] += converted
        else:
            payable += converted
    return receivable, payable, receivable_currencies, warnings


def dashboard_summary(
    db: Session, user_id: uuid.UUID, target_date: date, *, include_change: bool = True
) -> DashboardSummary:
    rows = _active_snapshot_rows(db, user_id, target_date, positive_only=True)
    positive = [snapshot for snapshot, _project, _account, _institution in rows]
    project_assets = sum((item.converted_amount_cny for item in positive), Decimal("0"))
    receivable, payable, debt_currencies, debt_warnings = _debt_values(db, user_id, target_date)
    total_assets = project_assets + receivable
    foreign = sum(
        (item.converted_amount_cny for item in positive if item.currency_code != "CNY"),
        Decimal("0"),
    ) + sum(
        (value for currency, value in debt_currencies.items() if currency != "CNY"),
        Decimal("0"),
    )
    previous_date = _previous_month_end(target_date)
    previous_change = None
    if include_change and _active_snapshot_rows(db, user_id, previous_date):
        previous = dashboard_summary(db, user_id, previous_date, include_change=False)
        previous_change = total_assets - payable - previous.net_worth_cny
    warnings = debt_warnings + [
        f"{item.currency_code} 项目使用历史汇率" for item in positive if item.fx_is_stale
    ]
    return DashboardSummary(
        snapshot_date=target_date,
        total_assets_cny=total_assets,
        total_liabilities_cny=payable,
        net_worth_cny=total_assets - payable,
        net_worth_change_from_previous_month_cny=previous_change,
        foreign_asset_ratio=Decimal("0") if total_assets == 0 else foreign / total_assets,
        fx_warnings=sorted(set(warnings)),
    )


def _points(values: dict[str, Decimal]) -> list[ChartPoint]:
    return [
        ChartPoint(name=name, value=value)
        for name, value in sorted(values.items(), key=lambda item: item[1], reverse=True)
    ]


def _net_worth_value(db: Session, user_id: uuid.UUID, target_date: date) -> Decimal:
    project_assets = sum(
        (
            snapshot.converted_amount_cny
            for snapshot, _project, _account, _institution in _active_snapshot_rows(
                db, user_id, target_date, positive_only=True
            )
        ),
        Decimal("0"),
    )
    receivable, payable, _, _ = _debt_values(db, user_id, target_date)
    return project_assets + receivable - payable


def dashboard_charts(db: Session, user_id: uuid.UUID, target_date: date) -> DashboardCharts:
    rows = _active_snapshot_rows(db, user_id, target_date, positive_only=True)
    asset_types: dict[str, Decimal] = defaultdict(Decimal)
    liquidity: dict[str, Decimal] = defaultdict(Decimal)
    risk: dict[str, Decimal] = defaultdict(Decimal)
    currencies: dict[str, Decimal] = defaultdict(Decimal)
    institutions: dict[str, Decimal] = defaultdict(Decimal)
    for snapshot, project, _account, institution in rows:
        value = snapshot.converted_amount_cny
        asset_types[project.asset_type] += value
        liquidity[snapshot.liquidity_level] += value
        risk[snapshot.risk_level] += value
        currencies[snapshot.currency_code] += value
        institutions[institution.name] += value
    receivable, _, debt_currencies, _ = _debt_values(db, user_id, target_date)
    if receivable > 0:
        asset_types["receivable"] += receivable
        for currency, value in debt_currencies.items():
            currencies[currency] += value

    trend = [
        TrendPoint(date=item, value=_net_worth_value(db, user_id, item))
        for item in _trend_cutoffs(target_date)
    ]
    previous = {
        item.project_id: item.converted_amount_cny
        for item, _project, _account, _institution in _active_snapshot_rows(
            db, user_id, _previous_month_end(target_date)
        )
    }
    changes = sorted(
        [
            ProjectChangePoint(
                project_name=project.name,
                institution_name=institution.name,
                value=snapshot.converted_amount_cny - previous.get(project.id, Decimal("0")),
            )
            for snapshot, project, _account, institution in rows
        ],
        key=lambda item: abs(item.value),
        reverse=True,
    )[:10]
    return DashboardCharts(
        trend=trend,
        asset_composition=_points(asset_types),
        liquidity_distribution=_points(liquidity),
        risk_distribution=_points(risk),
        currency_distribution=_points(currencies),
        top_institutions=_points(institutions)[:5],
        project_changes=changes,
    )
