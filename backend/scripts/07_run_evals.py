"""Run the frozen v2 benchmark once, reuse outputs across metrics, and publish."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.compat import apply_platform_workarounds

apply_platform_workarounds()
from app.eval.runner import run_evaluations  # noqa: E402

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--concurrency", type=int, default=2, choices=[1, 2, 3])
    parser.add_argument(
        "--limit",
        type=int,
        help="Smoke test only; the report explicitly records the smaller sample.",
    )
    parser.add_argument(
        "--no-publish", action="store_true", help="Do not create LangSmith datasets/experiments."
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    report = asyncio.run(
        run_evaluations(concurrency=args.concurrency, limit=args.limit, publish=not args.no_publish)
    )
    print(
        "Evaluation:",
        report["evaluation_key"],
        "completed cases:",
        report["task_level"]["n_cases"],
        "/",
        report["task_level"]["n_expected"],
    )
    print(
        "Assertion recall:",
        report["task_level"]["assertion_recall"],
        "unsupported claim rate:",
        report["task_level"]["unsupported_claim_rate"],
    )
    print("EVAL_REPORT_JSON:" + json.dumps(report, ensure_ascii=False, allow_nan=False))
    if report["task_level"]["status"] != "ok" or report["generation"]["status"] != "ok":
        raise SystemExit(1)
