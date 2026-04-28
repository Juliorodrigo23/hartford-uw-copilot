"""Track 1 — Retrieval evaluation."""

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
        return {
            "recall_at_5": 0.0,
            "recall_at_10": 0.0,
            "mrr": 0.0,
            "ndcg_at_10": 0.0,
            "n_questions": 0,
        }

    qs = json.loads(GOLDEN.read_text())["questions"]
    recall5: list[float] = []
    recall10: list[float] = []
    mrrs: list[float] = []
    ndcgs: list[float] = []
    by_corpus: dict[str, list[float]] = {}
    for q in qs:
        relevant = set(q["relevant_doc_ids"])
        chunks = await hybrid_search(q["query"], k_final=max(10, k_final))
        ids = [c.doc_id for c in chunks]
        recall5.append(_recall_at_k(ids, relevant, 5))
        recall10.append(_recall_at_k(ids, relevant, 10))
        mrrs.append(_mrr(ids, relevant))
        ndcgs.append(_ndcg(ids, relevant, 10))
        c = q.get("corpus", "all")
        by_corpus.setdefault(c, []).append(_recall_at_k(ids, relevant, 10))

    by_corpus_out = [{"corpus": c, "recall_at_10": _avg(v), "n": len(v)} for c, v in by_corpus.items()]

    return {
        "recall_at_5": _avg(recall5),
        "recall_at_10": _avg(recall10),
        "mrr": _avg(mrrs),
        "ndcg_at_10": _avg(ndcgs),
        "ragas": {
            # Filled in by ragas_runner if installed; otherwise zeros.
            "context_precision": 0.0,
            "context_recall": 0.0,
            "faithfulness": 0.0,
        },
        "by_corpus": by_corpus_out,
        "n_questions": len(qs),
    }


def _avg(xs: list[float]) -> float:
    return sum(xs) / max(1, len(xs))
