"""draft_memo — Gemini 2.0 Pro generates the underwriting memo."""

from __future__ import annotations

import json
import logging

from langchain_core.messages import HumanMessage, SystemMessage

from app.graph.state import AgentState
from app.llm.prompts.memo import MEMO_SYSTEM, MEMO_TEMPLATE
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
        return "(no loss runs)"
    return json.dumps(s.model_dump(mode="json"), indent=2, default=str)


def _format_retrieved(state: AgentState) -> str:
    items = state.get("retrieved", []) or []
    if not items:
        return "(no retrieved evidence)"
    return "\n".join(f"[{i+1}] ({c.source} · {c.doc_id}): {c.text[:480]}" for i, c in enumerate(items))


def _format_xgb(state: AgentState) -> tuple[str, str, str]:
    p = state.get("xgb_pred")
    if not p:
        return ("n/a", "(n/a)", "(n/a)")
    pi = f"({p.pi_80[0]:.1f}, {p.pi_80[1]:.1f})"
    pred = f"{p.pred_claims_next_yr:.1f}"
    shap = "\n".join(f"  - {x['f']}: {x['v']:+.2f}" for x in (p.shap_top or []))
    return pred, pi, shap or "  (no SHAP)"


def _format_comps(state: AgentState) -> str:
    cs = state.get("comparables") or []
    if not cs:
        return "(none)"
    return "\n".join(f"  - {c.get('id')}: {c.get('summary')}" for c in cs[:5])


async def draft_memo(state: AgentState) -> AgentState:
    sub = state.get("submission")
    if not sub:
        return {"memo_md": "Cannot draft memo: submission missing."}
    pred, pi, shap = _format_xgb(state)
    user = MEMO_TEMPLATE.format(
        sub_id=sub.id,
        carrier_name=sub.carrier_name,
        dot_number=sub.dot_number,
        fleet_size=sub.fleet_size,
        vehicle_mix=json.dumps(sub.vehicle_mix.model_dump()),
        states=", ".join(sub.states_of_operation) or "—",
        commodity=sub.commodity,
        effective_date=sub.effective_date.isoformat(),
        safer=_format_safer(state),
        loss_stats=_format_loss(state),
        xgb_pred=pred,
        xgb_pi=pi,
        shap_top=shap,
        comparables=_format_comps(state),
        retrieved=_format_retrieved(state),
    )
    llm = gemini(temperature=0.2)
    chunks: list[str] = []
    try:
        async for piece in llm.astream([
            SystemMessage(content=MEMO_SYSTEM),
            HumanMessage(content=user),
        ]):
            text = piece.content if isinstance(piece.content, str) else str(piece.content)
            if text:
                chunks.append(text)
        memo = "".join(chunks)
    except Exception as e:
        log.exception("draft_memo failed")
        memo = f"## Underwriting memo\n\nError generating memo: {e}"
    return {"memo_md": memo}
