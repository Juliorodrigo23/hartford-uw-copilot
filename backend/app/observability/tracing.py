"""Optional LangSmith graph, tool, and native provider tracing.

Explicit clients/context also support settings read from .env (Pydantic does
not export those into os.environ). No provider credentials enter trace input.
"""

from __future__ import annotations

import asyncio
import logging
from functools import lru_cache
from uuid import UUID

from langchain_core.tracers.langchain import LangChainTracer
from langsmith import Client, tracing_context
from langsmith.wrappers import wrap_gemini, wrap_openai

from app.config import settings

log = logging.getLogger(__name__)


@lru_cache
def tracing_client() -> Client | None:
    if not settings.langsmith_tracing or not settings.langsmith_api_key.get_secret_value():
        return None
    return Client(
        api_key=settings.langsmith_api_key.get_secret_value(),
        api_url=settings.langsmith_endpoint,
        workspace_id=settings.langsmith_workspace_id or None,
        timeout_ms=(2000, 4000),
    )


def trace_gemini(client):
    if tracing_client() is not None:
        return wrap_gemini(client)
    return client


def trace_openai(client):
    if tracing_client() is not None:
        return wrap_openai(client)
    return client


async def flush_traces() -> None:
    client = tracing_client()
    if client is not None:
        try:
            await asyncio.to_thread(client.flush, timeout=5)
        except Exception as exc:
            # Never expose credential-bearing exception text or fail a memo
            # because monitoring is temporarily unavailable.
            log.warning("LangSmith flush failed (%s)", type(exc).__name__)


async def stream_graph(graph, inputs: dict, *, run_id: str):
    """Nest SDK spans under their graph parent and flush on exit.

    The same UUID identifies the SSE result, checkpoint thread and root trace.
    Explicit callbacks avoid relying on process-global environment variables.
    """
    client = tracing_client()
    config = {
        "configurable": {"thread_id": run_id},
        "run_id": UUID(run_id),
        "run_name": "underwriting-triage",
        "tags": ["underwriting", settings.app_environment],
        "metadata": {
            "submission_id": inputs.get("submission_id"),
            "critique_provider": inputs.get("critique_provider_override") or settings.critique_provider,
            "environment": settings.app_environment,
        },
    }
    if client is not None:
        config["callbacks"] = [LangChainTracer(client=client, project_name=settings.langsmith_project)]
    with tracing_context(
        enabled=client is not None, client=client, project_name=settings.langsmith_project,
    ):
        try:
            async for event in graph.astream(inputs, config=config, stream_mode=["updates", "debug"]):
                yield event
        finally:
            await flush_traces()
