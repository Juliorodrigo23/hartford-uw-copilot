"""analyze_loss_history — compute frequency/severity/trend; call XGBoost predictor."""

from __future__ import annotations

import time
import uuid

from app.graph.state import AgentState
from app.schemas import ToolCall
from app.tools.loss_calc import loss_stats
from app.tools.xgb_loss_freq import xgb_predict


async def analyze_loss_history(state: AgentState) -> AgentState:
    sub = state.get("submission")
    safer = state.get("safer_profile")
    if not sub:
        return {}

    # Loss-run statistics
    t0 = time.time()
    stats = loss_stats(sub)
    ms_loss = int((time.time() - t0) * 1000)
    tc_loss = ToolCall(
        id=uuid.uuid4().hex[:8],
        name="loss_calc",
        input={"submission_id": sub.id, "n_loss_yrs": len(sub.loss_run)},
        output=stats.model_dump(mode="json") if stats else None,
        ms=ms_loss,
    )

    # XGBoost loss-frequency
    t0 = time.time()
    pred = xgb_predict(sub, safer)
    ms_xgb = int((time.time() - t0) * 1000)
    tc_xgb = ToolCall(
        id=uuid.uuid4().hex[:8],
        name="xgb_loss_freq",
        input={"submission_id": sub.id},
        output=pred.model_dump(mode="json") if pred else None,
        ms=ms_xgb,
    )

    return {
        "loss_stats": stats,
        "xgb_pred": pred,
        "tool_calls": [*state.get("tool_calls", []), tc_loss, tc_xgb],
        "tool_results": [*state.get("tool_results", []), tc_loss, tc_xgb],
    }
