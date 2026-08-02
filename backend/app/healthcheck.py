import json
import sys
import urllib.request
from datetime import UTC, datetime

from sqlalchemy import select

from app.api.system import SCHEDULER_STALE_AFTER, _as_utc
from app.db.session import get_session_factory
from app.models.configuration import AppSetting


def api_health() -> bool:
    with urllib.request.urlopen(  # noqa: S310
        "http://localhost:8000/api/v1/system/health", timeout=5
    ) as response:
        payload = json.load(response)
    return payload.get("api") == "ok" and payload.get("database") == "ok"


def scheduler_health() -> bool:
    with get_session_factory()() as db:
        item = db.scalar(select(AppSetting).where(AppSetting.key == "scheduler_heartbeat"))
    if item is None or not isinstance(item.value.get("at"), str):
        return False
    try:
        heartbeat_at = datetime.fromisoformat(item.value["at"])
    except ValueError:
        return False
    return datetime.now(UTC) - _as_utc(heartbeat_at) <= SCHEDULER_STALE_AFTER


if __name__ == "__main__":
    check = scheduler_health if sys.argv[1:] == ["scheduler"] else api_health
    raise SystemExit(0 if check() else 1)
