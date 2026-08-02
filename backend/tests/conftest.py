import os

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["APP_ENV"] = "test"

from app.core.config import get_settings  # noqa: E402
from app.db.session import get_engine  # noqa: E402

get_settings.cache_clear()
get_engine.cache_clear()
