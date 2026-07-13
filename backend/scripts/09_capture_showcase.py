"""Capture ONE verified end-to-end run as a publishable artifact.

The single most damaging question a reviewer can ask this repo is: "show me
one real memo." This script answers it. It runs the REAL graph (real SAFER
profile, real retrieval, real model, real Gemini draft, real critique) on one
submission and persists everything:

  - docs/showcase/showcase_memo.md       — the memo, human-readable, with
                                            run metadata and citations
  - data/exports/showcase_run.json       — machine-readable full trace
    (+ mirrored to frontend/public/data)  consumed by the site's ToolCallStream
                                            and SelfCritiqueDiff panels, which
                                            then display REAL data

Refuses to write anything if generation failed (an error memo is not a
showcase). Requires Vertex credentials; run:

  uv run python scripts/09_capture_showcase.py --submission SUB-001
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import logging
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.compat import apply_platform_workarounds  # noqa: E402

apply_platform_workarounds()  # BEFORE torch/onnx imports (macOS OpenMP clash)

from app.config import settings  # noqa: E402
from app.graph.builder import get_graph  # noqa: E402
from app.tools.submissions import load_submission  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("09_showcase")

DOCS_DIR = Path(__file__).resolve().parents[2] / "docs" / "showcase"
EXPORTS = settings.exports_dir
FRONTEND_DATA = Path(settings.data_dir).parent.parent / "frontend" / "public" / "data"


def _ser(v):
    if hasattr(v, "model_dump"):
        return v.model_dump(mode="json")
    if isinstance(v, list):
        return [_ser(x) for x in v]
    if isinstance(v, dict):
        return {k: _ser(x) for k, x in v.items()}
    return v


async def main(submission_id: str, question: str) -> int:
    sub = load_submission(submission_id)
    if not sub:
        log.error("submission %s not found — run scripts/05_synthesize_subs.py first", submission_id)
        return 1

    graph = get_graph()
    run_id = f"showcase-{uuid.uuid4().hex[:8]}"
    t0 = time.time()
    node_timings: list[dict] = []
    drafts: list[str] = []
    critiques: list[dict] = []
    final_state: dict = {}

    async for ev in graph.astream(
        {
            "submission_id": submission_id,
            "user_message": question,
            "history": [],
            "tool_calls": [],
            "tool_results": [],
            "retrieved": [],
            "citations": [],
            "critique_iters": 0,
            "draft_iters": 0,
        },
        config={"configurable": {"thread_id": run_id}},
        stream_mode="updates",
    ):
        for node, delta in ev.items():
            node_timings.append({"node": node, "t_ms": int((time.time() - t0) * 1000)})
            delta = delta or {}
            if delta.get("memo_md"):
                drafts.append(delta["memo_md"])
            if delta.get("critique_judge"):
                critiques.append({
                    "judge": delta.get("critique_judge"),
                    "passed": bool(delta.get("critique_pass", True)),
                    "gaps": delta.get("critique_gaps") or [],
                    "rubric_scores": delta.get("rubric_scores") or {},
                    "error": delta.get("critique_error"),
                    "iter": delta.get("critique_iters", 0),
                })
            final_state.update(delta)

    memo = final_state.get("memo")
    memo_md = memo.body_md if memo else final_state.get("memo_md", "")
    if not memo_md or "Error generating memo" in memo_md:
        log.error(
            "REFUSING to publish: memo generation failed (%s). A showcase must "
            "be a real run — check Vertex credentials and retry.",
            memo_md[:160],
        )
        return 1
    if any(c.get("error") for c in critiques):
        log.warning("critique judge errored during this run — captured, but consider re-running with judges healthy")

    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "run_id": run_id,
        "question": question,
        "submission": _ser(final_state.get("submission")),
        "safer_profile": _ser(final_state.get("safer_profile")),
        "tool_calls": _ser(final_state.get("tool_results") or []),
        "citations": _ser(final_state.get("citations") or []),
        "retrieved_count": len(final_state.get("retrieved") or []),
        "node_timings": node_timings,
        "drafts": drafts,
        "critiques": critiques,
        "memo_md": memo_md,
        "disposition": _ser(final_state.get("disposition")),
        "total_ms": int((time.time() - t0) * 1000),
    }

    EXPORTS.mkdir(parents=True, exist_ok=True)
    (EXPORTS / "showcase_run.json").write_text(json.dumps(payload, indent=2))
    if FRONTEND_DATA.parent.exists():
        FRONTEND_DATA.mkdir(parents=True, exist_ok=True)
        (FRONTEND_DATA / "showcase_run.json").write_text(json.dumps(payload, indent=2))

    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    cits = "\n".join(
        f"- {c['ref']} `{c['doc_id']}` — {c['snippet'][:160]}…"
        for c in payload["citations"]
    ) or "(none)"
    crit = "\n".join(
        f"- iter {c['iter']} · judge {c['judge']} · {'PASS' if c['passed'] else 'FLAGGED: ' + '; '.join(c['gaps'])}"
        for c in payload["critiques"]
    ) or "(none)"
    (DOCS_DIR / "showcase_memo.md").write_text(
        f"# Verified end-to-end run · {payload['generated_at']}\n\n"
        f"- Submission: **{submission_id}** (DOT {payload['submission']['dot_number']} · "
        f"SAFER: {payload['submission'].get('safer_legal_name')})\n"
        f"- Question: {question}\n"
        f"- Wall time: {payload['total_ms']} ms · drafts: {len(drafts)} · "
        f"retrieved chunks: {payload['retrieved_count']}\n"
        f"- Disposition: `{payload['disposition']}`\n\n"
        f"## Critique\n{crit}\n\n## Citations\n{cits}\n\n---\n\n{memo_md}\n"
    )
    log.info("showcase written: docs/showcase/showcase_memo.md + exports/showcase_run.json")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--submission", default="SUB-001")
    ap.add_argument("--question", default="Triage this submission. Surface the top 3 risk drivers, recommend a disposition, and cite evidence.")
    args = ap.parse_args()
    raise SystemExit(asyncio.run(main(args.submission, args.question)))
