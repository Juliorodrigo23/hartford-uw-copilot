"""Trace replay endpoint."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.api.auth import verify_hmac

router = APIRouter()


@router.get("/traces/{run_id}")
async def get_trace(run_id: str, request: Request):
    """Return the full LangGraph state snapshot for a given run.

    Reads from the SAME graph (and therefore the same SQLite checkpointer)
    that /chat writes to — see app.main lifespan. The frontend uses this to
    replay/scrub a completed run.
    """
    graph = request.app.state.graph
    await verify_hmac(request)
    try:
        snapshot = await graph.aget_state({"configurable": {"thread_id": run_id}})
    except Exception:
        raise HTTPException(status_code=404, detail="trace not found") from None
    if snapshot is None or not snapshot.values:
        raise HTTPException(status_code=404, detail="trace not found")
    return {
        "run_id": run_id,
        "values": _serialize(snapshot.values),
        "metadata": getattr(snapshot, "metadata", {}) or {},
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
