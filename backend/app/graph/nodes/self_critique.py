"""self_critique — judge our own memo against a rubric, route back if gaps remain."""

from __future__ import annotations

import json
import logging

from langchain_core.messages import HumanMessage, SystemMessage

from app.graph.state import AgentState
from app.llm.prompts.memo import CRITIQUE_PROMPT
from app.llm.vertex_client import gemini_fast

log = logging.getLogger(__name__)


def _evidence_summary(state: AgentState) -> str:
    bits: list[str] = []
    safer = state.get("safer_profile")
    if safer:
        bits.append("SAFER · " + json.dumps(safer.model_dump(mode="json")))
    s = state.get("loss_stats")
    if s:
        bits.append("LOSS · " + json.dumps(s.model_dump(mode="json"), default=str))
    p = state.get("xgb_pred")
    if p:
        bits.append("XGB · " + json.dumps(p.model_dump(mode="json")))
    return "\n".join(bits)


async def self_critique(state: AgentState) -> AgentState:
    iters = state.get("critique_iters", 0) + 1
    memo = state.get("memo_md", "")
    if not memo:
        return {
            "critique_pass": True,
            "critique_iters": iters,
            "critique_gaps": [],
            "rubric_scores": {},
        }

    llm = gemini_fast()
    try:
        resp = await llm.ainvoke([
            SystemMessage(content="You return strict JSON only."),
            HumanMessage(content=CRITIQUE_PROMPT.format(memo=memo, evidence=_evidence_summary(state))),
        ])
        text = resp.content if isinstance(resp.content, str) else str(resp.content)
        start = text.find("{")
        end = text.rfind("}")
        out = json.loads(text[start : end + 1]) if start >= 0 else {}
    except Exception as e:
        log.warning("critique LLM failed: %s", e)
        out = {"pass": True, "rubric_scores": {}, "gaps": []}

    return {
        "critique_pass": bool(out.get("pass", True)),
        "critique_iters": iters,
        "critique_gaps": list(out.get("gaps") or []),
        "rubric_scores": out.get("rubric_scores") or {},
    }
