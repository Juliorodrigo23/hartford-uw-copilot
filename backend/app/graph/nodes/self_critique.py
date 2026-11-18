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

import asyncio
import json
import logging

from langchain_core.messages import HumanMessage, SystemMessage

from app.config import settings
from app.graph.state import AgentState
from app.llm.evidence import evidence_hash, evidence_json
from app.llm.judge_client import openai_runtime_critique
from app.llm.prompts.memo import CRITIQUE_PROMPT
from app.llm.text import response_text
from app.llm.vertex_client import gemini_fast
from app.schemas import CritiqueVerdict

log = logging.getLogger(__name__)


def _evidence_summary(state: AgentState) -> str:
    return evidence_json(state)


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
    async with asyncio.timeout(40):
        resp = await llm.ainvoke([
            SystemMessage(content="You return strict JSON only."),
            HumanMessage(content=CRITIQUE_PROMPT.format(memo=memo, evidence=evidence)),
        ])
    text = response_text(resp.content)
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
            "critique_pass": False,
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
    warning: str | None = None
    raw: dict | None = None
    # An explicit selection must never silently execute a different provider.
    allow_fallback = not state.get("critique_provider_override") and settings.critique_provider == "auto"

    try:
        if provider == "openai":
            try:
                raw = await openai_runtime_critique(memo, evidence)
                if raw is None:
                    raise RuntimeError("OpenAI critique is not configured")
                CritiqueVerdict.model_validate(raw)
            except Exception:
                if not allow_fallback:
                    raise RuntimeError("Selected OpenAI judge is unavailable; check its API key and model access.") from None
                warning = "OpenAI judge unavailable; auto mode used the Gemini judge."
                log.warning(warning)
                judge_used = settings.vertex_fast_model
                raw = await _gemini_critique(memo, evidence)
        else:
            raw = await _gemini_critique(memo, evidence)
    except Exception as e:
        # FAIL OPEN, VISIBLY: the run finalizes, but the state records that
        # this memo was NOT quality-checked, and the UI shows it.
        error = f"Critique judge unavailable ({judge_used}); this memo needs human review."
        log.error("%s [%s]", error, type(e).__name__)
        return {
            "critique_pass": False,
            "critique_iters": iters,
            "critique_gaps": [],
            "rubric_scores": {},
            "critique_judge": f"error:{judge_used}",
            "critique_error": error,
            "critique_warning": warning,
        }

    try:
        verdict = CritiqueVerdict.model_validate(raw or {})
    except Exception as e:
        error = "Judge returned an invalid verdict; this memo needs human review."
        log.error("%s [%s]", error, type(e).__name__)
        return {
            "critique_pass": False,
            "critique_iters": iters,
            "critique_gaps": [],
            "rubric_scores": {},
            "critique_judge": f"error:{judge_used}",
            "critique_error": error,
            "critique_warning": warning,
        }

    return {
        "critique_pass": verdict.pass_,
        "critique_iters": iters,
        "critique_gaps": list(verdict.gaps),
        "rubric_scores": dict(verdict.rubric_scores),
        "critique_judge": judge_used,
        "critique_error": None,
        "critique_warning": warning,
        "missing_documents": list(verdict.missing_documents),
        "review_packet_hash": evidence_hash(state),
    }
