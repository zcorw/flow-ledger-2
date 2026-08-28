import uuid
from collections import defaultdict
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import CurrentAuthDependency
from app.core.errors import ApiError
from app.db.session import get_db
from app.models.asset import Account, MonthlySnapshot, Project
from app.models.audit import AuditLog
from app.models.institution import Institution
from app.schemas.snapshot import (
    CopyPreviousRequest,
    HistoryLevel,
    SnapshotBulkRequest,
    SnapshotHistoryCompositionPoint,
    SnapshotHistoryResponse,
    SnapshotHistoryRow,
    SnapshotHistoryTrendPoint,
    SnapshotRowResponse,
    SnapshotSheetResponse,
    SnapshotUpdateRequest,
    SnapshotUpdateResponse,
    SnapshotWarning,
)
from app.services.fx import enabled_currency_codes, resolve_rate

router = APIRouter()
DbDependency = Annotated[Session, Depends(get_db)]
MONEY_QUANTIZER = Decimal("0.000001")
CHANGE_AMOUNT_THRESHOLD = Decimal("20000")
CHANGE_PERCENT_THRESHOLD = Decimal("0.20")


def _change_values(
    current: Decimal | None, previous: Decimal | None
) -> tuple[Decimal | None, Decimal | None, bool]:
    if current is None or previous is None:
        return None, None, False
    amount = (current - previous).quantize(MONEY_QUANTIZER)
    percent = None if previous == 0 else (amount / abs(previous)).quantize(Decimal("0.0001"))
    unusual = abs(amount) > CHANGE_AMOUNT_THRESHOLD or (
        percent is not None and abs(percent) > CHANGE_PERCENT_THRESHOLD
    )
    return amount, percent, unusual


def _sheet(
    db: Session,
    user_id: uuid.UUID,
    target_date: date,
    *,
    seed_date: date | None = None,
) -> SnapshotSheetResponse:
    saved = {
        item.project_id: item
        for item in db.scalars(
            select(MonthlySnapshot).where(
                MonthlySnapshot.user_id == user_id,
                MonthlySnapshot.snapshot_date == target_date,
            )
        )
    }
    seed = (
        {
            item.project_id: item
            for item in db.scalars(
                select(MonthlySnapshot).where(
                    MonthlySnapshot.user_id == user_id,
                    MonthlySnapshot.snapshot_date == seed_date,
                )
            )
        }
        if seed_date
        else {}
    )
    saved_ids = set(saved)
    hierarchy = list(
        db.execute(
            select(Project, Account, Institution)
            .join(Account, Project.account_id == Account.id)
            .join(Institution, Account.institution_id == Institution.id)
            .where(
                Project.user_id == user_id,
                Account.is_active.is_(True),
                Institution.is_active.is_(True),
                or_(Project.is_active.is_(True), Project.id.in_(saved_ids)),
            )
            .order_by(Institution.name, Account.name, Project.name)
        )
    )
    project_ids = [project.id for project, _account, _institution in hierarchy]
    previous: dict[uuid.UUID, MonthlySnapshot] = {}
    if project_ids:
        ranked = (
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
                MonthlySnapshot.project_id.in_(project_ids),
                MonthlySnapshot.snapshot_date < target_date,
            )
            .subquery()
        )
        previous = {
            item.project_id: item
            for item in db.scalars(
                select(MonthlySnapshot)
                .join(ranked, MonthlySnapshot.id == ranked.c.snapshot_id)
                .where(ranked.c.position == 1)
            )
        }
    rows: list[SnapshotRowResponse] = []
    missing: list[uuid.UUID] = []
    warnings: list[SnapshotWarning] = []
    rate_resolutions = {}
    for project, account, institution in hierarchy:
        record = saved.get(project.id)
        seed_record = seed.get(project.id)
        original = (
            record.original_amount
            if record
            else seed_record.original_amount
            if seed_record
            else None
        )
        converted = record.converted_amount_cny if record else None
        rate = record.fx_rate_to_cny if record else None
        stale = record.fx_is_stale if record else False
        if seed_record and not record:
            resolution = rate_resolutions.get(project.currency_code)
            if resolution is None:
                resolution = resolve_rate(db, project.currency_code, target_date)
                rate_resolutions[project.currency_code] = resolution
            rate = resolution.rate_to_cny
            stale = resolution.is_stale
            converted = (original * rate).quantize(MONEY_QUANTIZER, rounding=ROUND_HALF_UP)
        previous_record = previous.get(project.id)
        change, percent, unusual = _change_values(
            converted,
            previous_record.converted_amount_cny if previous_record else None,
        )
        note = record.change_note if record else seed_record.change_note if seed_record else None
        if unusual:
            warnings.append(
                SnapshotWarning(project_id=project.id, message="金额变化较大，建议填写备注")
            )
        if record is None and seed_record is None:
            missing.append(project.id)
        rows.append(
            SnapshotRowResponse(
                id=record.id if record else None,
                project_id=project.id,
                institution_name=institution.name,
                account_name=account.name,
                project_name=project.name,
                asset_type=project.asset_type,
                currency_code=project.currency_code,
                original_amount=original,
                converted_amount_cny=converted,
                previous_original_amount=(
                    previous_record.original_amount if previous_record else None
                ),
                fx_rate_to_cny=rate,
                fx_is_stale=stale,
                liquidity_level=(
                    record.liquidity_level if record else project.default_liquidity_level
                ),
                risk_level=record.risk_level if record else project.default_risk_level,
                change_note=note,
                change_amount_cny=change,
                change_percent=percent,
                unusual_change=unusual,
            )
        )
    return SnapshotSheetResponse(
        snapshot_date=target_date,
        source_date=seed_date,
        rows=rows,
        missing_project_ids=missing,
        warnings=warnings,
    )


