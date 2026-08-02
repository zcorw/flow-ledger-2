from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.db.session import get_session_factory
from app.healthcheck import scheduler_health
from app.main import app
from app.models.common import utc_now
from app.models.configuration import AppSetting
from app.models.fx import FxSyncRun


def test_health_check_reports_database_scheduler_and_fx_sync() -> None:
    client = TestClient(app)
    degraded = client.get("/api/v1/system/health")
    assert degraded.status_code == 200
    assert degraded.json() == {
        "status": "degraded",
        "api": "ok",
        "database": "ok",
        "scheduler": "unavailable",
        "scheduler_last_heartbeat_at": None,
        "fx_sync_status": None,
        "fx_sync_finished_at": None,
        "environment": "test",
    }

    now = utc_now()
    with get_session_factory()() as db:
        db.add(AppSetting(key="scheduler_heartbeat", value={"at": now.isoformat()}))
        db.add(
            FxSyncRun(
                started_at=now,
                finished_at=now,
                status="success",
                currencies=["USD"],
                message="synced",
            )
        )
        db.commit()

    healthy = client.get("/api/v1/system/health")
    assert healthy.status_code == 200
    payload = healthy.json()
    assert payload["status"] == "ok"
    assert payload["database"] == "ok"
    assert payload["scheduler"] == "ok"
    heartbeat_at = datetime.fromisoformat(
        payload["scheduler_last_heartbeat_at"].replace("Z", "+00:00")
    )
    assert heartbeat_at == now
    assert payload["fx_sync_status"] == "success"
    finished_at = datetime.fromisoformat(payload["fx_sync_finished_at"].replace("Z", "+00:00"))
    assert finished_at.replace(tzinfo=UTC) == now
    assert scheduler_health() is True
