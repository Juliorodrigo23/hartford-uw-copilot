"""parse_submission — turn a free-text broker email + raw packet into a Submission."""

from __future__ import annotations

import json
import logging
from datetime import date

from langchain_core.messages import HumanMessage, SystemMessage

from app.graph.state import AgentState
from app.llm.prompts.parse import PARSE_SYSTEM, PARSE_USER
from app.llm.vertex_client import gemini_fast
from app.schemas import Submission, VehicleMix
from app.tools.submissions import load_submission

log = logging.getLogger(__name__)


async def parse_submission(state: AgentState) -> AgentState:
    """Resolve the submission either by id (preferred) or by parsing user text."""
    sub_id = state.get("submission_id")
    if sub_id:
        sub = load_submission(sub_id)
        if sub:
            return {"submission": sub, "parse_notes": [f"loaded submission {sub_id} from disk"]}

    # Free-form text path: ask Gemini-Flash to extract.
    user_msg = state.get("user_message", "")
    llm = gemini_fast()
    try:
        resp = await llm.ainvoke([
            SystemMessage(content=PARSE_SYSTEM),
            HumanMessage(content=PARSE_USER.format(broker_email=user_msg, packet_excerpt="(not provided)")),
        ])
        text = resp.content if isinstance(resp.content, str) else str(resp.content)
        # Extract JSON
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            data = json.loads(text[start : end + 1])
        else:
            data = {}
    except Exception as e:
        log.warning("parse_submission LLM failed: %s", e)
        data = {}

    if not data.get("dot_number"):
        return {
            "submission": None,
            "parse_notes": ["could not extract DOT from input"],
        }

    try:
        sub = Submission(
            id=data.get("id") or "AD_HOC",
            carrier_name=data.get("carrier_name", "Unknown Carrier"),
            dot_number=str(data["dot_number"]),
            fleet_size=int(data.get("fleet_size", 1)),
            vehicle_mix=VehicleMix(**(data.get("vehicle_mix") or {"tractor": 1.0})).normalized(),
            states_of_operation=data.get("states_of_operation") or [],
            effective_date=date.fromisoformat(data.get("effective_date") or date.today().isoformat()),
            loss_run=[],
            broker_email=user_msg or "",
            commodity=data.get("commodity") or "general_freight",
        )
    except Exception as e:
        log.warning("parse_submission validation failed: %s", e)
        return {"submission": None, "parse_notes": [f"validation: {e}"]}
    return {"submission": sub, "parse_notes": ["parsed from free text"]}
