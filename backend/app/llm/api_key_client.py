"""Google API-key transport with the chat interface used by the graph.

Supports Vertex AI express keys and Google AI Studio/Gemini Developer keys.
Project/location and ADC are deliberately omitted for API-key calls.
"""

from collections.abc import AsyncIterator, Sequence
from typing import Protocol

from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage

from app.llm.text import response_text
from app.observability.tracing import trace_gemini


class GeminiChat(Protocol):
    async def ainvoke(self, messages: str | Sequence[BaseMessage]) -> AIMessage: ...

    def astream(self, messages: str | Sequence[BaseMessage]) -> AsyncIterator[AIMessageChunk]: ...


class ApiKeyGemini:
    def __init__(self, *, api_key: str, backend: str, model: str, temperature: float, max_output_tokens: int):
        self._api_key = api_key
        self.backend = backend
        self.model = model
        self.temperature = temperature
        self.max_output_tokens = max_output_tokens

    def _client(self):
        from google import genai
        from google.genai import types

        return trace_gemini(genai.Client(
            vertexai=self.backend == "vertex",
            api_key=self._api_key,
            http_options=types.HttpOptions(
                timeout=120000,
                retry_options=types.HttpRetryOptions(attempts=2),
            ),
        ))

    def _request(self, messages: str | Sequence[BaseMessage]) -> dict:
        from google.genai import types

        if isinstance(messages, str):
            contents = [types.Content(role="user", parts=[types.Part.from_text(text=messages)])]
            system = []
        else:
            system = [response_text(m.content) for m in messages if m.type == "system"]
            contents = [
                types.Content(
                    role="model" if m.type == "ai" else "user",
                    parts=[types.Part.from_text(text=response_text(m.content))],
                )
                for m in messages if m.type != "system"
            ]
        return {
            "model": self.model,
            "contents": contents,
            "config": types.GenerateContentConfig(
                system_instruction="\n\n".join(system) or None,
                temperature=self.temperature,
                max_output_tokens=self.max_output_tokens,
            ),
        }

    async def ainvoke(self, messages: str | Sequence[BaseMessage]) -> AIMessage:
        with self._client() as client:
            async with client.aio as aio:
                response = await aio.models.generate_content(**self._request(messages))
                return AIMessage(content=response.text or "")

    async def astream(self, messages: str | Sequence[BaseMessage]) -> AsyncIterator[AIMessageChunk]:
        with self._client() as client:
            async with client.aio as aio:
                stream = await aio.models.generate_content_stream(**self._request(messages))
                async for response in stream:
                    if response.text:
                        yield AIMessageChunk(content=response.text)
