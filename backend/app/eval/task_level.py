"""Track 3 — Task-level evaluation against hand-curated ground-truth memos.

Accepts optional `extra_state` so the ablation runner can toggle components
(disable_rag, disable_critique, ...) and measure their contribution on the
real graph.
"""

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


def _term_present(memo: str, term: str) -> bool:
    """Case-insensitive WORD-BOUNDARY match (multi-word terms allowed).

    Plain substring matching was gameable: 'OOS' matched inside any longer
    token and a memo mentioning a term in a negation still counted. Word
    boundaries fix the first problem; the ground-truth phrasing convention
    (use discriminative phrases, not 3-letter fragments) addresses the rest.
    """
    import re as _re

    pattern = r"\b" + _re.escape(term.strip()).replace(r"\ ", r"\s+") + r"\b"
    return _re.search(pattern, memo, _re.IGNORECASE) is not None


def _redflag_recall(memo: str, expected: list[str]) -> tuple[int, int]:
    """How many expected red flags appear (word-boundary match)."""
    hits = sum(1 for f in expected if _term_present(memo, f))
    return hits, len(expected)


def _hallucinations(memo: str, must_not_say: list[str]) -> int:
    return sum(1 for f in must_not_say if _term_present(memo, f))


async def evaluate_task_level(extra_state: dict | None = None) -> dict:
    if not GOLDEN.exists():
        return {"status": "skipped", "reason": f"golden set missing at {GOLDEN}"}
    cases = json.loads(GOLDEN.read_text())["cases"]
    graph = get_graph()
    rf_hits, rf_total, halls, n = 0, 0, 0, 0
    per_sub: list[dict] = []
    failures: list[str] = []
    for c in cases:
        sub_id = c["submission_id"]
        sub = load_submission(sub_id)
        if not sub:
            failures.append(f"{sub_id}: not found in synthesized submissions")
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
                    "draft_iters": 0,
                    **(extra_state or {}),
                },
                config={"configurable": {"thread_id": f"eval-{sub_id}-{uuid.uuid4().hex[:6]}"}},
            )
            memo = state.get("memo")
            body = memo.body_md if memo else state.get("memo_md", "")
        except Exception as e:
            log.warning("task-level eval crashed on %s: %s", sub_id, e)
            failures.append(f"{sub_id}: {e}")
            continue
        if not body or "Error generating memo" in body:
            # An LLM failure stub is not a memo; scoring it would produce
            # real-looking numbers for a run that never happened.
            failures.append(f"{sub_id}: memo generation failed")
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

    if n == 0:
        return {
            "status": "skipped",
            "reason": "no eval case completed — " + ("; ".join(failures[:3]) or "unknown"),
        }

    return {
        "status": "ok",
        "redflag_recall": rf_hits / max(1, rf_total),
        "hallucination_rate": halls / max(1, n),
        "n_cases": n,
        "failures": failures,
        "per_submission": per_sub,
    }
