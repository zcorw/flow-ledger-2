import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.blocking import BlockingScheduler

from app.core.config import get_settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def heartbeat() -> None:
    now = datetime.now(tz=ZoneInfo(get_settings().timezone))
    logger.info("Flow Ledger scheduler heartbeat at %s", now)


def run() -> None:
    settings = get_settings()
    scheduler = BlockingScheduler(timezone=settings.timezone)
    scheduler.add_job(
        heartbeat,
        "interval",
        minutes=5,
        id="scheduler-heartbeat",
        replace_existing=True,
    )
    logger.info("Scheduler started; FX job will be added in T003")
    scheduler.start()


if __name__ == "__main__":
    run()
