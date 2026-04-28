"""Trace replay endpoint."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.graph.builder import get_graph

router = APIRouter()


@router.get("/traces/{run_id}")
async def get_trace(run_id: str):
    """Return the full LangGraph state snapshot for a given run.

    The frontend uses this to support replay/scrub of a completed run.
    """
    graph = get_graph()
    try:
        snapshot = graph.get_state({"configurable": {"thread_id": run_id}})
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"trace not found: {e}")
    if snapshot is None:
        raise HTTPException(status_code=404, detail="trace not found")
    return {
        "run_id": run_id,
        "values": _serialize(snapshot.values),
        "metadata": getattr(snapshot, "metadata", {}),
    }


def _serialize(obj):
    """Convert pydantic / typed values to plain JSON-able types."""
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json")
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialize(v) for v in obj]
    return obj
