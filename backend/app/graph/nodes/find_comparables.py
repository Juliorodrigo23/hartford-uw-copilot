"""find_comparables — vector search over the synthetic book of business."""

from __future__ import annotations

import time
import uuid

from app.graph.state import AgentState
from app.schemas import ToolCall
from app.tools.comparable_search import comparable_search


async def find_comparables(state: AgentState) -> AgentState:
    sub = state.get("submission")
    if not sub:
        return {"comparables": []}
    t0 = time.time()
    comps = comparable_search(sub, k=5)
    ms = int((time.time() - t0) * 1000)
    tc = ToolCall(
        id=uuid.uuid4().hex[:8],
        name="comparable_search",
        input={"submission_id": sub.id, "k": 5},
        output={"matches": comps},
        ms=ms,
    )
    return {
        "comparables": comps,
        "tool_calls": [*state.get("tool_calls", []), tc],
        "tool_results": [*state.get("tool_results", []), tc],
    }
