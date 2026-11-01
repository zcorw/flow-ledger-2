from pathlib import Path

from alembic.config import Config
from sqlalchemy import create_engine, inspect

from alembic import command
from app.core.config import get_settings


def test_migration_upgrade_check_downgrade_and_reupgrade(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[1]
    url = f"sqlite+pysqlite:///{(tmp_path / 'migration-only.db').as_posix()}"
    monkeypatch.setattr(get_settings(), "database_url", url)
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "alembic"))
    command.upgrade(config, "head")
    command.check(config)
    engine = create_engine(url)
    assert "expenses" in inspect(engine).get_table_names()
    command.downgrade(config, "0009_optional_account_link")
    assert "expenses" not in inspect(engine).get_table_names()
    command.upgrade(config, "head")
    command.check(config)
    engine.dispose()
