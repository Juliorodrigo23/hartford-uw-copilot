"""Run the three eval tracks + real ablations and persist eval_results.json.

Every track carries an explicit status ("ok" | "skipped") with a reason.
Nothing in the output is fabricated: a track that could not run is marked
skipped, and the frontend renders a pending state for it.

Usage:
  uv run python scripts/07_run_evals.py                 # all tracks
  uv run python scripts/07_run_evals.py --skip-generation   # skip the LLM-judge track
  uv run python scripts/07_run_evals.py --ablations     # also run component ablations
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.compat import apply_platform_workarounds  # noqa: E402

apply_platform_workarounds()  # BEFORE torch/onnx imports (macOS OpenMP clash)

from app.config import settings  # noqa: E402
from app.eval.ablations import evaluate_all_ablations  # noqa: E402
from app.eval.generation import evaluate_generation  # noqa: E402
from app.eval.retrieval import evaluate_retrieval  # noqa: E402
from app.eval.task_level import evaluate_task_level  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("07_run_evals")

OUT = Path(settings.data_dir).parent / "app" / "eval" / "results" / "eval_results.json"


async def main(skip_generation: bool, run_ablations: bool):
    log.info("Track 1 — Retrieval")
    retrieval = await evaluate_retrieval(k_final=10)
    log.info("retrieval: %s", retrieval.get("status"))

    log.info("Track 3 — Task-level")
    task = await evaluate_task_level()
    log.info("task-level: %s", task.get("status"))

    if skip_generation:
        generation = {"status": "skipped", "reason": "skipped via --skip-generation"}
    else:
        log.info("Track 2 — Generation (LLM-as-judge)")
        generation = await evaluate_generation(n_runs_per_judge=3)
        log.info("generation: %s", generation.get("status"))

    if run_ablations:
        log.info("Ablations — re-running task-level eval per component")
        rows = await evaluate_all_ablations(
            retrieval_recall_at_10=retrieval.get("recall_at_10") if retrieval.get("status") == "ok" else None
        )
        ablations = {"status": "ok", "rows": rows}
    else:
        ablations = {
            "status": "skipped",
            "reason": "run scripts/07_run_evals.py --ablations to measure component contributions",
        }

    out = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
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
    parser.add_argument(
        "--skip-generation", action="store_true",
        help="Skip the LLM-as-judge track (marked 'skipped' in the output, never faked).",
    )
    parser.add_argument(
        "--ablations", action="store_true",
        help="Also run real component ablations (re-runs the agent per component; slow).",
    )
    args = parser.parse_args()
    asyncio.run(main(skip_generation=args.skip_generation, run_ablations=args.ablations))
