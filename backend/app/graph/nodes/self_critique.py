"""self_critique — judge our own memo against a rubric, route back if gaps remain.

Cross-family runtime critique:
  - CRITIQUE_PROVIDER=openai → GPT-4o judges Gemini's draft (no self-judging bias)
  - CRITIQUE_PROVIDER=gemini → Gemini Flash judges Gemini's draft (cheaper)
  - CRITIQUE_PROVIDER=auto   → openai when a key is present, otherwise gemini

Failure policy: the gate FAILS OPEN (the run finalizes what it has rather
than dying because a judge was unreachable) but never silently. Any judge
failure is recorded on `critique_error`, the judge label reflects what
actually ran, and the SSE layer surfaces it to the trace UI.
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
from app.schemas import CritiqueVerdict

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
    cits = state.get("citations") or []
    if cits:
        bits.append("VALID CITATION REFS · " + ", ".join(c.ref for c in cits))
    else:
        bits.append("VALID CITATION REFS · none (any [n] in the memo is a critical gap)")
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
        raise ValueError(f"judge returned non-JSON: {text[:200]!r}")
    return json.loads(text[start : end + 1])


async def self_critique(state: AgentState) -> AgentState:
    iters = state.get("critique_iters", 0) + 1
    memo = state.get("memo_md", "")

    if state.get("disable_critique"):
        return {
            "critique_pass": True,
            "critique_iters": iters,
            "critique_gaps": [],
            "rubric_scores": {},
            "critique_judge": "disabled",
            "critique_error": None,
        }

    if not memo:
        return {
            "critique_pass": True,
            "critique_iters": iters,
            "critique_gaps": [],
            "rubric_scores": {},
            "critique_judge": "skipped",
            "critique_error": "no memo to critique",
        }

    evidence = _evidence_summary(state)
    provider = _resolve_provider(state)
    judge_used = settings.openai_judge_model if provider == "openai" else settings.vertex_fast_model
    error: str | None = None
    raw: dict | None = None

    try:
        if provider == "openai":
            raw = await openai_runtime_critique(memo, evidence)
            if raw is None:
                # No key / OpenAI down — fall back to Gemini, and say so.
                log.warning("openai critique unavailable; falling back to gemini")
                judge_used = settings.vertex_fast_model
                raw = await _gemini_critique(memo, evidence)
        else:
            raw = await _gemini_critique(memo, evidence)
    except Exception as e:
        # FAIL OPEN, VISIBLY: the run finalizes, but the state records that
        # this memo was NOT quality-checked, and the UI shows it.
        error = f"critique judge failed ({judge_used}): {e}"
        log.error(error)
        return {
            "critique_pass": True,
            "critique_iters": iters,
            "critique_gaps": [],
            "rubric_scores": {},
            "critique_judge": f"error:{judge_used}",
            "critique_error": error,
        }

    try:
        verdict = CritiqueVerdict.model_validate(raw or {})
    except Exception as e:
        error = f"judge returned malformed verdict: {e}"
        log.error(error)
        return {
            "critique_pass": True,
            "critique_iters": iters,
            "critique_gaps": [],
            "rubric_scores": {},
            "critique_judge": f"error:{judge_used}",
            "critique_error": error,
        }

    return {
        "critique_pass": verdict.pass_,
        "critique_iters": iters,
        "critique_gaps": list(verdict.gaps),
        "rubric_scores": dict(verdict.rubric_scores),
        "critique_judge": judge_used,
        "critique_error": None,
    }
