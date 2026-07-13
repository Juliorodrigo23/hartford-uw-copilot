"""Assist relabeling the retrieval golden set against the CURRENT index.

The golden set labels chunk ids; whenever the corpus is rebuilt, chunk
boundaries move and the old labels go stale (the retrieval eval refuses to
score against a stale set). This tool does the legwork for a HUMAN relabel:
for every golden question it runs the real per-stage retrieval and prints
the top candidate chunks with snippets. You read them and decide which are
relevant.

  uv run python scripts/relabel_golden.py               # print candidates
  uv run python scripts/relabel_golden.py --draft       # also write a DRAFT
        golden set (top-3 reranked chunks pre-filled) to
        golden_set/retrieval_questions.DRAFT.json — review and edit it, then
        replace retrieval_questions.json manually. The draft is NOT ground
        truth until a human has confirmed every label.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.compat import apply_platform_workarounds  # noqa: E402

apply_platform_workarounds()  # BEFORE torch/onnx imports (macOS OpenMP clash)

from app.config import settings  # noqa: E402
from app.rag.hybrid_search import search_stages  # noqa: E402

GOLDEN_DIR = Path(settings.data_dir).parent / "app" / "eval" / "golden_set"
GOLDEN = GOLDEN_DIR / "retrieval_questions.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--draft", action="store_true", help="write a pre-filled DRAFT file for human review")
    ap.add_argument("--k", type=int, default=10)
    args = ap.parse_args()

    if not GOLDEN.exists():
        raise SystemExit(f"no golden set at {GOLDEN}")
    data = json.loads(GOLDEN.read_text())
    questions = data["questions"]

    draft = []
    for q in questions:
        st = search_stages(q["query"], k=args.k)
        print("=" * 78)
        print(f"{q['id']} · {q['query']}")
        print(f"  old labels: {q['relevant_doc_ids']}")
        print("-" * 78)
        for i, h in enumerate(st["reranked"][: args.k], start=1):
            print(f"  {i:>2}. {h['id']:<32} [{h['source']}] score={h['score']:.3f}")
            print(f"      {h['snippet']}")
        draft.append({
            **q,
            "relevant_doc_ids": [h["id"] for h in st["reranked"][:3]],
            "_note": "DRAFT — top-3 reranked pre-filled; CONFIRM OR EDIT before use",
        })

    if args.draft:
        out = GOLDEN_DIR / "retrieval_questions.DRAFT.json"
        out.write_text(json.dumps({"questions": draft}, indent=2))
        print("\nDraft written to", out)
        print("Review every label, remove the _note keys, then replace retrieval_questions.json.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
