"""Single source of truth for Gemini API-key or Google Cloud access.

`langchain_google_vertexai` is imported lazily inside the factory functions:
it pulls in the full google-cloud-aiplatform stack, which is slow to import
and unnecessary for unit tests and offline tooling that import the graph
modules without ever calling an LLM.
"""

from __future__ import annotations

from functools import lru_cache

from app.config import settings
from app.llm.api_key_client import ApiKeyGemini, GeminiChat


def gemini_auth_mode() -> str:
    if settings.gemini_auth_mode == "auto":
        return "api_key" if settings.gemini_api_key.get_secret_value().strip() else "adc"
    return settings.gemini_auth_mode


def gemini(
    *,
    model: str | None = None,
    temperature: float = 0.1,
    max_output_tokens: int = 4096,
    streaming: bool = True,
) -> GeminiChat:
    """Return a Gemini chat client using the selected authentication mode.

    An explicit API-key mode requires a key and never falls back to ADC.
    Auto mode prefers an available key; ADC remains available explicitly.
    """
    if gemini_auth_mode() == "api_key":
        key = settings.gemini_api_key.get_secret_value().strip()
        if not key:
            raise RuntimeError("GEMINI_API_KEY is required when GEMINI_AUTH_MODE=api_key")
        return ApiKeyGemini(
            api_key=key,
            backend=settings.gemini_api_backend,
            model=model or settings.vertex_model,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
        )

    from langchain_google_vertexai import ChatVertexAI

    return ChatVertexAI(
        model_name=model or settings.vertex_model,
        project=settings.gcp_project_id or None,
        location=settings.gcp_location,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        streaming=streaming,
        # REST by default — see config.vertex_api_transport for the grpc/onnx
        # native-symbol clash this avoids.
        api_transport=settings.vertex_api_transport,
        max_retries=1,
    )


@lru_cache(maxsize=4)
def cached_gemini(model: str, temperature: float) -> GeminiChat:
    return gemini(model=model, temperature=temperature, streaming=False)


def gemini_fast() -> GeminiChat:
    """Cheap structured-extraction calls (parse_submission, self_critique)."""
    return cached_gemini(settings.vertex_fast_model, 0.0)
