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
    client = get_client()
    try:
        return client.get_collection(collection_name)
    except Exception:
        log.info("creating new chroma collection %s", collection_name)
        return client.create_collection(collection_name, metadata={"hnsw:space": "cosine"})


def list_collections() -> list[str]:
    return [c.name for c in get_client().list_collections()]
