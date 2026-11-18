"""Hybrid retrieval: BM25 + dense + Reciprocal Rank Fusion + cross-encoder rerank.

Identity contract: every ranking stage keys results by CHUNK id
("<doc_id>#chunk-<i>"). BM25, dense, RRF, and the golden retrieval set all
share this id space, so fusion dedup and eval matching are exact.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
from functools import lru_cache

import numpy as np
from langsmith import traceable

from app.config import settings
from app.rag.embeddings import embed_query
from app.rag.store import get_or_create
from app.schemas import CorpusKind, RetrievedChunk

log = logging.getLogger(__name__)


COLLECTIONS = [CorpusKind.NTSB.value, CorpusKind.SEC_10K.value, CorpusKind.FORMS.value, CorpusKind.INDUSTRY.value]
RRF_K = 60
DEFAULT_K_DENSE = 50
DEFAULT_K_BM25 = 50
DEFAULT_K_FINAL = 10

# Ranking tuple: (chunk_id, score, text, source)
Hit = tuple[str, float, str, str]


@lru_cache(maxsize=1)
def _bm25():
    """Load a single concatenated BM25 over all corpora."""
    from rank_bm25 import BM25Okapi

    bm25_path = settings.data_dir / "processed" / "bm25_corpus.json"
    if not bm25_path.exists():
        log.warning("BM25 corpus not found at %s — run scripts/04_build_index.py", bm25_path)
        return None, []
    raw = json.loads(bm25_path.read_text())
    docs: list[dict] = raw["docs"]
    tokens = [d["text"].lower().split() for d in docs]
    return BM25Okapi(tokens), docs


@lru_cache(maxsize=1)
def _dense_index_ready() -> bool:
    """True when at least one Chroma collection actually contains vectors.

    Checked BEFORE loading the embedding model: encoding a query pulls the
    ~1.3GB bge-large weights, which on a fresh Cloud Run container means a
    multi-minute HuggingFace download (or an OOM) at request time. Against
    an empty index that cost buys nothing, so we skip dense entirely and let
    BM25 carry the query. Cached per process; ship a populated index and
    restart to enable dense retrieval.
    """
    try:
        for name in COLLECTIONS:
            if get_or_create(name).count() > 0:
                return True
    except Exception as e:
        log.error("chroma unavailable while probing index: %s", e)
    log.warning("dense index empty — skipping query embedding (BM25 only). Run scripts/02-04.")
    return False


@lru_cache(maxsize=1)
def _reranker():
    try:
        from sentence_transformers import CrossEncoder

        return CrossEncoder(settings.reranker_model, device="cpu")
    except Exception as e:
        log.warning("cross-encoder unavailable: %s", e)
        return None


def _dense_search(query_emb: np.ndarray, k: int) -> list[Hit]:
    """Search every collection and merge."""
    out: list[Hit] = []
    for name in COLLECTIONS:
        try:
            col = get_or_create(name)
        except Exception as e:
            log.error("chroma collection %s unavailable: %s", name, e)
            continue
        n_in_col = col.count()
        if n_in_col == 0:
            continue
        try:
            r = col.query(
                query_embeddings=[query_emb.tolist()],
                n_results=min(k, n_in_col),
                include=["documents", "distances", "metadatas"],
            )
        except Exception as e:
            log.error("chroma query failed for %s: %s", name, e)
            continue
        ids = r.get("ids", [[]])[0]
        docs = r.get("documents", [[]])[0]
        dists = r.get("distances", [[]])[0]
        for i, chunk_id in enumerate(ids):
            distance = dists[i] if i < len(dists) else 1.0
            sim = max(0.0, 1.0 - float(distance))
            out.append((chunk_id, sim, docs[i] if i < len(docs) else "", name))
    out.sort(key=lambda x: -x[1])
    return out[:k]


def _bm25_search(query: str, k: int) -> list[Hit]:
    bm25, docs = _bm25()
    if bm25 is None or not docs:
        return []
    scores = bm25.get_scores(query.lower().split())
    top = np.argsort(scores)[::-1][:k]
    # NOTE: keyed by chunk id ("id"), not the parent document id, so that
    # RRF dedup against dense hits and golden-set matching are exact.
    return [
        (docs[i]["id"], float(scores[i]), docs[i]["text"], docs[i].get("source", ""))
        for i in top
        if scores[i] > 0
    ]


def _rrf(rankings: list[list[Hit]]) -> list[Hit]:
    """Reciprocal rank fusion. Returns deduped list with summed RRF scores."""
    table: dict[str, list] = {}
    for ranks in rankings:
        for rank, (chunk_id, _score, text, src) in enumerate(ranks):
            entry = table.get(chunk_id) or [chunk_id, 0.0, text, src]
            entry[1] += 1.0 / (RRF_K + rank + 1)
            table[chunk_id] = entry
    fused = sorted(table.values(), key=lambda x: -x[1])
    return [tuple(x) for x in fused]  # type: ignore[return-value]


def _rerank(query: str, hits: list[Hit], k_final: int) -> list[Hit]:
    if not hits:
        return []
    reranker = _reranker()
    if reranker is None:
        return hits[:k_final]
    pairs = [(query, t) for _id, _s, t, _src in hits[:50]]
    scores = np.asarray(reranker.predict(pairs), dtype=float).reshape(-1)
    if scores.size != len(pairs):
        log.warning(
            "cross-encoder returned %d scores for %d pairs; using fused ranking",
            scores.size,
            len(pairs),
        )
        return hits[:k_final]
    finite = np.isfinite(scores)
    if not finite.all():
        # Some ONNX/PyTorch combinations have produced an all-NaN result on
        # otherwise valid passages. Never let those values cross the JSON
        # boundary: the browser's JSON parser correctly rejects Python's
        # non-standard `NaN` token and the visualization then looks missing.
        log.warning(
            "cross-encoder returned %d non-finite scores; using fused ranking",
            int((~finite).sum()),
        )
        return hits[:k_final]
    order = np.argsort(scores)[::-1][:k_final]
    return [
        (hits[i][0], float(scores[i]), hits[i][2], hits[i][3]) for i in order
    ]


@traceable(name="hybrid_search", run_type="retriever")
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
    emb = None
    if _dense_index_ready():
        try:
            emb = embed_query(query)
        except Exception as e:
            log.warning("embedding failed: %s — BM25-only fallback", e)

    rankings: list[list[Hit]] = []
    if emb is not None:
        rankings.append(_dense_search(emb, k_dense))
    rankings.append(_bm25_search(query, k_bm25))
    fused = _rrf(rankings)
    if rerank:
        fused = _rerank(query, fused, k_final)
    else:
        fused = fused[:k_final]

    return [
        RetrievedChunk(doc_id=chunk_id, score=score, text=text, source=src or "unknown")
        for (chunk_id, score, text, src) in fused
    ]


def search_stages(query: str, k: int = 10) -> dict:
    """Diagnostic surface for the export script: returns the per-stage
    rankings (bm25, dense, rrf, rerank) for one query so the frontend can
    show the REAL disagreement between rankers instead of invented lists."""
    emb = None
    if _dense_index_ready():
        try:
            emb = embed_query(query)
        except Exception:
            emb = None
    dense = _dense_search(emb, k) if emb is not None else []
    bm25 = _bm25_search(query, k)
    fused = _rrf([r for r in (dense, bm25) if r])
    reranked = _rerank(query, fused, k)

    def strip(hits: list[Hit]) -> list[dict]:
        out = []
        for h in hits[:k]:
            score = float(h[1])
            if not math.isfinite(score):
                # `_rerank` guards the normal path. Keep this diagnostic
                # surface strict as a final defense against future rankers.
                log.warning("dropping non-finite score for retrieval hit %s", h[0])
                continue
            out.append(
                {
                    "id": h[0],
                    "score": round(score, 4),
                    "source": h[3],
                    "snippet": h[2][:140],
                }
            )
        return out

    return {"query": query, "bm25": strip(bm25), "dense": strip(dense), "rrf": strip(fused), "reranked": strip(reranked)}
