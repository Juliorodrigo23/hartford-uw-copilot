"""LangGraph compile.

We expose two compiled graphs sharing identical wiring:
  - `get_graph()`       — sync MemorySaver, used by tests + scripts.
  - `get_async_graph()` — async MemorySaver, used by the FastAPI `/chat`
    endpoint which streams events via `astream`.

We use the in-memory checkpointer instead of the SQLite one. Each chat
request runs the graph end-to-end in a single process, so cross-process
durability isn't needed; SQLite's async path also requires a running event
loop at construction time, which we don't have at module import.
"""

from __future__ import annotations

from functools import lru_cache

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph

from app.config import settings
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


def _build_graph() -> StateGraph:
    g = StateGraph(AgentState)

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

    settings.data_dir.mkdir(parents=True, exist_ok=True)
    return g


@lru_cache(maxsize=1)
def get_graph():
    """Sync compile — used by tests and scripts."""
    return _build_graph().compile(checkpointer=MemorySaver())


@lru_cache(maxsize=1)
def get_async_graph():
    """Async compile — used by `/chat`. Same checkpointer; LangGraph routes
    sync vs async based on which method (invoke vs ainvoke) is called."""
    return _build_graph().compile(checkpointer=MemorySaver())
