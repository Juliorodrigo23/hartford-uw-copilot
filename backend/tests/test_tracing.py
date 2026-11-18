"""Trace parentage, native SDK usage, and isolation from provider credentials."""

import json
from typing import TypedDict
from unittest.mock import Mock
from uuid import uuid4

import httpx
import requests
from google import genai
from google.genai import types
from langgraph.graph import END, START, StateGraph
from langsmith import Client, traceable
from openai import AsyncOpenAI

from app.config import Settings, settings
from app.observability import tracing


class CaptureSession(requests.Session):
    def __init__(self):
        super().__init__()
        self.operations = []

    def send(self, request, **kwargs):
        if request.body:
            self.operations.append((request.method, request.url, json.loads(request.body)))
        response = requests.Response()
        response.status_code = 200
        response._content = b"{}"
        response.request = request
        return response


def test_disabled_tracing_needs_no_client_or_key(monkeypatch):
    monkeypatch.setattr(tracing, "Client", Mock(side_effect=AssertionError("unexpected client")))
    assert tracing.tracing_client() is None
    sdk = object()
    assert tracing.trace_gemini(sdk) is sdk
    assert tracing.trace_openai(sdk) is sdk
    config = Settings(_env_file=None, LANGSMITH_API_KEY="private-monitoring-key")
    assert "private-monitoring-key" not in repr(config)


async def test_graph_and_both_sdk_calls_share_one_trace(monkeypatch):
    session = CaptureSession()
    client = Client(api_key="test-monitoring-key", api_url="http://trace.invalid", session=session,
                    auto_batch_tracing=False, info={"version": "test"})
    monkeypatch.setattr(tracing, "tracing_client", lambda: client)
    monkeypatch.setattr(settings, "langsmith_project", "underwriting-copilot-production")
    monkeypatch.setattr(settings, "app_environment", "production")

    def gemini_response(request):
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, text="data: " + json.dumps({
            "candidates": [{"content": {"role": "model", "parts": [{"text": "Synthetic memo"}]}}],
            "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 3, "totalTokenCount": 13},
        }) + "\n\n")

    def openai_response(request):
        return httpx.Response(200, json={"id": "chatcmpl-test", "object": "chat.completion", "created": 1,
            "model": "gpt-4o", "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "Pass"}}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 1, "total_tokens": 13}})

    class State(TypedDict, total=False):
        submission_id: str
        memo: str
        review: str

    @traceable(name="test_evidence", run_type="tool")
    def evidence():
        return {"source": "synthetic"}

    async def draft(state):
        evidence()
        with genai.Client(api_key="private-google-key", http_options=types.HttpOptions(
            async_client_args={"transport": httpx.MockTransport(gemini_response)},
        )) as sdk:
            tracing.trace_gemini(sdk)
            async with sdk.aio as aio:
                chunks = await aio.models.generate_content_stream(model="gemini-test", contents="Draft")
                memo = "".join([part.text async for part in chunks])
        return {"memo": memo}

    async def review(state):
        async with AsyncOpenAI(api_key="private-openai-key", http_client=httpx.AsyncClient(
            transport=httpx.MockTransport(openai_response),
        )) as sdk:
            tracing.trace_openai(sdk)
            result = await sdk.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": state["memo"]}])
        return {"review": result.choices[0].message.content}

    builder = StateGraph(State)
    builder.add_node("draft_memo", draft)
    builder.add_node("self_critique", review)
    builder.add_edge(START, "draft_memo")
    builder.add_edge("draft_memo", "self_critique")
    builder.add_edge("self_critique", END)
    run_id = uuid4()
    events = [event async for event in tracing.stream_graph(builder.compile(), {"submission_id": "SUB-TEST"}, run_id=run_id.hex)]
    assert any(mode == "updates" and event.get("self_critique", {}).get("review") == "Pass" for mode, event in events)
    # LangChain persists completed runs on its callback executor.
    from langchain_core.tracers.langchain import wait_for_all_tracers
    wait_for_all_tracers()
    creates = [body for method, url, body in session.operations if method == "POST" and url.endswith("/runs")]
    root = next(run for run in creates if run["name"] == "underwriting-triage")
    assert root["id"] == str(run_id)
    assert root["session_name"] == "underwriting-copilot-production"
    assert root["extra"]["metadata"]["thread_id"] == run_id.hex
    spans = {run["name"]: run for run in creates}
    for model, parent in [("ChatGoogleGenerativeAI", "draft_memo"), ("ChatOpenAI", "self_critique")]:
        assert spans[model]["run_type"] == "llm"
        assert spans[model]["parent_run_id"] == spans[parent]["id"]
        assert spans[model]["trace_id"] == str(run_id)
    assert spans["test_evidence"]["run_type"] == "tool"
    serialized = json.dumps(session.operations)
    assert "private-google-key" not in serialized and "private-openai-key" not in serialized
    updates = [body for method, _, body in session.operations if method == "PATCH"]
    assert any(body.get("usage_metadata", {}).get("total_tokens") == 13 or body.get("extra", {}).get("metadata", {}).get("usage_metadata", {}).get("total_tokens") == 13 for body in updates)


async def test_monitoring_flush_failure_is_nonfatal(monkeypatch):
    client = Mock()
    client.flush.side_effect = RuntimeError("private-secret-in-error")
    monkeypatch.setattr(tracing, "tracing_client", lambda: client)
    await tracing.flush_traces()
