"""Chat / triage SSE endpoint.

Event types emitted:
  - node_enter      : enter a LangGraph node
  - node_exit       : leave a LangGraph node
  - tool_call       : tool invocation start
  - tool_result     : tool invocation finish
  - citation        : source-document chunk attached to the working answer
  - token           : streaming memo text (whitespace-preserving)
  - redraft         : the critique loop produced a NEW draft; the client
                      should clear the previous memo text before appending
  - critique_judge  : which model judged this iteration, and any judge error
  - final           : end-of-run with the full memo + run_id
  - error           : terminal error
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid

from fastapi import APIRouter, HTTPException, Request
from sse_starlette.sse import EventSourceResponse

from app.api.auth import verify_hmac
from app.schemas import ChatRequest, ToolCall

router = APIRouter()
log = logging.getLogger(__name__)

_TOKEN_RE = re.compile(r"\S+\s*")


def split_stream_tokens(text: str) -> list[str]:
    """Split text into word tokens that KEEP their trailing whitespace, so
    re-joining the stream reproduces the memo byte-for-byte (newlines,
    markdown indentation and all)."""
    return _TOKEN_RE.findall(text) or ([text] if text else [])


@router.post("/chat")
async def chat(request: Request):
    await verify_hmac(request)
    body = await request.json()
    try:
        req = ChatRequest.model_validate(body)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"invalid request: {e}")

    graph = request.app.state.graph
    run_id = uuid.uuid4().hex
    t0 = time.time()

    async def event_stream():
        seen_calls: set[str] = set()
        seen_results: set[str] = set()
        seen_citations: set[str] = set()
        last_node: str | None = None
        streamed = ""          # exactly what has been sent as token events
        seen_draft = 0         # draft_iters already streamed
        final_memo = ""

        try:
            async for event in graph.astream(
                {
                    "submission_id": req.submission_id,
                    "user_message": req.message,
                    "history": req.history,
                    "tool_calls": [],
                    "tool_results": [],
                    "retrieved": [],
                    "citations": [],
                    "critique_iters": 0,
                    "draft_iters": 0,
                    "critique_provider_override": req.critique_provider,
                },
                config={"configurable": {"thread_id": run_id}},
                stream_mode="updates",
            ):
                # `event` is { node_name: state_delta } in updates mode.
                for node_name, delta in event.items():
                    if delta is None:
                        delta = {}
                    if node_name != last_node:
                        if last_node:
                            yield {
                                "event": "node_exit",
                                "data": json.dumps({"node": last_node, "t_ms": int((time.time() - t0) * 1000)}),
                            }
                        yield {
                            "event": "node_enter",
                            "data": json.dumps({"node": node_name, "t_ms": int((time.time() - t0) * 1000)}),
                        }
                        last_node = node_name

                    # Tool calls
                    for tc in delta.get("tool_calls", []) or []:
                        tcm: ToolCall = tc if isinstance(tc, ToolCall) else ToolCall.model_validate(tc)
                        if tcm.id in seen_calls:
                            continue
                        seen_calls.add(tcm.id)
                        yield {
                            "event": "tool_call",
                            "data": json.dumps(
                                {"id": tcm.id, "name": tcm.name, "input": tcm.input}
                            ),
                        }
                    # Tool results
                    for tr in delta.get("tool_results", []) or []:
                        trm: ToolCall = tr if isinstance(tr, ToolCall) else ToolCall.model_validate(tr)
                        if trm.output is None or trm.id in seen_results:
                            continue
                        seen_results.add(trm.id)
                        yield {
                            "event": "tool_result",
                            "data": json.dumps(
                                {"id": trm.id, "name": trm.name, "output": trm.output, "ms": trm.ms or 0}
                            ),
                        }

                    # Citations
                    for cit in delta.get("citations", []) or []:
                        key = f"{cit.ref}|{cit.doc_id}"
                        if key in seen_citations:
                            continue
                        seen_citations.add(key)
                        yield {
                            "event": "citation",
                            "data": json.dumps(
                                {"ref": cit.ref, "doc_id": cit.doc_id, "snippet": cit.snippet}
                            ),
                        }

                    # Critique judge identification — emit once per iteration,
                    # including judge failures so the UI can flag an
                    # unreviewed memo instead of hiding the outage.
                    judge = delta.get("critique_judge")
                    if judge and judge not in ("skipped",):
                        yield {
                            "event": "critique_judge",
                            "data": json.dumps(
                                {
                                    "judge": judge,
                                    "iter": delta.get("critique_iters", 0),
                                    "passed": bool(delta.get("critique_pass", True)),
                                    "error": delta.get("critique_error"),
                                    "gaps": delta.get("critique_gaps") or [],
                                }
                            ),
                        }

                    # Stream memo tokens. draft_memo writes complete drafts;
                    # `draft_iters` tells us whether this is an incremental
                    # continuation (same draft) or a brand-new draft from the
                    # critique loop (client must reset, we re-stream fully).
                    md = delta.get("memo_md")
                    if md:
                        draft = delta.get("draft_iters", seen_draft or 1)
                        if draft > seen_draft and seen_draft > 0:
                            yield {"event": "redraft", "data": json.dumps({"iter": draft})}
                            streamed = ""
                        seen_draft = max(seen_draft, draft)
                        new = md[len(streamed):] if md.startswith(streamed) else md
                        if new and not md.startswith(streamed):
                            # Unexpected divergence within one draft: resync.
                            yield {"event": "redraft", "data": json.dumps({"iter": draft})}
                            streamed = ""
                        if new:
                            for tok in split_stream_tokens(new):
                                yield {"event": "token", "data": json.dumps({"text": tok})}
                                await asyncio.sleep(0.004)
                            streamed += new
                        final_memo = md

            if last_node:
                yield {
                    "event": "node_exit",
                    "data": json.dumps({"node": last_node, "t_ms": int((time.time() - t0) * 1000)}),
                }
            yield {
                "event": "final",
                "data": json.dumps({"memo": final_memo, "run_id": run_id}),
            }
        except Exception as e:
            log.exception("chat stream failed")
            yield {"event": "error", "data": json.dumps({"message": str(e)})}

    return EventSourceResponse(event_stream())
