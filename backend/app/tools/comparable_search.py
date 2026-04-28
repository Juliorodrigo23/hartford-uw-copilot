"""Vector search over the synthesized book of business."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np

from app.config import settings
from app.schemas import Submission

BOOK_PATH = settings.data_dir / "synthesized" / "book_of_business.json"


def _featurize(d: dict) -> np.ndarray:
    """Tabular feature vector for cosine comparison.

    Cheap and explainable. Replaceable with embedding-based search later
    without changing the call site.
    """
    return np.array(
        [
            np.log1p(d.get("fleet_size", 1)),
            float(d.get("oos_vehicle", 0)),
            float(d.get("oos_driver", 0)),
            float(d.get("loss_ratio_3yr", 0.5)),
            float(d.get("frequency_per_pu_per_yr", 0.04)),
            float(d.get("trend_3yr_pct", 0.0)) / 50.0,
            1.0 if d.get("commodity") == "general_freight" else 0.0,
            1.0 if d.get("commodity") == "tank" else 0.0,
            1.0 if d.get("commodity") == "hazmat" else 0.0,
        ],
        dtype=float,
    )


def _featurize_sub(sub: Submission, oos_vehicle: float = 0.12, oos_driver: float = 0.05) -> np.ndarray:
    return _featurize(
        {
            "fleet_size": sub.fleet_size,
            "oos_vehicle": oos_vehicle,
            "oos_driver": oos_driver,
            "loss_ratio_3yr": 0.65,
            "frequency_per_pu_per_yr": 0.04,
            "trend_3yr_pct": 0.0,
            "commodity": sub.commodity,
        }
    )


@lru_cache(maxsize=1)
def _book() -> tuple[list[dict], np.ndarray]:
    if not BOOK_PATH.exists():
        return ([], np.zeros((0, 9)))
    raw = json.loads(BOOK_PATH.read_text())
    items = list(raw.get("accounts", raw))
    if not items:
        return ([], np.zeros((0, 9)))
    M = np.stack([_featurize(d) for d in items])
    return items, M


def comparable_search(sub: Submission, k: int = 5) -> list[dict]:
    items, M = _book()
    if not items:
        return []
    q = _featurize_sub(sub)
    # Cosine
    qn = q / (np.linalg.norm(q) + 1e-9)
    Mn = M / (np.linalg.norm(M, axis=1, keepdims=True) + 1e-9)
    sims = (Mn @ qn).tolist()
    pairs = sorted(zip(items, sims, strict=False), key=lambda x: -x[1])
    out = []
    for it, s in pairs[:k]:
        summary = (
            f"{it.get('carrier_name','—')} · {it.get('fleet_size','?')} PUs · "
            f"OOS-veh {it.get('oos_vehicle',0):.2%} · LR {it.get('loss_ratio_3yr',0):.2f} · "
            f"disposition: {it.get('disposition','?')}"
        )
        out.append(
            {
                "id": it.get("id", "—"),
                "score": round(float(s), 4),
                "carrier_name": it.get("carrier_name"),
                "summary": summary,
                "disposition": it.get("disposition"),
            }
        )
    return out
