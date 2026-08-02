import os
from pathlib import Path

from alembic.config import Config

from alembic import command

ROOT = Path(__file__).resolve().parent
DATABASE_PATH = ROOT / "e2e.db"
DATABASE_PATH.unlink(missing_ok=True)

os.environ["APP_ENV"] = "test"
os.environ["APP_BASE_URL"] = "http://127.0.0.1:4173"
os.environ["BOOTSTRAP_TOKEN"] = "e2e-bootstrap-token"
os.environ["SECRET_KEY"] = "e2e-secret-key-that-is-long-enough"
os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{DATABASE_PATH.as_posix()}"

alembic_config = Config(str(ROOT / "alembic.ini"))
alembic_config.set_main_option("script_location", str(ROOT / "alembic"))
command.upgrade(alembic_config, "head")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8001, log_level="warning")
