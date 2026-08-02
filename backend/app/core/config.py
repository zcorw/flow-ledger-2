from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: str = "development"
    app_base_url: str = "http://localhost:3000"
    database_url: str = "sqlite+pysqlite:///./flow_ledger.db"
    secret_key: str = Field(default="development-secret-change-me-please")
    bootstrap_token: str = "development-bootstrap-token"
    base_currency: str = "CNY"
    currency_limit: int = 5
    fx_sync_time: str = "08:00"
    timezone: str = "Asia/Tokyo"
    backup_dir: str = "./backups"


@lru_cache
def get_settings() -> Settings:
    return Settings()
