"""Vector search over the synthesized book of business."""

from __future__ import annotations

import json
import logging
from functools import lru_cache

import numpy as np
from langsmith import traceable

from app.config import settings
from app.schemas import LossStats, SAFERProfile, Submission

log = logging.getLogger(__name__)

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


def _featurize_sub(
    sub: Submission,
    safer: SAFERProfile | None = None,
    loss: LossStats | None = None,
) -> np.ndarray:
    """Build the query vector from what the agent actually knows about this
    submission: real SAFER OOS rates and real loss-run statistics when
    available, industry-median priors only when they are not."""
    return _featurize(
        {
            "fleet_size": sub.fleet_size,
            "oos_vehicle": safer.oos_rate_vehicle if safer else 0.12,
            "oos_driver": safer.oos_rate_driver if safer else 0.05,
            "loss_ratio_3yr": loss.loss_ratio_3yr if loss else 0.65,
            "frequency_per_pu_per_yr": loss.frequency_per_pu_per_yr if loss else 0.04,
            "trend_3yr_pct": loss.trend_3yr_pct if loss else 0.0,
            "commodity": sub.commodity,
        }
    )


@lru_cache(maxsize=1)
def _book() -> tuple[list[dict], np.ndarray]:
    if not BOOK_PATH.exists():
        log.warning("book of business not found at %s — run scripts/05_synthesize_subs.py", BOOK_PATH)
        return ([], np.zeros((0, 9)))
    raw = json.loads(BOOK_PATH.read_text())
    items = list(raw.get("accounts", raw))
    if not items:
        return ([], np.zeros((0, 9)))
    M = np.stack([_featurize(d) for d in items])
    return items, M


@traceable(name="comparable_search", run_type="tool")
def comparable_search(
    sub: Submission,
    k: int = 5,
    safer: SAFERProfile | None = None,
    loss: LossStats | None = None,
) -> list[dict]:
    items, M = _book()
    if not items:
        return []
    q = _featurize_sub(sub, safer=safer, loss=loss)
    # Standardize per feature against the book's distribution BEFORE cosine.
    # Raw features are scale-dominated by log(fleet size), which pushed every
    # similarity to ~0.999 and made the scores meaningless for ranking.
    mu = M.mean(axis=0)
    sd = M.std(axis=0) + 1e-9
    Mz = (M - mu) / sd
    qz = (q - mu) / sd
    qn = qz / (np.linalg.norm(qz) + 1e-9)
    Mn = Mz / (np.linalg.norm(Mz, axis=1, keepdims=True) + 1e-9)
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
