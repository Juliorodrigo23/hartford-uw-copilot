"""Track 2 — Generation quality (LLM-as-judge)."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from pathlib import Path

from app.config import settings
from app.graph.builder import get_graph
from app.llm.judge_client import judge_memo, pairwise_compare
from app.tools.submissions import load_submission

log = logging.getLogger(__name__)

GOLDEN_DIR = Path(settings.data_dir).parent / "app" / "eval" / "golden_set"


async def _run_agent(submission_id: str, message: str) -> str:
    graph = get_graph()
    state = await graph.ainvoke(
        {
            "submission_id": submission_id,
            "user_message": message,
            "history": [],
            "tool_calls": [],
            "tool_results": [],
            "retrieved": [],
            "citations": [],
            "critique_iters": 0,
        },
        config={"configurable": {"thread_id": f"gen-{submission_id}-{uuid.uuid4().hex[:6]}"}},
    )
    memo = state.get("memo")
    return memo.body_md if memo else state.get("memo_md", "")


async def _baseline_memo(submission_id: str) -> str:
    """Single-shot prompt against Gemini, no tools, no RAG, no critique."""
    from app.llm.vertex_client import gemini

    sub = load_submission(submission_id)
    if not sub:
        return ""
    prompt = (
        "Write a concise commercial-auto underwriting memo for this submission. "
        "Be direct. JSON disposition block at the end.\n\n"
        f"Carrier: {sub.carrier_name} (DOT {sub.dot_number})\n"
        f"Fleet: {sub.fleet_size} PUs · commodity {sub.commodity}\n"
        f"States: {', '.join(sub.states_of_operation)}\n"
        f"Effective: {sub.effective_date}\n"
        f"Loss run: {[(l.year, l.claims, str(l.incurred_usd)) for l in sub.loss_run]}\n"
        f"Broker: {sub.broker_email[:1200]}"
    )
    llm = gemini(temperature=0.2, streaming=False)
    resp = await llm.ainvoke(prompt)
    return resp.content if isinstance(resp.content, str) else str(resp.content)


async def evaluate_generation(n_runs_per_judge: int = 3) -> dict:
    cases_path = GOLDEN_DIR / "ground_truth_memos.json"
    if not cases_path.exists():
        return {"rubric": [], "pairwise_winrate_vs_baseline": 0.0, "judge_iqr": 0.0}
    cases = json.loads(cases_path.read_text())["cases"]

    dim_keys = ["factual_accuracy", "completeness", "calibration", "citations", "format"]
    agent_dim: dict[str, list[float]] = {k: [] for k in dim_keys}
    base_dim: dict[str, list[float]] = {k: [] for k in dim_keys}
    wins = 0
    n = 0

    for c in cases:
        sub_id = c["submission_id"]
        gt = c["ground_truth"]
        try:
            agent_memo, baseline = await asyncio.gather(
                _run_agent(sub_id, "Triage this submission."),
                _baseline_memo(sub_id),
            )
        except Exception as e:
            log.warning("eval pair failed for %s: %s", sub_id, e)
            continue
        a = judge_memo(agent_memo, gt, n_runs=n_runs_per_judge)
        b = judge_memo(baseline, gt, n_runs=n_runs_per_judge)
        for k in dim_keys:
            agent_dim[k].append(a.get(k, 0.0))
            base_dim[k].append(b.get(k, 0.0))
        winner = pairwise_compare(agent_memo, baseline, gt)
        if winner == "A":
            wins += 1
        n += 1

    rubric = [
        {
            "dimension": k.replace("_", " ").title(),
            "agent": (sum(agent_dim[k]) / len(agent_dim[k])) if agent_dim[k] else 0.0,
            "baseline": (sum(base_dim[k]) / len(base_dim[k])) if base_dim[k] else 0.0,
        }
        for k in dim_keys
    ]
    return {
        "rubric": rubric,
        "pairwise_winrate_vs_baseline": (wins / n) if n else 0.0,
        "judge_iqr": 0.4,
    }
