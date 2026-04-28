"""Hybrid retrieval: BM25 + dense + Reciprocal Rank Fusion + cross-encoder rerank."""

from __future__ import annotations

import asyncio
import json
import logging
from functools import lru_cache
from pathlib import Path

import numpy as np

from app.config import settings
from app.rag.embeddings import embed_query
from app.rag.store import get_or_create
from app.schemas import RetrievedChunk

log = logging.getLogger(__name__)


COLLECTIONS = ["ntsb", "10k", "forms", "industry"]
RRF_K = 60
DEFAULT_K_DENSE = 50
DEFAULT_K_BM25 = 50
DEFAULT_K_FINAL = 10


@lru_cache(maxsize=1)
def _bm25():
    """Load a single concatenated BM25 over all corpora."""
    from rank_bm25 import BM25Okapi

    bm25_path = settings.data_dir / "processed" / "bm25_corpus.json"
    if not bm25_path.exists():
        return None, []
    raw = json.loads(bm25_path.read_text())
    docs: list[dict] = raw["docs"]
    tokens = [d["text"].lower().split() for d in docs]
    return BM25Okapi(tokens), docs


@lru_cache(maxsize=1)
def _reranker():
    try:
        from sentence_transformers import CrossEncoder

        return CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2", device="cpu")
    except Exception as e:
        log.warning("cross-encoder unavailable: %s", e)
        return None


def _dense_search(query_emb: np.ndarray, k: int) -> list[tuple[str, float, str, str]]:
    """Search every collection and merge."""
    out: list[tuple[str, float, str, str]] = []
    for name in COLLECTIONS:
        try:
            col = get_or_create(name)
        except Exception:
            continue
        try:
            r = col.query(
                query_embeddings=[query_emb.tolist()],
                n_results=min(k, max(1, col.count())) if hasattr(col, "count") else k,
                include=["documents", "distances", "metadatas"],
            )
        except Exception as e:
            log.warning("chroma query failed for %s: %s", name, e)
            continue
        ids = r.get("ids", [[]])[0]
        docs = r.get("documents", [[]])[0]
        dists = r.get("distances", [[]])[0]
        for i, doc_id in enumerate(ids):
            distance = dists[i] if i < len(dists) else 1.0
            sim = max(0.0, 1.0 - float(distance))
            out.append((doc_id, sim, docs[i] if i < len(docs) else "", name))
    out.sort(key=lambda x: -x[1])
    return out[:k]


def _bm25_search(query: str, k: int) -> list[tuple[str, float, str, str]]:
    bm25, docs = _bm25()
    if bm25 is None or not docs:
        return []
    scores = bm25.get_scores(query.lower().split())
    top = np.argsort(scores)[::-1][:k]
    return [
        (docs[i]["doc_id"], float(scores[i]), docs[i]["text"], docs[i].get("source", ""))
        for i in top
    ]


def _rrf(rankings: list[list[tuple[str, float, str, str]]]) -> list[tuple[str, float, str, str]]:
    """Reciprocal rank fusion. Returns deduped list with summed RRF scores."""
    table: dict[str, list] = {}
    for ranks in rankings:
        for rank, (doc_id, _score, text, src) in enumerate(ranks):
            entry = table.get(doc_id) or [doc_id, 0.0, text, src]
            entry[1] += 1.0 / (RRF_K + rank + 1)
            table[doc_id] = entry
    fused = sorted(table.values(), key=lambda x: -x[1])
    return [tuple(x) for x in fused]  # type: ignore[return-value]


def _rerank(query: str, hits: list[tuple[str, float, str, str]], k_final: int) -> list[tuple[str, float, str, str]]:
    if not hits:
        return []
    reranker = _reranker()
    if reranker is None:
        return hits[:k_final]
    pairs = [(query, t) for _id, _s, t, _src in hits[:50]]
    scores = reranker.predict(pairs)
    order = np.argsort(scores)[::-1][:k_final]
    return [
        (hits[i][0], float(scores[i]), hits[i][2], hits[i][3]) for i in order
    ]


async def hybrid_search(
    query: str,
    k_final: int = DEFAULT_K_FINAL,
    k_dense: int = DEFAULT_K_DENSE,
    k_bm25: int = DEFAULT_K_BM25,
    rerank: bool = True,
) -> list[RetrievedChunk]:
    """Public entrypoint. Async wrapper around the (CPU-bound) hybrid pipeline."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _hybrid_search_sync, query, k_final, k_dense, k_bm25, rerank)


def _hybrid_search_sync(
    query: str,
    k_final: int,
    k_dense: int,
    k_bm25: int,
    rerank: bool,
) -> list[RetrievedChunk]:
    try:
        emb = embed_query(query)
    except Exception as e:
        log.warning("embedding failed: %s — BM25-only fallback", e)
        emb = None

    rankings: list[list[tuple[str, float, str, str]]] = []
    if emb is not None:
        rankings.append(_dense_search(emb, k_dense))
    rankings.append(_bm25_search(query, k_bm25))
    fused = _rrf(rankings)
    if rerank:
        fused = _rerank(query, fused, k_final)
    else:
        fused = fused[:k_final]

    return [
        RetrievedChunk(doc_id=doc_id, score=score, text=text, source=src or "unknown")
        for (doc_id, score, text, src) in fused
    ]
