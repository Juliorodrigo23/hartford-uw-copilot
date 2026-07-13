"""Chroma persistent store — one collection per corpus."""

from __future__ import annotations

import logging
from functools import lru_cache

from app.config import settings

log = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_client():
    import chromadb

    settings.chroma_path.mkdir(parents=True, exist_ok=True)
    return chromadb.PersistentClient(path=str(settings.chroma_path))


def get_or_create(collection_name: str):
    """Fetch a collection, creating it only when it genuinely doesn't exist.

    Only the library's not-found signals are treated as "create it"; any
    other failure (corruption, permissions, version drift) propagates so an
    index problem cannot silently masquerade as an empty corpus.
    """
    import chromadb.errors

    client = get_client()
    not_found: tuple[type[Exception], ...]
    try:
        not_found = (chromadb.errors.NotFoundError,)
    except AttributeError:  # older chromadb releases signal via ValueError
        not_found = (ValueError,)
    try:
        return client.get_collection(collection_name)
    except not_found:
        log.info("creating new chroma collection %s", collection_name)
        return client.create_collection(collection_name, metadata={"hnsw:space": "cosine"})


def reset_collection(collection_name: str):
    """Drop and recreate a collection. Used by the index build for real
    idempotence (Chroma rejects delete(where={}), so re-adding the same ids
    without this would raise)."""
    client = get_client()
    try:
        client.delete_collection(collection_name)
    except Exception:
        pass  # didn't exist yet
    return client.create_collection(collection_name, metadata={"hnsw:space": "cosine"})
