"""Generic data passthrough — serves precomputed viz JSON."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.config import settings

router = APIRouter()


# Files exported by `scripts/08_export_viz_data.py` land here; this endpoint
# is the canonical way for the frontend to fetch them when running against
# the deployed backend.
DATA_DIR = Path(settings.data_dir).parent.parent / "frontend" / "public" / "data"


@router.get("/data/{name}")
async def get_data(name: str):
    if not name.endswith(".json"):
        name = name + ".json"
    p = DATA_DIR / name
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"{name} not generated yet")
    return json.loads(p.read_text())
