import re
from functools import lru_cache

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_MODEL_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,80}$")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    gemini_api_key: SecretStr = Field(min_length=10)
    # The first model is tried first. When it runs out of quota or is unavailable, the system moves to the next one.
    gemini_model_respond: str = "gemini-2.5-flash"
    gemini_fallback_models: str = "gemini-3.5-flash-lite,gemini-3.1-flash-lite"
    service_key: SecretStr = Field(min_length=32)
    host: str = "127.0.0.1"
    port: int = Field(default=8001, ge=1, le=65535)
    # Total time for one chat request, across every model it has to try.
    request_timeout_seconds: float = Field(default=45, ge=5, le=120)
    # Time allowed for a single model before moving on to the next one.
    attempt_timeout_seconds: float = Field(default=25, ge=3, le=60)
    max_output_tokens: int = Field(default=2048, ge=256, le=8192)

    @field_validator("gemini_model_respond")
    @classmethod
    def _valid_primary(cls, value: str) -> str:
        value = value.strip()
        if not _MODEL_NAME.match(value):
            raise ValueError("GEMINI_MODEL_RESPOND is not a valid model name.")
        return value

    @field_validator("gemini_fallback_models")
    @classmethod
    def _valid_fallbacks(cls, value: str) -> str:
        for name in (part.strip() for part in value.split(",") if part.strip()):
            if not _MODEL_NAME.match(name):
                raise ValueError(f"GEMINI_FALLBACK_MODELS contains an invalid model name: {name!r}")
        return value

    @property
    def models(self) -> list[str]:
        """Model priority list without duplicates: the primary model, then the fallbacks in order."""
        ordered = [self.gemini_model_respond, *(part.strip() for part in self.gemini_fallback_models.split(","))]
        seen: set[str] = set()
        return [name for name in ordered if name and not (name in seen or seen.add(name))][:6]


@lru_cache
def get_settings() -> Settings:
    return Settings()
