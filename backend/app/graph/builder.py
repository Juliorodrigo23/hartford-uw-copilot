"""LangGraph compile.

One graph topology, two checkpointing modes:

  - `build_graph(checkpointer)` — the factory. The FastAPI app calls it in
    its lifespan with an AsyncSqliteSaver so every run's state survives
    process restarts and is shared by all uvicorn workers in the container.
    This is what makes `GET /traces/{run_id}` actually work: /chat and
    /traces read and write the SAME checkpoint database.

  - `get_graph()` — lru-cached MemorySaver compile for scripts, evals, and
    tests, where durability is unnecessary and a file on disk is unwanted.
"""

from __future__ import annotations

from functools import lru_cache

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph

from app.graph.edges import after_critique, after_enrich
from app.graph.nodes import (
    analyze_loss_history,
    data_insufficient,
    draft_memo,
    enrich_carrier,
    finalize,
    find_comparables,
    parse_submission,
    retrieve_context,
    self_critique,
)
from app.graph.state import AgentState


def _wire(g: StateGraph) -> StateGraph:
    g.add_node("parse_submission", parse_submission)
    g.add_node("enrich_carrier", enrich_carrier)
    g.add_node("retrieve_context", retrieve_context)
    g.add_node("analyze_loss_history", analyze_loss_history)
    g.add_node("find_comparables", find_comparables)
    g.add_node("draft_memo", draft_memo)
    g.add_node("self_critique", self_critique)
    g.add_node("finalize", finalize)
    g.add_node("data_insufficient", data_insufficient)

    g.set_entry_point("parse_submission")
    g.add_edge("parse_submission", "enrich_carrier")
    g.add_conditional_edges(
        "enrich_carrier",
        after_enrich,
        {"ok": "retrieve_context", "no_dot": "data_insufficient"},
    )
    g.add_edge("retrieve_context", "analyze_loss_history")
    g.add_edge("analyze_loss_history", "find_comparables")
    g.add_edge("find_comparables", "draft_memo")
    g.add_edge("draft_memo", "self_critique")
    g.add_conditional_edges(
        "self_critique",
        after_critique,
        {"loop": "retrieve_context", "pass": "finalize"},
    )
    g.add_edge("finalize", END)
    g.add_edge("data_insufficient", END)
    return g


def build_graph(checkpointer):
    """Compile the underwriting graph against a caller-provided checkpointer."""
    return _wire(StateGraph(AgentState)).compile(checkpointer=checkpointer)


@lru_cache(maxsize=1)
def get_graph():
    """Ephemeral MemorySaver compile — scripts, evals, and tests."""
    return build_graph(MemorySaver())
