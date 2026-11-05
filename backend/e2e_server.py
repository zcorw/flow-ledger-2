import os
from pathlib import Path
from tempfile import TemporaryDirectory

from alembic.config import Config

from alembic import command

ROOT = Path(__file__).resolve().parent
TEST_DIRECTORY = TemporaryDirectory(prefix="flow-ledger-e2e-")
DATABASE_PATH = Path(TEST_DIRECTORY.name) / "synthetic.db"

os.environ["APP_ENV"] = "test"
os.environ["OPENAI_API_KEY"] = ""
os.environ["APP_BASE_URL"] = "http://127.0.0.1:4186"
os.environ["BOOTSTRAP_TOKEN"] = "e2e-bootstrap-token"
os.environ["SECRET_KEY"] = "e2e-secret-key-that-is-long-enough"
os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{DATABASE_PATH.as_posix()}"

from app.core.config import Settings  # noqa: E402

# Tests never read a developer's .env or production credentials.
Settings.model_config["env_file"] = None

alembic_config = Config(str(ROOT / "alembic.ini"))
alembic_config.set_main_option("script_location", str(ROOT / "alembic"))
command.upgrade(alembic_config, "head")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8016, log_level="warning")
