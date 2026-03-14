from functools import cached_property

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="READ_AWARE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "ReadAware API"
    app_version: str = "0.1.0"
    environment: str = "development"
    api_prefix: str = "/api"
    host: str = "127.0.0.1"
    port: int = 8000
    reload: bool = True
    cors_allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @cached_property
    def cors_allowed_origins_list(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.cors_allowed_origins.split(",")
            if origin.strip()
        ]


settings = Settings()
