import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.blocking import BlockingScheduler
from sqlalchemy import select

from app.core.config import get_settings
from app.db.session import get_session_factory
from app.models.user import User
from app.services.fx import get_fx_provider, sync_enabled_rates

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def heartbeat() -> None:
    now = datetime.now(tz=ZoneInfo(get_settings().timezone))
    logger.info("Flow Ledger scheduler heartbeat at %s", now)


def sync_fx_rates() -> None:
    provider = get_fx_provider()
    with get_session_factory()() as db:
        user_ids = list(db.scalars(select(User.id)))
        for user_id in user_ids:
            run = sync_enabled_rates(db, user_id, provider)
            logger.info("FX synchronization finished with status=%s", run.status)


def run() -> None:
    settings = get_settings()
    scheduler = BlockingScheduler(timezone=settings.timezone)
    hour, minute = (int(part) for part in settings.fx_sync_time.split(":", maxsplit=1))
    scheduler.add_job(
        sync_fx_rates,
        "cron",
        hour=hour,
        minute=minute,
        id="fx-sync",
        replace_existing=True,
    )
    scheduler.add_job(
        heartbeat,
        "interval",
        minutes=5,
        id="scheduler-heartbeat",
        replace_existing=True,
    )
    logger.info("Scheduler started; FX sync scheduled daily at %s", settings.fx_sync_time)
    scheduler.start()


if __name__ == "__main__":
    run()
