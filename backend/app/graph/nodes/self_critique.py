"""self_critique — judge our own memo against a rubric, route back if gaps remain.

Cross-family runtime critique:
  - CRITIQUE_PROVIDER=openai → GPT-4o judges Gemini's draft (no self-judging bias)
  - CRITIQUE_PROVIDER=gemini → Gemini Flash judges Gemini's draft (cheaper)
  - CRITIQUE_PROVIDER=auto   → openai when a key is present, otherwise gemini

The frontend can also override per-request by passing `critique_provider`
in the chat body (set on `state['critique_provider_override']`).
"""

from __future__ import annotations

import json
import logging

from langchain_core.messages import HumanMessage, SystemMessage

from app.config import settings
from app.graph.state import AgentState
from app.llm.judge_client import openai_runtime_critique
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


def _resolve_provider(state: AgentState) -> str:
    """Per-request override > env > auto."""
    override = state.get("critique_provider_override")
    if override in ("openai", "gemini"):
        return override  # type: ignore[return-value]
    cfg = (settings.critique_provider or "auto").lower()
    if cfg == "auto":
        return "openai" if settings.openai_api_key else "gemini"
    return cfg


async def _gemini_critique(memo: str, evidence: str) -> dict:
    llm = gemini_fast()
    resp = await llm.ainvoke([
        SystemMessage(content="You return strict JSON only."),
        HumanMessage(content=CRITIQUE_PROMPT.format(memo=memo, evidence=evidence)),
    ])
    text = resp.content if isinstance(resp.content, str) else str(resp.content)
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return {"pass": True, "rubric_scores": {}, "gaps": []}
    return json.loads(text[start : end + 1])


async def self_critique(state: AgentState) -> AgentState:
    iters = state.get("critique_iters", 0) + 1
    memo = state.get("memo_md", "")
    if not memo:
        return {
            "critique_pass": True,
            "critique_iters": iters,
            "critique_gaps": [],
            "rubric_scores": {},
            "critique_judge": "skipped",
        }

    evidence = _evidence_summary(state)
    provider = _resolve_provider(state)
    judge_used = "gpt-4o" if provider == "openai" else "gemini-2.5-flash"
    out: dict | None = None

    try:
        if provider == "openai":
            out = await openai_runtime_critique(memo, evidence)
            if out is None:
                # No key / OpenAI down — fall through to Gemini
                log.info("openai critique unavailable; falling back to gemini")
                judge_used = "gemini-2.5-flash"
                out = await _gemini_critique(memo, evidence)
        else:
            out = await _gemini_critique(memo, evidence)
    except Exception as e:
        log.warning("critique failed (%s): %s", judge_used, e)
        out = {"pass": True, "rubric_scores": {}, "gaps": []}

    out = out or {}
    return {
        "critique_pass": bool(out.get("pass", True)),
        "critique_iters": iters,
        "critique_gaps": list(out.get("gaps") or []),
        "rubric_scores": out.get("rubric_scores") or {},
        "critique_judge": judge_used,
    }
