"""Conditional edge routers for the LangGraph state machine."""

from __future__ import annotations

from app.graph.state import AgentState


MAX_CRITIQUE_ITERS = 2


def after_enrich(state: AgentState) -> str:
    """If SAFER didn't resolve the DOT, short-circuit to data_insufficient."""
    if state.get("safer_profile") is None:
        return "no_dot"
    return "ok"


def after_critique(state: AgentState) -> str:
    """Loop back to retrieval if critique flags gaps and we have iters left."""
    iters = state.get("critique_iters", 0)
    if state.get("critique_pass", False):
        return "pass"
    if iters >= MAX_CRITIQUE_ITERS:
        return "pass"  # give up gracefully — finalize what we have
    return "loop"
