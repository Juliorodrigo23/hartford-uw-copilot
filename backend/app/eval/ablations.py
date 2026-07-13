"""Ablation runner — toggles components ON THE REAL GRAPH and re-scores.

Each ablation sets a state flag that the corresponding node honors
(disable_rag, disable_critique, disable_comparables, disable_xgb), then
re-runs the Track 3 task-level eval. No numbers are derived arithmetically;
if an ablation didn't run, its row says so.
"""

from __future__ import annotations

import logging

from app.eval.task_level import evaluate_task_level

log = logging.getLogger(__name__)


# name → state flags. Order matters for display.
ABLATIONS: list[tuple[str, dict]] = [
    ("Full system", {}),
    ("− self-critique", {"disable_critique": True}),
    ("− RAG", {"disable_rag": True}),
    ("− comparables", {"disable_comparables": True}),
    ("− XGBoost loss-freq tool", {"disable_xgb": True}),
]

ABLATION_ORDER = [name for name, _ in ABLATIONS]


async def evaluate_ablation(name: str, retrieval_recall_at_10: float | None = None) -> dict:
    """Run one named ablation through the real task-level eval."""
    flags = dict(ABLATIONS)[name] if name in dict(ABLATIONS) else {}
    task = await evaluate_task_level(extra_state=flags)
    if task.get("status") != "ok":
        return {"name": name, "status": task.get("status", "skipped"), "reason": task.get("reason")}
    return {
        "name": name,
        "status": "ok",
        "retrieval_recall_at_10": 0.0 if flags.get("disable_rag") else retrieval_recall_at_10,
        "redflag_recall": task["redflag_recall"],
        "hallucination_rate": task["hallucination_rate"],
        "n_cases": task["n_cases"],
    }


async def evaluate_all_ablations(retrieval_recall_at_10: float | None = None) -> list[dict]:
    rows: list[dict] = []
    for name, _flags in ABLATIONS:
        log.info("ablation: %s", name)
        rows.append(await evaluate_ablation(name, retrieval_recall_at_10))
    return rows
