from datetime import date
from decimal import Decimal
from time import perf_counter

from fastapi.testclient import TestClient
from sqlalchemy import event, select

from app.db.session import get_engine, get_session_factory
from app.models.asset import Account, MonthlySnapshot, Project
from app.models.institution import Institution
from app.models.user import User

TARGET_PROJECTS = 100
TARGET_MONTHS = 60


def _seed_target_scale(client: TestClient) -> tuple[date, list[str]]:
    response = client.post(
        "/api/v1/setup/bootstrap",
        json={
            "bootstrapToken": "test-bootstrap-token",
            "displayName": "Performance Admin",
            "email": "performance@example.com",
            "password": "correct-horse-battery-staple",
        },
    )
    assert response.status_code == 201

    with get_session_factory()() as db:
        user = db.scalar(select(User).where(User.email == "performance@example.com"))
        institution = db.scalar(
            select(Institution).where(
                Institution.user_id == user.id,
                Institution.institution_type == "cash",
            )
        )
        account = Account(
            user_id=user.id,
            institution_id=institution.id,
            name="Performance Portfolio",
            account_type="brokerage",
            is_active=True,
        )
        db.add(account)
        db.flush()
        projects = [
            Project(
                user_id=user.id,
                account_id=account.id,
                name=f"Target Project {index:03d}",
                asset_type="securities",
                currency_code="CNY",
                default_liquidity_level="within_7d",
                default_risk_level="medium",
                is_active=True,
            )
            for index in range(TARGET_PROJECTS)
        ]
        db.add_all(projects)
        db.flush()
        project_ids = [str(project.id) for project in projects]
        dates = [date(2021 + offset // 12, offset % 12 + 1, 28) for offset in range(TARGET_MONTHS)]
        db.add_all(
            [
                MonthlySnapshot(
                    user_id=user.id,
                    project_id=project.id,
                    snapshot_date=snapshot_date,
                    snapshot_month=snapshot_date.strftime("%Y-%m"),
                    currency_code="CNY",
                    original_amount=Decimal(10_000 + project_index * 10 + month_index),
                    fx_rate_to_cny=Decimal("1"),
                    fx_is_stale=False,
                    converted_amount_cny=Decimal(10_000 + project_index * 10 + month_index),
                    liquidity_level="within_7d",
                    risk_level="medium",
                )
                for project_index, project in enumerate(projects)
                for month_index, snapshot_date in enumerate(dates)
            ]
        )
        db.commit()
    return dates[-1], project_ids


def test_target_scale_snapshot_and_dashboard_performance(client: TestClient) -> None:
    target_date, project_ids = _seed_target_scale(client)
    query_count = 0

    def count_query(*_args: object) -> None:
        nonlocal query_count
        query_count += 1

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", count_query)
    started = perf_counter()
    try:
        sheet = client.get("/api/v1/snapshots", params={"date": target_date.isoformat()})
    finally:
        event.remove(engine, "before_cursor_execute", count_query)
    sheet_duration = perf_counter() - started

    assert sheet.status_code == 200
    assert len(sheet.json()["rows"]) == TARGET_PROJECTS
    assert query_count <= 8
    assert sheet_duration < 2.0

    started = perf_counter()
    saved = client.put(
        "/api/v1/snapshots/bulk",
        json={
            "snapshotDate": target_date.isoformat(),
            "rows": [
                {
                    "projectId": project_id,
                    "originalAmount": str(20_000 + index),
                    "liquidityLevel": "within_7d",
                    "riskLevel": "medium",
                    "changeNote": "target-scale update",
                }
                for index, project_id in enumerate(project_ids)
            ],
        },
    )
    save_duration = perf_counter() - started

    assert saved.status_code == 200
    assert len(saved.json()["rows"]) == TARGET_PROJECTS
    assert save_duration < 2.0

    started = perf_counter()
    charts = client.get(
        "/api/v1/dashboard/charts",
        params={"snapshotDate": target_date.isoformat()},
    )
    chart_duration = perf_counter() - started

    assert charts.status_code == 200
    assert len(charts.json()["trend"]) == 12
    assert chart_duration < 3.0
