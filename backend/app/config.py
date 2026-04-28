"""Centralized settings — env-driven, validated by pydantic-settings."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # GCP / Vertex
    gcp_project_id: str = Field(default="", alias="GCP_PROJECT_ID")
    gcp_location: str = Field(default="us-central1", alias="GCP_LOCATION")
    vertex_model: str = Field(default="gemini-2.0-pro-exp-02-05", alias="VERTEX_MODEL")
    vertex_fast_model: str = Field(default="gemini-2.0-flash", alias="VERTEX_FAST_MODEL")

    # Judge
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")

    # Auth
    hmac_secret: str = Field(default="dev-only-replace-in-prod", alias="HMAC_SECRET")
    allow_unsigned_dev: bool = Field(default=True, alias="ALLOW_UNSIGNED_DEV")

    # Data paths
    data_dir: Path = Field(default=REPO_ROOT / "backend" / "data")
    chroma_path: Path = Field(default=REPO_ROOT / "backend" / "data" / "chroma")
    artifacts_dir: Path = Field(default=REPO_ROOT / "backend" / "app" / "ml" / "artifacts")

    # SEC EDGAR requires a contact User-Agent
    sec_edgar_user_agent: str = Field(
        default="Julio Rodriguez 23juliorod@gmail.com",
        alias="SEC_EDGAR_USER_AGENT",
    )

    # CORS
    allowed_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "https://juliooo.com",
            "https://*.vercel.app",
        ],
        alias="ALLOWED_ORIGINS",
    )

    # Rate limiting (server-side complement to the Vercel proxy limiter)
    rate_limit_per_min: int = Field(default=30, alias="RATE_LIMIT_PER_MIN")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
