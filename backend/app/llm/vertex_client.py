"""Single source of truth for Vertex AI / Gemini access."""

from __future__ import annotations

from functools import lru_cache

from langchain_google_vertexai import ChatVertexAI

from app.config import settings


def gemini(
    *,
    model: str | None = None,
    temperature: float = 0.1,
    max_output_tokens: int = 4096,
    streaming: bool = True,
) -> ChatVertexAI:
    """Return a configured ChatVertexAI instance.

    Authentication uses Application Default Credentials, which works locally
    via `gcloud auth application-default login` and on Cloud Run via the
    attached service account.
    """
    return ChatVertexAI(
        model_name=model or settings.vertex_model,
        project=settings.gcp_project_id or None,
        location=settings.gcp_location,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        streaming=streaming,
    )


@lru_cache(maxsize=4)
def cached_gemini(model: str, temperature: float) -> ChatVertexAI:
    return gemini(model=model, temperature=temperature, streaming=False)


def gemini_fast() -> ChatVertexAI:
    """Cheap structured-extraction calls (parse_submission, self_critique)."""
    return cached_gemini(settings.vertex_fast_model, 0.0)
