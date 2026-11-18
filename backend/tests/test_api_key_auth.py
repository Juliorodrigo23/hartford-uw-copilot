"""API-key authentication, SDK request shape, and resource cleanup."""

import json
from unittest.mock import Mock

import httpx
import pytest
from google import genai
from google.genai import types
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from pydantic import SecretStr

from app.config import Settings, settings
from app.llm.api_key_client import ApiKeyGemini
from app.llm.vertex_client import gemini, gemini_auth_mode


@pytest.mark.parametrize("mode,key,expected", [("auto", "test-key", "api_key"), ("auto", "", "adc"), ("api_key", "test-key", "api_key"), ("adc", "test-key", "adc")])
def test_auth_mode_selection(monkeypatch, mode, key, expected):
    monkeypatch.setattr(settings, "gemini_auth_mode", mode)
    monkeypatch.setattr(settings, "gemini_api_key", SecretStr(key))
    assert gemini_auth_mode() == expected


def test_explicit_key_mode_does_not_fall_back_when_key_is_missing(monkeypatch):
    monkeypatch.setattr(settings, "gemini_auth_mode", "api_key")
    monkeypatch.setattr(settings, "gemini_api_key", SecretStr(""))
    with pytest.raises(RuntimeError, match="GEMINI_API_KEY is required"):
        gemini()


def test_key_is_redacted_in_settings_representation():
    config = Settings(_env_file=None, GEMINI_API_KEY="private-test-key")
    assert "private-test-key" not in repr(config)


@pytest.mark.parametrize("backend", ["vertex", "developer"])
def test_key_client_omits_adc_project_and_location(monkeypatch, backend):
    monkeypatch.setattr(settings, "gemini_auth_mode", "api_key")
    monkeypatch.setattr(settings, "gemini_api_backend", backend)
    monkeypatch.setattr(settings, "gemini_api_key", SecretStr("test-key"))
    factory = Mock()
    monkeypatch.setattr(genai, "Client", factory)
    gemini()._client()
    kwargs = factory.call_args.kwargs
    assert kwargs["api_key"] == "test-key"
    assert kwargs["vertexai"] is (backend == "vertex")
    assert not {"credentials", "project", "location"} & kwargs.keys()


@pytest.mark.parametrize("backend,host", [("vertex", "aiplatform.googleapis.com"), ("developer", "generativelanguage.googleapis.com")])
@pytest.mark.parametrize("streaming", [False, True])
async def test_sdk_uses_key_header_and_correct_endpoint(monkeypatch, backend, host, streaming):
    captured = []
    def handler(request):
        captured.append(request)
        payload = {"candidates": [{"content": {"role": "model", "parts": [{"text": "Valid memo"}]}, "finishReason": "STOP"}]}
        if streaming:
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, text="data: " + json.dumps(payload) + "\n\n")
        return httpx.Response(200, json=payload)

    clients = []
    def client_factory(_self):
        client = genai.Client(vertexai=backend == "vertex", api_key="test-key", http_options=types.HttpOptions(async_client_args={"transport":httpx.MockTransport(handler)}, client_args={"transport":httpx.MockTransport(handler)}))
        clients.extend([client._api_client._async_httpx_client, client._api_client._httpx_client])
        return client
    monkeypatch.setattr(ApiKeyGemini, "_client", client_factory)
    model = ApiKeyGemini(api_key="test-key", backend=backend, model="gemini-3.8-flash", temperature=0.2, max_output_tokens=1024)
    messages = [SystemMessage(content="Follow the rubric"), HumanMessage(content="First question"), AIMessage(content="Earlier answer"), HumanMessage(content="Triage")]
    if streaming:
        text = "".join([chunk.content async for chunk in model.astream(messages)])
    else:
        text = (await model.ainvoke(messages)).content
    assert text == "Valid memo"
    req = captured[0]
    assert req.url.host == host
    assert req.headers["x-goog-api-key"] == "test-key"
    assert "authorization" not in req.headers
    assert "projects/" not in req.url.path and "locations/" not in req.url.path
    body = json.loads(req.content)
    assert body["systemInstruction"]["parts"][0]["text"] == "Follow the rubric"
    assert [item["role"] for item in body["contents"]] == ["user", "model", "user"]
    assert all(client.is_closed for client in clients)


async def test_api_error_closes_resources_and_propagates(monkeypatch):
    from google.genai.errors import ClientError

    clients = []
    def client_factory(_self):
        transport = httpx.MockTransport(lambda request: httpx.Response(403, json={"error":{"code":403,"message":"Access denied","status":"PERMISSION_DENIED"}}))
        client = genai.Client(vertexai=False, api_key="test-key", http_options=types.HttpOptions(async_client_args={"transport":transport},client_args={"transport":transport}))
        clients.extend([client._api_client._async_httpx_client,client._api_client._httpx_client])
        return client
    monkeypatch.setattr(ApiKeyGemini, "_client", client_factory)
    model = ApiKeyGemini(api_key="test-key", backend="developer", model="gemini-3.8-flash", temperature=0, max_output_tokens=256)
    with pytest.raises(ClientError):
        await model.ainvoke("Triage")
    assert all(client.is_closed for client in clients)
