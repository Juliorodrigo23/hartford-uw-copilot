"""retrieve_context — hybrid RAG over NTSB / 10-K / coverage forms."""

from __future__ import annotations

import logging

from app.graph.state import AgentState
from app.rag.hybrid_search import hybrid_search
from app.schemas import Citation, RetrievedChunk

log = logging.getLogger(__name__)


def _build_query(state: AgentState) -> str:
    """Build a retrieval query from the submission + SAFER profile."""
    sub = state.get("submission")
    safer = state.get("safer_profile")
    parts: list[str] = []
    if sub:
        parts.append(f"{sub.fleet_size} power units commodity {sub.commodity} states {' '.join(sub.states_of_operation)}")
    if safer:
        parts.append(f"OOS rate vehicle {safer.oos_rate_vehicle:.2f} driver {safer.oos_rate_driver:.2f}")
        for k, v in safer.basic_violations.items():
            parts.append(f"BASIC {k} {v}")
    msg = state.get("user_message")
    if msg:
        parts.append(msg)
    return " · ".join(parts) or "commercial trucking risk evaluation"


async def retrieve_context(state: AgentState) -> AgentState:
    if state.get("disable_rag"):
        return {"retrieved": [], "citations": []}

    query = _build_query(state)
    iters = state.get("critique_iters", 0)

    # On second pass, broaden the retrieval by adding the critique gaps.
    gaps = state.get("critique_gaps", [])
    if iters > 0 and gaps:
        query += " · GAP: " + "; ".join(gaps)

    chunks = await hybrid_search(query=query, k_final=10)
    if not chunks:
        log.warning(
            "no chunks retrieved for query=%r — if this is unexpected, "
            "check that scripts/04_build_index.py has been run",
            query[:120],
        )

    # Merge with prior retrievals (loop iterations append, dedup by chunk id),
    # then number citations against the MERGED list so [n] refs in the memo
    # line up with what the model actually sees in the prompt.
    prior = state.get("retrieved", []) or []
    seen = {c.doc_id for c in prior}
    new = [c for c in chunks if c.doc_id not in seen]
    merged: list[RetrievedChunk] = list(prior) + new

    cits = [
        Citation(ref=f"[{i + 1}]", doc_id=c.doc_id, snippet=c.text[:240])
        for i, c in enumerate(merged)
    ]
    return {"retrieved": merged, "citations": cits}
