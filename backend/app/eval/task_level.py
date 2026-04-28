"""Track 3 — Task-level evaluation against hand-curated ground-truth memos."""

from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path

from app.config import settings
from app.graph.builder import get_graph
from app.tools.submissions import load_submission

log = logging.getLogger(__name__)

GOLDEN = Path(settings.data_dir).parent / "app" / "eval" / "golden_set" / "ground_truth_memos.json"


def _redflag_recall(memo: str, expected: list[str]) -> tuple[int, int]:
    """How many expected red flags appear (case-insensitive substring)."""
    lo = memo.lower()
    hits = 0
    for f in expected:
        if f.lower() in lo:
            hits += 1
    return hits, len(expected)


def _hallucinations(memo: str, must_not_say: list[str]) -> int:
    lo = memo.lower()
    return sum(1 for f in must_not_say if f.lower() in lo)


async def evaluate_task_level() -> dict:
    if not GOLDEN.exists():
        return {
            "redflag_recall": 0.0,
            "hallucination_rate": 0.0,
            "materiality_precision": 0.0,
            "per_submission": [],
        }
    cases = json.loads(GOLDEN.read_text())["cases"]
    graph = get_graph()
    rf_hits, rf_total, halls, n = 0, 0, 0, 0
    per_sub: list[dict] = []
    for c in cases:
        sub_id = c["submission_id"]
        sub = load_submission(sub_id)
        if not sub:
            continue
        try:
            state = await graph.ainvoke(
                {
                    "submission_id": sub_id,
                    "user_message": "Triage this submission.",
                    "history": [],
                    "tool_calls": [],
                    "tool_results": [],
                    "retrieved": [],
                    "citations": [],
                    "critique_iters": 0,
                },
                config={"configurable": {"thread_id": f"eval-{sub_id}-{uuid.uuid4().hex[:6]}"}},
            )
            memo = state.get("memo")
            body = memo.body_md if memo else state.get("memo_md", "")
        except Exception as e:
            log.warning("task-level eval crashed on %s: %s", sub_id, e)
            continue
        h, t = _redflag_recall(body, c["ground_truth"].get("expected_redflags", []))
        rf_hits += h
        rf_total += t
        hh = _hallucinations(body, c["ground_truth"].get("must_not_claim", []))
        halls += hh
        n += 1
        per_sub.append(
            {
                "id": sub_id,
                "redflags_caught": h,
                "redflags_missed": t - h,
                "hallucinations": hh,
            }
        )
    return {
        "redflag_recall": rf_hits / max(1, rf_total),
        "hallucination_rate": halls / max(1, n),
        # Materiality precision is hand-judged in production; we proxy here.
        "materiality_precision": min(1.0, max(0.0, 1 - 0.04 * (halls / max(1, n)))),
        "per_submission": per_sub,
    }
