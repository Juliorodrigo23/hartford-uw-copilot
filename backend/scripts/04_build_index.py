"""Chunk + embed + persist into Chroma. Builds the BM25 corpus alongside.

Reads all `*.txt` files under `data/raw/{ntsb,sec}/` and ingests them. The
Chroma collection is selected by directory: `ntsb` → ntsb collection, `sec`
→ 10k collection, etc.
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings  # noqa: E402
from app.rag.chunker import recursive_chunks, semantic_chunks  # noqa: E402
from app.rag.embeddings import embed_texts  # noqa: E402
from app.rag.store import get_or_create  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("04_build_index")


SOURCE_TO_COLLECTION = {
    "ntsb": "ntsb",
    "sec": "10k",
    "industry": "industry",
    "forms": "forms",
}


def main():
    raw_dir = settings.data_dir / "raw"
    docs: list[dict] = []
    for src_dir in raw_dir.glob("*"):
        if not src_dir.is_dir():
            continue
        coll = SOURCE_TO_COLLECTION.get(src_dir.name)
        if not coll:
            continue
        for txt in sorted(src_dir.glob("*.txt")):
            doc_id = txt.stem
            text = txt.read_text(errors="ignore")
            meta_path = txt.with_suffix(".meta.json")
            meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
            log.info("ingesting %s (%d chars)", doc_id, len(text))
            # Semantic chunking for narratives, recursive for everything else
            try:
                chunks = semantic_chunks(
                    text,
                    embed_fn=embed_texts,
                    target_tokens=220,
                    overlap_tokens=30,
                    metadata={"source": coll, "doc_id": doc_id, **meta},
                )
            except Exception as e:
                log.warning("semantic split failed for %s: %s — falling back", doc_id, e)
                chunks = recursive_chunks(text, metadata={"source": coll, "doc_id": doc_id, **meta})
            for i, c in enumerate(chunks):
                docs.append(
                    {
                        "id": f"{doc_id}#chunk-{i}",
                        "doc_id": doc_id,
                        "source": coll,
                        "text": c.text,
                        "metadata": c.metadata,
                    }
                )

    if not docs:
        log.warning("no docs ingested — did you run 02 / 03 first?")
        return

    # Embed in batches and persist per collection
    by_coll: dict[str, list[dict]] = {}
    for d in docs:
        by_coll.setdefault(d["source"], []).append(d)

    for coll_name, items in by_coll.items():
        col = get_or_create(coll_name)
        # Wipe and re-add for idempotence
        try:
            col.delete(where={})
        except Exception:
            pass
        log.info("embedding %s · %d chunks", coll_name, len(items))
        embs = embed_texts([x["text"] for x in items])
        col.add(
            ids=[x["id"] for x in items],
            documents=[x["text"] for x in items],
            metadatas=[
                {"doc_id": x["doc_id"], "source": x["source"], **x["metadata"]}
                for x in items
            ],
            embeddings=embs.tolist(),
        )

    # Build the unified BM25 corpus file (used by hybrid_search.py)
    bm25_path = settings.data_dir / "processed" / "bm25_corpus.json"
    bm25_path.parent.mkdir(parents=True, exist_ok=True)
    bm25_path.write_text(json.dumps({"docs": docs}, indent=2))
    log.info("done · %d total chunks across %d collections", len(docs), len(by_coll))

    # Sanity: dimension echo
    if docs:
        sample = embed_texts([docs[0]["text"]])
        log.info("embedding dim = %d", sample.shape[1])
    _ = np  # quiet linters


if __name__ == "__main__":
    main()
