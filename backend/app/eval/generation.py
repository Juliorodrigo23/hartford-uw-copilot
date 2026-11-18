"""Track 2 — Generation quality (LLM-as-judge).

Requires BOTH Vertex (Gemini generator) and OpenAI (GPT judge). When either
is unavailable the track returns status="skipped" with the reason; it never
records placeholder scores.
"""

from __future__ import annotations

import asyncio
import json
import logging
import statistics
import uuid
from pathlib import Path

from app.config import settings
from app.graph.builder import get_graph
from app.llm.judge_client import JudgeUnavailable, judge_memo, pairwise_compare
from app.llm.text import response_text
from app.tools.submissions import load_submission

log = logging.getLogger(__name__)

GOLDEN_DIR = Path(settings.data_dir).parent / "app" / "eval" / "golden_set"

DIM_KEYS = ["factual_accuracy", "completeness", "calibration", "citations", "format"]


async def _run_agent(submission_id: str, message: str, extra_state: dict | None = None) -> str:
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
            "draft_iters": 0,
            **(extra_state or {}),
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
        f"Loss run: {[(loss_row.year, loss_row.claims, str(loss_row.incurred_usd)) for loss_row in sub.loss_run]}\n"
        f"Broker: {sub.broker_email[:1200]}"
    )
    llm = gemini(temperature=0.2, streaming=False)
    resp = await llm.ainvoke(prompt)
    return response_text(resp.content)


async def evaluate_generation(n_runs_per_judge: int = 3) -> dict:
    cases_path = GOLDEN_DIR / "ground_truth_memos.v1.json"
    if not cases_path.exists():
        return {"status": "skipped", "reason": f"golden set missing at {cases_path}"}
    if not settings.openai_api_key:
        return {
            "status": "skipped",
            "reason": "OPENAI_API_KEY not set — drop your key in .env to enable the GPT judge",
        }
    cases = json.loads(cases_path.read_text())["cases"]

    agent_dim: dict[str, list[float]] = {k: [] for k in DIM_KEYS}
    base_dim: dict[str, list[float]] = {k: [] for k in DIM_KEYS}
    all_scores: list[float] = []  # pooled judge scores, for dispersion (IQR)
    wins = 0
    n = 0
    failures: list[str] = []

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
            failures.append(f"{sub_id}: {e}")
            continue
        try:
            a = judge_memo(agent_memo, gt, n_runs=n_runs_per_judge)
            b = judge_memo(baseline, gt, n_runs=n_runs_per_judge)
            winner = pairwise_compare(agent_memo, baseline, gt)
        except JudgeUnavailable as e:
            return {"status": "skipped", "reason": str(e)}
        for k in DIM_KEYS:
            agent_dim[k].append(a.get(k, 0.0))
            base_dim[k].append(b.get(k, 0.0))
            all_scores.extend([a.get(k, 0.0), b.get(k, 0.0)])
        if winner == "A":
            wins += 1
        n += 1

    if n == 0:
        return {
            "status": "skipped",
            "reason": "no eval case completed — " + ("; ".join(failures[:3]) or "unknown"),
        }

    rubric = [
        {
            "dimension": k.replace("_", " ").title(),
            "agent": sum(agent_dim[k]) / len(agent_dim[k]),
            "baseline": sum(base_dim[k]) / len(base_dim[k]),
        }
        for k in DIM_KEYS
    ]
    qs = statistics.quantiles(all_scores, n=4) if len(all_scores) >= 4 else [0.0, 0.0, 0.0]
    return {
        "status": "ok",
        "rubric": rubric,
        "pairwise_winrate_vs_baseline": wins / n,
        "judge_iqr": round(qs[2] - qs[0], 3),
        "n_cases": n,
        "failures": failures,
    }