@router.get("", response_model=SnapshotSheetResponse)
def get_snapshots(
    auth: CurrentAuthDependency,
    db: DbDependency,
    snapshot_date: Annotated[date, Query(alias="date")],
) -> SnapshotSheetResponse:
    return _sheet(db, auth.user.id, snapshot_date)


def _history_scope(
    db: Session,
    user_id: uuid.UUID,
    level: HistoryLevel,
    entity_id: uuid.UUID,
) -> tuple[str, list[uuid.UUID]]:
    if level == "institution":
        entity = db.scalar(
            select(Institution).where(
                Institution.id == entity_id,
                Institution.user_id == user_id,
            )
        )
        if entity is None:
            raise ApiError(404, "INSTITUTION_NOT_FOUND", "机构不存在")
        project_ids = list(
            db.scalars(
                select(Project.id)
                .join(Account, Project.account_id == Account.id)
                .where(
                    Project.user_id == user_id,
                    Account.institution_id == entity.id,
                )
            )
        )
        return entity.name, project_ids
    if level == "account":
        entity = db.scalar(
            select(Account).where(Account.id == entity_id, Account.user_id == user_id)
        )
        if entity is None:
            raise ApiError(404, "ACCOUNT_NOT_FOUND", "账户不存在")
        project_ids = list(
            db.scalars(
                select(Project.id).where(
                    Project.user_id == user_id,
                    Project.account_id == entity.id,
                )
            )
        )
        return entity.name, project_ids
    entity = db.scalar(
        select(Project).where(Project.id == entity_id, Project.user_id == user_id)
    )
    if entity is None:
        raise ApiError(404, "PROJECT_NOT_FOUND", "项目不存在")
    return entity.name, [entity.id]


