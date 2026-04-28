"""Eval results endpoint — serves the JSON consumed by the EvalDashboard."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.config import settings

router = APIRouter()

EVAL_RESULTS = Path(settings.data_dir).parent / "app" / "eval" / "results" / "eval_results.json"


@router.get("/eval")
async def eval_results():
    if not EVAL_RESULTS.exists():
        raise HTTPException(status_code=404, detail="eval results not yet generated; run scripts/07_run_evals.py")
    return json.loads(EVAL_RESULTS.read_text())
