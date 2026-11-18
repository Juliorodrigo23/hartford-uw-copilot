"""Centralized settings — env-driven, validated by pydantic-settings."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr
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
    gemini_auth_mode: Literal["auto", "api_key", "adc"] = Field(default="auto", alias="GEMINI_AUTH_MODE")
    gemini_api_backend: Literal["vertex", "developer"] = Field(default="developer", alias="GEMINI_API_BACKEND")
    gemini_api_key: SecretStr = Field(
        default="", validation_alias=AliasChoices("GEMINI_API_KEY", "GOOGLE_API_KEY")
    )
    gcp_project_id: str = Field(default="", alias="GCP_PROJECT_ID")
    gcp_location: str = Field(default="global", alias="GCP_LOCATION")
    vertex_model: str = Field(default="gemini-3.8-flash", alias="VERTEX_MODEL")
    vertex_fast_model: str = Field(default="gemini-3.5-flash-lite", alias="VERTEX_FAST_MODEL")
    # "rest" (default) avoids loading grpc alongside chromadb's onnxruntime:
    # the two ship conflicting native abseil/protobuf symbols and their
    # coexistence segfaults the process on macOS arm64 (observed as exit 139
    # the moment draft_memo opened a grpc channel after retrieval had loaded
    # onnx). REST costs milliseconds on memo-sized payloads.
    vertex_api_transport: str = Field(default="rest", alias="VERTEX_API_TRANSPORT")

    # Judge (OpenAI, cross-family)
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    openai_judge_model: str = Field(default="gpt-4o", alias="OPENAI_JUDGE_MODEL")

    # FMCSA QCMobile API key (free: https://mobile.fmcsa.dot.gov/QCDevsite/).
    # With this set, carrier lookups use the official JSON API instead of
    # scraping the SAFER snapshot page.
    fmcsa_webkey: str = Field(default="", alias="FMCSA_WEBKEY")

    # Runtime critique provider. "openai" → GPT-4o (cross-family, costs more,
    # avoids Gemini self-judging bias). "gemini" → Gemini 2.5 Flash (cheap,
    # default). "auto" → openai when a key is present, otherwise gemini.
    critique_provider: Literal["auto", "openai", "gemini"] = Field(default="auto", alias="CRITIQUE_PROVIDER")

    # Agent-based workspaces use the environment's returned tracer_session_name.
    langsmith_tracing: bool = Field(default=False, alias="LANGSMITH_TRACING")
    langsmith_api_key: SecretStr = Field(default="", alias="LANGSMITH_API_KEY")
    langsmith_endpoint: str = Field(default="https://api.smith.langchain.com", alias="LANGSMITH_ENDPOINT")
    langsmith_workspace_id: str = Field(default="", alias="LANGSMITH_WORKSPACE_ID")
    langsmith_project: str = Field(default="underwriting-copilot", alias="LANGSMITH_PROJECT")
    app_environment: str = Field(default="local", alias="APP_ENVIRONMENT")

    # Auth
    hmac_secret: str = Field(default="dev-only-replace-in-prod", alias="HMAC_SECRET")
    allow_unsigned_dev: bool = Field(default=True, alias="ALLOW_UNSIGNED_DEV")

    # Data paths
    data_dir: Path = Field(default=REPO_ROOT / "backend" / "data")
    chroma_path: Path = Field(default=REPO_ROOT / "backend" / "data" / "chroma")
    artifacts_dir: Path = Field(default=REPO_ROOT / "backend" / "app" / "ml" / "artifacts")
    # Viz/eval exports served by GET /data/{name}. Script 08 writes here AND
    # mirrors to frontend/public/data; this dir ships inside the Docker image.
    exports_dir: Path = Field(default=REPO_ROOT / "backend" / "data" / "exports")
    # LangGraph checkpoint DB (SQLite). Survives restarts within an instance
    # and is shared by all uvicorn workers in the container.
    checkpoint_db: Path = Field(default=REPO_ROOT / "backend" / "data" / "checkpoints.sqlite")

    # RAG models (overridable so smaller machines can build the index too)
    embed_model: str = Field(default="BAAI/bge-large-en-v1.5", alias="EMBED_MODEL")
    reranker_model: str = Field(
        default="cross-encoder/ms-marco-MiniLM-L-6-v2", alias="RERANKER_MODEL"
    )
    # Native ML runtimes can contend with tests and short-lived CLI commands.
    # Production opts in explicitly so local/test processes remain lazy.
    warm_rag_models: bool = Field(default=False, alias="WARM_RAG_MODELS")

    # SEC EDGAR requires a contact User-Agent
    sec_edgar_user_agent: str = Field(
        default="Julio Contreras 23juliorod@gmail.com",
        alias="SEC_EDGAR_USER_AGENT",
    )

    # CORS. Exact origins plus a regex for Vercel preview deployments
    # (Starlette's allow_origins is exact-match; wildcards need the regex).
    allowed_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "https://juliooo.com",
            "https://www.juliooo.com",
            "https://hartford.juliooo.com",
        ],
        alias="ALLOWED_ORIGINS",
    )
    allowed_origin_regex: str = Field(
        # Accept Next's alternate local ports as well as Vercel previews.
        # CORSMiddleware uses fullmatch, so this does not match lookalike hosts.
        default=(
            r"(?:http://(?:localhost|127\.0\.0\.1)(?::\d+)?|"
            r"https://.*\.vercel\.app)"
        ),
        alias="ALLOWED_ORIGIN_REGEX",
    )

    # Server-side rate limiting for /chat (complements the Vercel proxy limiter)
    rate_limit_per_min: int = Field(default=30, alias="RATE_LIMIT_PER_MIN")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