@router.get("/history", response_model=SnapshotHistoryResponse)
def get_snapshot_history(
    auth: CurrentAuthDependency,
    db: DbDependency,
    level: Annotated[HistoryLevel, Query()],
    entity_id: Annotated[uuid.UUID, Query(alias="entityId")],
    date_from: Annotated[date | None, Query(alias="dateFrom")] = None,
    date_to: Annotated[date | None, Query(alias="dateTo")] = None,
) -> SnapshotHistoryResponse:
    if date_from is not None and date_to is not None and date_from > date_to:
        raise ApiError(400, "INVALID_DATE_RANGE", "开始日期不能晚于结束日期")
    entity_name, project_ids = _history_scope(db, auth.user.id, level, entity_id)
    records: list[tuple[MonthlySnapshot, Project, Account, Institution | None]] = []
    if project_ids:
        statement = (
            select(MonthlySnapshot, Project, Account, Institution)
            .join(Project, MonthlySnapshot.project_id == Project.id)
            .join(Account, Project.account_id == Account.id)
            .outerjoin(Institution, Account.institution_id == Institution.id)
            .where(
                MonthlySnapshot.user_id == auth.user.id,
                MonthlySnapshot.project_id.in_(project_ids),
            )
            .order_by(
                MonthlySnapshot.snapshot_date,
                Institution.name,
                Account.name,
                Project.name,
            )
        )
        if date_to is not None:
            statement = statement.where(MonthlySnapshot.snapshot_date <= date_to)
        records = list(db.execute(statement))

    previous_by_project: dict[uuid.UUID, Decimal] = {}
    changes: dict[uuid.UUID, tuple[Decimal | None, Decimal | None]] = {}
    totals_by_date: dict[date, Decimal] = defaultdict(Decimal)
    visible_records: list[tuple[MonthlySnapshot, Project, Account, Institution | None]] = []
    for snapshot, project, account, institution in records:
        previous = previous_by_project.get(project.id)
        amount_change, percent_change, _ = _change_values(
            snapshot.converted_amount_cny,
            previous,
        )
        changes[snapshot.id] = (amount_change, percent_change)
        previous_by_project[project.id] = snapshot.converted_amount_cny
        totals_by_date[snapshot.snapshot_date] += snapshot.converted_amount_cny
        if date_from is None or snapshot.snapshot_date >= date_from:
            visible_records.append((snapshot, project, account, institution))

    visible_dates = sorted({snapshot.snapshot_date for snapshot, *_ in visible_records})
    trend = [
        SnapshotHistoryTrendPoint(snapshot_date=item, amount_cny=totals_by_date[item])
        for item in visible_dates
    ]
    latest_date = visible_dates[-1] if visible_dates else None
    latest_amount = totals_by_date[latest_date] if latest_date is not None else None
    previous_dates = (
        sorted(item for item in totals_by_date if item < latest_date)
        if latest_date is not None
        else []
    )
    previous_amount = totals_by_date[previous_dates[-1]] if previous_dates else None
    latest_change, latest_percent, _ = _change_values(latest_amount, previous_amount)

    composition_values: dict[tuple[uuid.UUID, str], Decimal] = defaultdict(Decimal)
    if latest_date is not None and level != "project":
        for snapshot, project, account, _institution in visible_records:
            if snapshot.snapshot_date != latest_date:
                continue
            key = (
                (account.id, account.name)
                if level == "institution"
                else (project.id, project.name)
            )
            composition_values[key] += snapshot.converted_amount_cny
    composition = [
        SnapshotHistoryCompositionPoint(entity_id=item_id, name=name, amount_cny=value)
        for (item_id, name), value in sorted(
            composition_values.items(),
            key=lambda item: item[1],
            reverse=True,
        )
    ]

    history_rows = [
        SnapshotHistoryRow(
            id=snapshot.id,
            snapshot_date=snapshot.snapshot_date,
            institution_name=institution.name if institution else None,
            account_name=account.name,
            project_name=project.name,
            currency_code=snapshot.currency_code,
            original_amount=snapshot.original_amount,
            fx_rate_to_cny=snapshot.fx_rate_to_cny,
            fx_is_stale=snapshot.fx_is_stale,
            converted_amount_cny=snapshot.converted_amount_cny,
            change_amount_cny=changes[snapshot.id][0],
            change_percent=changes[snapshot.id][1],
            change_note=snapshot.change_note,
        )
        for snapshot, project, account, institution in reversed(visible_records)
    ]
    amounts = [item.amount_cny for item in trend]
    return SnapshotHistoryResponse(
        level=level,
        entity_id=entity_id,
        entity_name=entity_name,
        date_from=date_from,
        date_to=date_to,
        latest_snapshot_date=latest_date,
        latest_amount_cny=latest_amount,
        latest_change_amount_cny=latest_change,
        latest_change_percent=latest_percent,
        max_amount_cny=max(amounts) if amounts else None,
        min_amount_cny=min(amounts) if amounts else None,
        snapshot_count=len(visible_dates),
        record_count=len(history_rows),
        trend=trend,
        composition=composition,
        rows=history_rows,
    )


