"""enrich_carrier — call FMCSA SAFER for the DOT on the submission."""

from __future__ import annotations

import logging
import time
import uuid

from app.graph.state import AgentState
from app.schemas import ToolCall
from app.tools.safer_lookup import safer_lookup

log = logging.getLogger(__name__)


async def enrich_carrier(state: AgentState) -> AgentState:
    sub = state.get("submission")
    if not sub:
        return {"safer_profile": None, "data_insufficient_reason": "no submission to enrich"}

    call_id = uuid.uuid4().hex[:8]
    t0 = time.time()
    profile = await safer_lookup(sub.dot_number)
    ms = int((time.time() - t0) * 1000)

    tc = ToolCall(
        id=call_id,
        name="safer_lookup",
        input={"dot_number": sub.dot_number},
        output=profile.model_dump(mode="json") if profile else None,
        ms=ms,
    )
    return {
        "safer_profile": profile,
        "tool_calls": [*state.get("tool_calls", []), tc],
        "tool_results": [*state.get("tool_results", []), tc],
        "data_insufficient_reason": None if profile else f"DOT {sub.dot_number} not in SAFER",
    }
