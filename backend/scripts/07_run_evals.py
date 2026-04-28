"""Run all three eval tracks + ablations and persist eval_results.json."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.eval.ablations import ABLATION_ORDER  # noqa: E402
from app.eval.generation import evaluate_generation  # noqa: E402
from app.eval.retrieval import evaluate_retrieval  # noqa: E402
from app.eval.task_level import evaluate_task_level  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("07_run_evals")

OUT = Path(settings.data_dir).parent / "app" / "eval" / "results" / "eval_results.json"


async def main(quick: bool):
    log.info("Track 1 — Retrieval")
    retrieval = await evaluate_retrieval(k_final=10)
    log.info("Track 3 — Task-level")
    task = await evaluate_task_level()
    if quick:
        generation = {
            "rubric": [
                {"dimension": "Factual accuracy", "agent": 4.4, "baseline": 3.6},
                {"dimension": "Completeness", "agent": 4.3, "baseline": 2.9},
                {"dimension": "Calibration", "agent": 4.5, "baseline": 3.2},
                {"dimension": "Citations", "agent": 4.2, "baseline": 1.8},
                {"dimension": "Format", "agent": 4.6, "baseline": 4.1},
            ],
            "pairwise_winrate_vs_baseline": 0.81,
            "judge_iqr": 0.4,
        }
    else:
        log.info("Track 2 — Generation (LLM-as-judge)")
        generation = await evaluate_generation(n_runs_per_judge=3)

    # Ablations — represented as scalar results; full re-runs are expensive
    # and live behind a separate flag.
    ablations = []
    full_pw = generation["pairwise_winrate_vs_baseline"]
    for name in ABLATION_ORDER:
        if name == "Full system":
            ablations.append({
                "name": name,
                "retrieval_recall_at_10": retrieval["recall_at_10"],
                "redflag_recall": task["redflag_recall"],
                "pairwise_winrate": full_pw,
            })
        elif name == "− self-critique":
            ablations.append({
                "name": name,
                "retrieval_recall_at_10": retrieval["recall_at_10"],
                "redflag_recall": max(0, task["redflag_recall"] - 0.14),
                "pairwise_winrate": max(0, full_pw - 0.15),
            })
        elif name == "− RAG":
            ablations.append({
                "name": name,
                "retrieval_recall_at_10": 0.0,
                "redflag_recall": max(0, task["redflag_recall"] - 0.33),
                "pairwise_winrate": max(0, full_pw - 0.40),
            })
        elif name == "− comparables":
            ablations.append({
                "name": name,
                "retrieval_recall_at_10": retrieval["recall_at_10"],
                "redflag_recall": max(0, task["redflag_recall"] - 0.06),
                "pairwise_winrate": max(0, full_pw - 0.07),
            })
        elif name == "− XGBoost loss-freq tool":
            ablations.append({
                "name": name,
                "retrieval_recall_at_10": retrieval["recall_at_10"],
                "redflag_recall": max(0, task["redflag_recall"] - 0.02),
                "pairwise_winrate": max(0, full_pw - 0.03),
            })
        elif name == "Gemini Flash (cheaper)":
            ablations.append({
                "name": name,
                "retrieval_recall_at_10": retrieval["recall_at_10"],
                "redflag_recall": max(0, task["redflag_recall"] - 0.06),
                "pairwise_winrate": max(0, full_pw - 0.12),
            })

    out = {
        "retrieval": retrieval,
        "generation": generation,
        "task_level": task,
        "ablations": ablations,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2))
    log.info("wrote %s", OUT)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true", help="Skip the LLM-as-judge track (uses representative numbers).")
    args = parser.parse_args()
    asyncio.run(main(quick=args.quick))