@router.post("/copy-from-previous", response_model=SnapshotSheetResponse)
def copy_from_previous(
    payload: CopyPreviousRequest, auth: CurrentAuthDependency, db: DbDependency
) -> SnapshotSheetResponse:
    previous_date = db.scalar(
        select(func.max(MonthlySnapshot.snapshot_date)).where(
            MonthlySnapshot.user_id == auth.user.id,
            MonthlySnapshot.snapshot_date < payload.target_date,
        )
    )
    if previous_date is None:
        raise ApiError(404, "PREVIOUS_SNAPSHOT_NOT_FOUND", "没有可复制的历史快照")
    return _sheet(db, auth.user.id, payload.target_date, seed_date=previous_date)


def _snapshot_audit_data(item: MonthlySnapshot) -> dict[str, str | bool | None]:
    return {
        "projectId": str(item.project_id),
        "snapshotDate": item.snapshot_date.isoformat(),
        "originalAmount": str(item.original_amount),
        "convertedAmountCny": str(item.converted_amount_cny),
        "fxRateToCny": str(item.fx_rate_to_cny),
        "fxIsStale": item.fx_is_stale,
        "liquidityLevel": item.liquidity_level,
        "riskLevel": item.risk_level,
        "changeNote": item.change_note,
    }


@router.put("/bulk", response_model=SnapshotSheetResponse)
def save_bulk(
    payload: SnapshotBulkRequest, auth: CurrentAuthDependency, db: DbDependency
) -> SnapshotSheetResponse:
    project_ids = [row.project_id for row in payload.rows]
    if len(project_ids) != len(set(project_ids)):
        raise ApiError(400, "DUPLICATE_PROJECT", "同一批次不能重复提交项目")
    currencies = set(enabled_currency_codes(db, auth.user.id))
    hierarchy = {
        project.id: (project, account, institution)
        for project, account, institution in db.execute(
            select(Project, Account, Institution)
            .join(Account, Project.account_id == Account.id)
            .join(Institution, Account.institution_id == Institution.id)
            .where(
                Project.user_id == auth.user.id,
                Project.id.in_(project_ids),
            )
        )
    }
    existing_records = {
        item.project_id: item
        for item in db.scalars(
            select(MonthlySnapshot).where(
                MonthlySnapshot.user_id == auth.user.id,
                MonthlySnapshot.project_id.in_(project_ids),
                MonthlySnapshot.snapshot_date == payload.snapshot_date,
            )
        )
    }
    rate_resolutions = {}
    for row in payload.rows:
        entities = hierarchy.get(row.project_id)
        if entities is None:
            raise ApiError(404, "PROJECT_NOT_FOUND", "项目不存在")
        project, account, institution = entities
        existing = existing_records.get(project.id)
        if not institution.is_active:
            raise ApiError(400, "INSTITUTION_INACTIVE", f"机构 {institution.name} 已停用")
        if not account.is_active:
            raise ApiError(400, "ACCOUNT_INACTIVE", f"账户 {account.name} 已停用")
        if not project.is_active and existing is None:
            raise ApiError(400, "PROJECT_INACTIVE", f"项目 {project.name} 已停用")
        if project.currency_code not in currencies:
            raise ApiError(400, "CURRENCY_NOT_ENABLED", f"{project.currency_code} 未启用")
        resolution = rate_resolutions.get(project.currency_code)
        if resolution is None:
            resolution = resolve_rate(db, project.currency_code, payload.snapshot_date)
            rate_resolutions[project.currency_code] = resolution
        converted = (row.original_amount * resolution.rate_to_cny).quantize(
            MONEY_QUANTIZER, rounding=ROUND_HALF_UP
        )
        before = _snapshot_audit_data(existing) if existing else None
        item = existing or MonthlySnapshot(
            id=uuid.uuid4(),
            user_id=auth.user.id,
            project_id=project.id,
            snapshot_date=payload.snapshot_date,
            snapshot_month=payload.snapshot_date.strftime("%Y-%m"),
            currency_code=project.currency_code,
        )
        item.original_amount = row.original_amount
        item.fx_rate_id = resolution.fx_rate_id
        item.fx_rate_to_cny = resolution.rate_to_cny
        item.fx_is_stale = resolution.is_stale
        item.converted_amount_cny = converted
        item.liquidity_level = row.liquidity_level
        item.risk_level = row.risk_level
        item.change_note = row.change_note.strip() if row.change_note else None
        if existing is None:
            db.add(item)
        db.add(
            AuditLog(
                user_id=auth.user.id,
                action="snapshot.update" if existing else "snapshot.create",
                entity_type="monthly_snapshot",
                entity_id=item.id,
                before_data=before,
                after_data=_snapshot_audit_data(item),
            )
        )
    db.commit()
    return _sheet(db, auth.user.id, payload.snapshot_date)


