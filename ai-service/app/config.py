from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    gemini_api_key: SecretStr = Field(min_length=10)
    gemini_model_respond: str = "gemini-2.5-flash"
    service_key: SecretStr = Field(min_length=32)
    host: str = "127.0.0.1"
    port: int = Field(default=8001, ge=1, le=65535)
    request_timeout_seconds: float = Field(default=45, ge=5, le=120)
    max_output_tokens: int = Field(default=2048, ge=256, le=8192)


@lru_cache
def get_settings() -> Settings:
    return Settings()
