"""Embedding model wrapper.

We use sentence-transformers BAAI/bge-large-en-v1.5 for the corpus and the
queries. Lazy-loaded so test imports don't pay the model-load cost.
"""

from __future__ import annotations

from collections.abc import Iterable
from functools import lru_cache

import numpy as np

from app.config import settings


@lru_cache(maxsize=1)
def _model():
    from sentence_transformers import SentenceTransformer

    # Honor EMBED_MODEL from Settings. This is important for quick reviews on
    # smaller machines, where loading bge-large can otherwise cost >1 GB.
    return SentenceTransformer(settings.embed_model, device="cpu")


def embed_texts(texts: Iterable[str], normalize: bool = True) -> np.ndarray:
    model = _model()
    arr = model.encode(list(texts), batch_size=32, show_progress_bar=False, normalize_embeddings=normalize)
    return np.asarray(arr, dtype=np.float32)


def embed_query(text: str, normalize: bool = True) -> np.ndarray:
    """bge-* models are documented to benefit from a query prefix."""
    prefixed = "Represent this sentence for searching relevant passages: " + text
    model = _model()
    arr = model.encode([prefixed], normalize_embeddings=normalize)
    return np.asarray(arr[0], dtype=np.float32)