@router.patch("/{snapshot_id}", response_model=SnapshotUpdateResponse)
def update_snapshot(
    snapshot_id: uuid.UUID,
    payload: SnapshotUpdateRequest,
    auth: CurrentAuthDependency,
    db: DbDependency,
) -> MonthlySnapshot:
    item = db.scalar(
        select(MonthlySnapshot).where(
            MonthlySnapshot.id == snapshot_id,
            MonthlySnapshot.user_id == auth.user.id,
        )
    )
    if item is None:
        raise ApiError(404, "SNAPSHOT_NOT_FOUND", "快照不存在")
    conflict = db.scalar(
        select(MonthlySnapshot.id).where(
            MonthlySnapshot.project_id == item.project_id,
            MonthlySnapshot.snapshot_date == payload.snapshot_date,
            MonthlySnapshot.id != item.id,
        )
    )
    if conflict is not None:
        raise ApiError(409, "SNAPSHOT_DATE_CONFLICT", "该项目在目标日期已有快照")
    project = db.scalar(
        select(Project).where(
            Project.id == item.project_id,
            Project.user_id == auth.user.id,
        )
    )
    if project is None:
        raise ApiError(404, "PROJECT_NOT_FOUND", "项目不存在")
    resolution = resolve_rate(db, project.currency_code, payload.snapshot_date)
    before = _snapshot_audit_data(item)
    item.snapshot_date = payload.snapshot_date
    item.snapshot_month = payload.snapshot_date.strftime("%Y-%m")
    item.original_amount = payload.original_amount
    item.currency_code = project.currency_code
    item.fx_rate_id = resolution.fx_rate_id
    item.fx_rate_to_cny = resolution.rate_to_cny
    item.fx_is_stale = resolution.is_stale
    item.converted_amount_cny = (payload.original_amount * resolution.rate_to_cny).quantize(
        MONEY_QUANTIZER, rounding=ROUND_HALF_UP
    )
    db.add(
        AuditLog(
            user_id=auth.user.id,
            action="snapshot.update",
            entity_type="monthly_snapshot",
            entity_id=item.id,
            before_data=before,
            after_data=_snapshot_audit_data(item),
        )
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiError(
            409,
            "SNAPSHOT_DATE_CONFLICT",
            "该项目在目标日期已有快照",
        ) from exc
    db.refresh(item)
    return item
