"""draft_memo — Gemini generates the underwriting memo."""

from __future__ import annotations

import asyncio
import json
import logging

from langchain_core.messages import HumanMessage, SystemMessage

from app.graph.state import AgentState
from app.llm.evidence import evidence_hash, evidence_json
from app.llm.prompts.memo import MEMO_SYSTEM, MEMO_TEMPLATE
from app.llm.text import response_text
from app.llm.vertex_client import gemini

log = logging.getLogger(__name__)


def _format_safer(state: AgentState) -> str:
    safer = state.get("safer_profile")
    if not safer:
        return "(SAFER lookup unavailable)"
    return json.dumps(safer.model_dump(mode="json"), indent=2)


def _format_loss(state: AgentState) -> str:
    s = state.get("loss_stats")
    if not s:
        return (
            "(no loss runs provided by the broker — treat loss history as UNKNOWN, "
            "list it as an open question, do not state any frequency or severity numbers)"
        )
    d = s.model_dump(mode="json")
    return (
        json.dumps(d, indent=2, default=str)
        + f"\n(note: loss_ratio_3yr assumes premium ≈ ${s.assumed_premium_per_pu_usd}/power unit/yr; "
        "disclose this assumption if you cite the ratio)"
    )


def _format_retrieved(state: AgentState) -> str:
    items = state.get("retrieved", []) or []
    if not items:
        return (
            "(no retrieved evidence — do NOT emit any [n] citations; "
            "say explicitly that corpus evidence was unavailable)"
        )
    return "\n".join(f"[{i+1}] ({c.source} · {c.doc_id}): {c.text[:480]}" for i, c in enumerate(items))


def _format_xgb(state: AgentState) -> tuple[str, str, str]:
    p = state.get("xgb_pred")
    if not p:
        return ("n/a", "(n/a)", "  (model not run)")
    pi = f"({p.pi_80[0]:.1f}, {p.pi_80[1]:.1f})"
    pred = f"{p.pred_claims_next_yr:.1f}"
    if p.source == "heuristic_fallback":
        pred += " [HEURISTIC ESTIMATE — trained model unavailable; describe this as a rough actuarial heuristic, NOT as a model prediction]"
        return pred, pi, "  (no SHAP: heuristic estimate, not a model)"
    pred += f" [XGBoost {p.model_version or 'trained model'}]"
    shap = "\n".join(f"  - {x['f']}: {x['v']:+.2f}" for x in (p.shap_top or []))
    return pred, pi, shap or "  (no SHAP available)"


def _format_comps(state: AgentState) -> str:
    cs = state.get("comparables") or []
    if not cs:
        return "(none)"
    return "\n".join(f"  - {c.get('id')}: {c.get('summary')}" for c in cs[:5])


def _format_history(state: AgentState) -> str:
    hist = state.get("history") or []
    if not hist:
        return "(none)"
    lines = []
    for turn in hist[-6:]:
        role = turn.get("role", "user")
        content = (turn.get("content") or turn.get("text") or "")[:600]
        if content:
            lines.append(f"{role}: {content}")
    return "\n".join(lines) or "(none)"


async def draft_memo(state: AgentState) -> AgentState:
    sub = state.get("submission")
    draft_iters = state.get("draft_iters", 0) + 1
    if not sub:
        raise RuntimeError("Cannot draft memo: submission missing.")
    pred, pi, shap = _format_xgb(state)
    user = MEMO_TEMPLATE.format(
        sub_id=sub.id,
        carrier_name=sub.carrier_name,
        dot_number=sub.dot_number,
        safer_legal_name=sub.safer_legal_name or "(not on file)",
        fleet_size=sub.fleet_size,
        vehicle_mix=json.dumps(sub.vehicle_mix.model_dump()),
        states=", ".join(sub.states_of_operation) or "—",
        commodity=sub.commodity,
        effective_date=sub.effective_date.isoformat(),
        full_package=evidence_json(state),
        safer=_format_safer(state),
        loss_stats=_format_loss(state),
        xgb_pred=pred,
        xgb_pi=pi,
        shap_top=shap,
        comparables=_format_comps(state),
        retrieved=_format_retrieved(state),
        history=_format_history(state),
        user_message=state.get("user_message", "") or "(none)",
        critique_feedback=(
            "PRIOR CRITIQUE FLAGGED THESE GAPS — address every one explicitly:\n- "
            + "\n- ".join(state.get("critique_gaps") or [])
            if state.get("critique_iters", 0) > 0 and state.get("critique_gaps")
            else "(first draft)"
        ),
    )
    chunks: list[str] = []
    try:
        llm = gemini(temperature=0.2, max_output_tokens=8192)
        async with asyncio.timeout(120):
            async for piece in llm.astream([
                SystemMessage(content=MEMO_SYSTEM),
                HumanMessage(content=user),
            ]):
                text = response_text(piece.content)
                if text:
                    chunks.append(text)
        memo = "".join(chunks)
        if not memo.strip():
            raise ValueError("generator returned an empty memo")
    except Exception:
        log.exception("draft_memo failed")
        raise RuntimeError(
            "Memo generation failed. No underwriting recommendation was produced. "
            "Please retry; if this persists, check the configured Gemini model and endpoint."
        ) from None
    return {"memo_md": memo, "draft_iters": draft_iters, "draft_packet_hash": evidence_hash(state)}
