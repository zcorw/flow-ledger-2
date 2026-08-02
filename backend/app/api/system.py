from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.db.session import get_db

router = APIRouter()


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    api: Literal["ok"] = "ok"
    database: Literal["ok", "unavailable"]
    scheduler: Literal["configured"] = "configured"
    environment: str


@router.get("/health", response_model=HealthResponse)
def health_check(
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> HealthResponse:
    try:
        db.execute(text("SELECT 1"))
        database_status: Literal["ok", "unavailable"] = "ok"
    except Exception:
        database_status = "unavailable"

    return HealthResponse(
        status="ok" if database_status == "ok" else "degraded",
        database=database_status,
        environment=settings.app_env,
    )
