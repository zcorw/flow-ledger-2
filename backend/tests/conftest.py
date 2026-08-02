import os

import pytest

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["APP_ENV"] = "test"
os.environ["BOOTSTRAP_TOKEN"] = "test-bootstrap-token"
os.environ["SECRET_KEY"] = "test-secret-key-that-is-long-enough"

import app.models  # noqa: E402, F401
from app.core.config import get_settings  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import get_engine  # noqa: E402

get_settings.cache_clear()
get_engine.cache_clear()


@pytest.fixture(autouse=True)
def reset_database():
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)
