from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db
from app.models.configuration import AppSetting
from app.models.fx import FxSyncRun

router = APIRouter()
SCHEDULER_STALE_AFTER = timedelta(minutes=10)


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    api: Literal["ok"] = "ok"
    database: Literal["ok", "unavailable"]
    scheduler: Literal["ok", "stale", "unavailable"]
    scheduler_last_heartbeat_at: datetime | None
    fx_sync_status: str | None
    fx_sync_finished_at: datetime | None
    environment: str


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


@router.get("/health", response_model=HealthResponse)
def health_check(
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> HealthResponse:
    try:
        db.execute(text("SELECT 1"))
        database_status: Literal["ok", "unavailable"] = "ok"
    except Exception:
        return HealthResponse(
            status="degraded",
            database="unavailable",
            scheduler="unavailable",
            scheduler_last_heartbeat_at=None,
            fx_sync_status=None,
            fx_sync_finished_at=None,
            environment=settings.app_env,
        )

    heartbeat = db.scalar(select(AppSetting).where(AppSetting.key == "scheduler_heartbeat"))
    heartbeat_at: datetime | None = None
    scheduler_status: Literal["ok", "stale", "unavailable"] = "unavailable"
    if heartbeat and isinstance(heartbeat.value.get("at"), str):
        try:
            heartbeat_at = datetime.fromisoformat(heartbeat.value["at"])
            scheduler_status = (
                "ok"
                if datetime.now(UTC) - _as_utc(heartbeat_at) <= SCHEDULER_STALE_AFTER
                else "stale"
            )
        except ValueError:
            scheduler_status = "unavailable"
    latest_fx = db.scalar(select(FxSyncRun).order_by(FxSyncRun.started_at.desc()).limit(1))
    return HealthResponse(
        status="ok" if scheduler_status == "ok" else "degraded",
        database=database_status,
        scheduler=scheduler_status,
        scheduler_last_heartbeat_at=heartbeat_at,
        fx_sync_status=latest_fx.status if latest_fx else None,
        fx_sync_finished_at=latest_fx.finished_at if latest_fx else None,
        environment=settings.app_env,
    )
