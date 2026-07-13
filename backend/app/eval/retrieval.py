"""Track 1 — Retrieval evaluation.

Every result carries a `status`:
  ok       — metrics were computed against the golden set
  skipped  — prerequisites missing (no golden set / empty index); no metrics
The runner NEVER emits zero-filled metrics for a track that didn't run.
"""

from __future__ import annotations

import json
import logging
import math
from pathlib import Path

from app.config import settings
from app.rag.hybrid_search import hybrid_search

log = logging.getLogger(__name__)


GOLDEN = Path(settings.data_dir).parent / "app" / "eval" / "golden_set" / "retrieval_questions.json"


def _recall_at_k(retrieved: list[str], relevant: set[str], k: int) -> float:
    top = retrieved[:k]
    return len(set(top) & relevant) / max(1, len(relevant))


def _mrr(retrieved: list[str], relevant: set[str]) -> float:
    for i, doc_id in enumerate(retrieved, start=1):
        if doc_id in relevant:
            return 1.0 / i
    return 0.0


def _ndcg(retrieved: list[str], relevant: set[str], k: int = 10) -> float:
    dcg = 0.0
    for i, doc_id in enumerate(retrieved[:k], start=1):
        if doc_id in relevant:
            dcg += 1.0 / math.log2(i + 1)
    ideal = sum(1.0 / math.log2(i + 1) for i in range(1, min(k, len(relevant)) + 1))
    return dcg / ideal if ideal else 0.0


async def evaluate_retrieval(k_final: int = 10) -> dict:
    if not GOLDEN.exists():
        log.warning("no golden retrieval set at %s", GOLDEN)
        return {"status": "skipped", "reason": f"golden set missing at {GOLDEN}"}

    qs = json.loads(GOLDEN.read_text())["questions"]

    # Coverage gate: the golden set labels CHUNK ids. If most labeled ids no
    # longer exist in the built index (corpus rebuilt, chunk boundaries
    # moved), scoring would silently measure staleness, not retrieval
    # quality. Refuse and say so.
    bm25_path = settings.data_dir / "processed" / "bm25_corpus.json"
    if bm25_path.exists():
        index_ids = {d["id"] for d in json.loads(bm25_path.read_text())["docs"]}
        labeled = {i for q in qs for i in q["relevant_doc_ids"]}
        missing = labeled - index_ids
        if labeled and len(missing) / len(labeled) > 0.5:
            return {
                "status": "skipped",
                "reason": (
                    f"golden set is stale: {len(missing)}/{len(labeled)} labeled chunk ids "
                    "are not in the built index — relabel retrieval_questions.json "
                    "against the current corpus before scoring"
                ),
            }

    recall5: list[float] = []
    recall10: list[float] = []
    mrrs: list[float] = []
    ndcgs: list[float] = []
    by_corpus: dict[str, list[float]] = {}
    any_hits = False
    for q in qs:
        relevant = set(q["relevant_doc_ids"])
        chunks = await hybrid_search(q["query"], k_final=max(10, k_final))
        if chunks:
            any_hits = True
        ids = [c.doc_id for c in chunks]
        recall5.append(_recall_at_k(ids, relevant, 5))
        recall10.append(_recall_at_k(ids, relevant, 10))
        mrrs.append(_mrr(ids, relevant))
        ndcgs.append(_ndcg(ids, relevant, 10))
        c = q.get("corpus", "all")
        by_corpus.setdefault(c, []).append(_recall_at_k(ids, relevant, 10))

    if not any_hits:
        # The index is empty or unreachable. Zeros here would be a lie about
        # retrieval quality; it's an infrastructure failure, so say so.
        return {
            "status": "skipped",
            "reason": "index returned no chunks for any query — run scripts/02-04 first",
        }

    by_corpus_out = [{"corpus": c, "recall_at_10": _avg(v), "n": len(v)} for c, v in by_corpus.items()]

    return {
        "status": "ok",
        "recall_at_5": _avg(recall5),
        "recall_at_10": _avg(recall10),
        "mrr": _avg(mrrs),
        "ndcg_at_10": _avg(ndcgs),
        "by_corpus": by_corpus_out,
        "n_questions": len(qs),
    }


def _avg(xs: list[float]) -> float:
    return sum(xs) / max(1, len(xs))
