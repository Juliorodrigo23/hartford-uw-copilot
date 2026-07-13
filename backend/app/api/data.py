"""Generic data passthrough — serves precomputed viz JSON.

Serves from `backend/data/exports/`, which script 08 populates and which
ships inside the Docker image (unlike the old frontend/public path, which
does not exist in the container).
"""

from __future__ import annotations

import json
import re

from fastapi import APIRouter, HTTPException

from app.config import settings

router = APIRouter()

_SAFE_NAME = re.compile(r"^[A-Za-z0-9_\-]+$")


@router.get("/data/{name}")
async def get_data(name: str):
    if name.endswith(".json"):
        name = name[: -len(".json")]
    if not _SAFE_NAME.match(name):
        raise HTTPException(status_code=400, detail="invalid dataset name")
    p = settings.exports_dir / f"{name}.json"
    if not p.exists():
        raise HTTPException(
            status_code=404,
            detail=f"{name}.json not generated yet — run scripts/08_export_viz_data.py",
        )
    return json.loads(p.read_text())
