"""Cross-encoder rerank — exposed standalone for the eval harness."""

from __future__ import annotations

from functools import lru_cache


@lru_cache(maxsize=1)
def cross_encoder():
    from sentence_transformers import CrossEncoder

    return CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2", device="cpu")


def rerank(query: str, candidates: list[tuple[str, str]], top_k: int = 10) -> list[tuple[str, float]]:
    """`candidates` is [(doc_id, text), ...]. Returns top_k as [(doc_id, score), ...]."""
    if not candidates:
        return []
    model = cross_encoder()
    scores = model.predict([(query, c[1]) for c in candidates])
    return sorted(((c[0], float(s)) for c, s in zip(candidates, scores, strict=False)), key=lambda x: -x[1])[:top_k]
