"""Source-checked passage retrieval and explicit no-evidence evaluation."""

from __future__ import annotations

from app.eval.benchmark import load_benchmark, validate_retrieval_references
from app.rag.hybrid_search import hybrid_search


def _recall_at_k(retrieved: list[str], relevant: set[str], k: int) -> float:
    return len(set(retrieved[:k]) & relevant) / max(1, len(relevant))


def _mrr(retrieved: list[str], relevant: set[str]) -> float:
    return next((1 / i for i, key in enumerate(retrieved, 1) if key in relevant), 0.0)


def _ndcg(retrieved: list[str], relevant: set[str], k: int = 10) -> float:
    import math

    dcg = sum(1 / math.log2(i + 1) for i, key in enumerate(retrieved[:k], 1) if key in relevant)
    ideal = sum(1 / math.log2(i + 1) for i in range(1, min(k, len(relevant)) + 1))
    return dcg / ideal if ideal else 0.0


def _avg(values):
    return sum(values) / len(values) if values else None


async def evaluate_retrieval(k_final: int = 10, split: str | None = None) -> dict:
    data = load_benchmark("retrieval_questions")
    validate_retrieval_references(data)
    questions = [q for q in data["questions"] if not split or q["split"] == split]
    rows = []
    for q in questions:
        chunks = await hybrid_search(q["query"], k_final=max(k_final, 10))
        ids = [chunk.doc_id for chunk in chunks]
        # Adjacent overlapping chunks are equivalent only when the exact
        # reference quotation occurs in that SAME source document.
        scored_ids = list(ids)
        for ref in q["references"]:
            for i, hit in enumerate(chunks):
                if hit.doc_id.split("#")[0] == ref["doc_id"].split("#")[0] and " ".join(
                    ref["quote"].split()
                ) in " ".join(hit.text.split()):
                    scored_ids[i] = ref["doc_id"]
        relevant = set(q["relevant_doc_ids"])
        row = {
            "id": q["id"],
            "query": q["query"],
            "corpus": q["corpus"],
            "split": q["split"],
            "retrieved_ids": ids,
            "reference_ids": sorted(relevant),
        }
        if q.get("expected_abstention"):
            row["abstention_correct"] = not chunks
        else:
            row.update(
                {
                    "recall_at_5": _recall_at_k(scored_ids, relevant, 5),
                    "recall_at_10": _recall_at_k(scored_ids, relevant, 10),
                    "mrr": _mrr(scored_ids, relevant),
                    "ndcg_at_10": _ndcg(scored_ids, relevant),
                }
            )
        rows.append(row)
    answerable = [r for r in rows if "recall_at_10" in r]
    negatives = [r for r in rows if "abstention_correct" in r]
    return {
        "status": "ok",
        "method": "source-checked passage anchors; exact-quote overlap within the same source accepted",
        **{
            key: _avg([r[key] for r in answerable])
            for key in ["recall_at_5", "recall_at_10", "mrr", "ndcg_at_10"]
        },
        "n_questions": len(rows),
        "n_answerable": len(answerable),
        "n_no_evidence": len(negatives),
        "abstention_accuracy": _avg([r["abstention_correct"] for r in negatives]),
        "by_corpus": [
            {
                "corpus": c,
                "recall_at_10": _avg([r["recall_at_10"] for r in answerable if r["corpus"] == c]),
                "n": sum(r["corpus"] == c for r in answerable),
            }
            for c in sorted({r["corpus"] for r in answerable})
        ],
        "by_split": {
            s: {
                "n": sum(r["split"] == s for r in rows),
                "recall_at_10": _avg([r["recall_at_10"] for r in answerable if r["split"] == s]),
            }
            for s in ["development", "holdout"]
        },
        "per_question": rows,
    }
