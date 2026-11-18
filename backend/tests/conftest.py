"""Unit tests must never export traces using a developer's private .env key."""

import pytest

from app.config import settings
from app.observability.tracing import tracing_client


@pytest.fixture(autouse=True)
def disable_external_tracing(monkeypatch):
    monkeypatch.setenv("LANGSMITH_TRACING", "false")
    monkeypatch.setenv("LANGCHAIN_TRACING_V2", "false")
    monkeypatch.setattr(settings, "langsmith_tracing", False)
    tracing_client.cache_clear()
    yield
    tracing_client.cache_clear()
