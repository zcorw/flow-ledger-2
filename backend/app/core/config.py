from functools import lru_cache

from pydantic import Field, model_validator
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

    @model_validator(mode="after")
    def reject_unsafe_production_secrets(self) -> "Settings":
        if self.app_env.casefold() != "production":
            return self
        unsafe_markers = ("development", "replace-with", "change-me")
        secret_is_unsafe = len(self.secret_key) < 32 or any(
            marker in self.secret_key.casefold() for marker in unsafe_markers
        )
        token_is_unsafe = len(self.bootstrap_token) < 24 or any(
            marker in self.bootstrap_token.casefold() for marker in unsafe_markers
        )
        if secret_is_unsafe:
            raise ValueError(
                "production SECRET_KEY must be a random value of at least 32 characters"
            )
        if token_is_unsafe:
            raise ValueError(
                "production BOOTSTRAP_TOKEN must be a random value of at least 24 characters"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
