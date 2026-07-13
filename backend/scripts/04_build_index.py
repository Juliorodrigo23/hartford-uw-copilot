"""Chunk + embed + persist into Chroma. Builds the BM25 corpus alongside.

Reads all `*.txt` files under `data/raw/{ntsb,sec,forms,industry}/` and
ingests them. The Chroma collection is selected by directory: `ntsb` → ntsb
collection, `sec` → 10k collection, etc.

Idempotent for real: after new embeddings finish successfully, each collection
is dropped and recreated (store.reset_collection) before re-adding, so re-runs
never hit duplicate-id errors or accumulate stale chunks. If dense generation
fails after the BM25 map changes, the affected old collection is disabled so
RRF can never fuse the same chunk id from two different texts.

Identity contract: BM25 corpus entries and Chroma ids are BOTH the chunk id
"<doc_id>#chunk-<i>". hybrid_search and the golden retrieval set rely on this.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.compat import apply_platform_workarounds

apply_platform_workarounds()  # BEFORE torch/onnx imports (macOS OpenMP clash)
from app.config import settings  # noqa: E402
from app.rag.chunker import recursive_chunks, semantic_chunks  # noqa: E402
from app.rag.embeddings import embed_texts  # noqa: E402
from app.rag.store import get_client, reset_collection  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("04_build_index")


SOURCE_TO_COLLECTION = {
    "ntsb": "ntsb",
    "sec": "10k",
    "industry": "industry",
    "forms": "forms",
}


def _valid_bm25_corpus(path: Path) -> bool:
    """True when an existing lexical corpus has a usable, unique id map."""
    try:
        raw = json.loads(path.read_text(), parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
        docs = raw["docs"]
        ids = [doc["id"] for doc in docs]
        return bool(docs) and len(ids) == len(set(ids)) and all(doc.get("text") for doc in docs)
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return False


def _populated_dense_collections() -> list[str]:
    """Inspect Chroma without creating collections or loading an embed model."""
    client = get_client()
    populated: list[str] = []
    for item in client.list_collections():
        name = item if isinstance(item, str) else item.name
        if name not in SOURCE_TO_COLLECTION.values():
            continue
        collection = client.get_collection(name) if isinstance(item, str) else item
        if collection.count() > 0:
            populated.append(name)
    return populated


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--bm25-only",
        action="store_true",
        help="Build the local lexical corpus without downloading/loading embedding models.",
    )
    parser.add_argument(
        "--require-dense",
        action="store_true",
        help="Exit nonzero if any dense collection cannot be rebuilt.",
    )
    args = parser.parse_args()
    if args.bm25_only and args.require_dense:
        parser.error("--bm25-only and --require-dense cannot be combined")

    raw_dir = settings.data_dir / "raw"
    bm25_path = settings.data_dir / "processed" / "bm25_corpus.json"

    if args.bm25_only:
        try:
            populated_dense = _populated_dense_collections()
        except Exception as exc:
            # Conservative behavior: when Chroma cannot be inspected, do not
            # overwrite an existing chunk-id map that may back dense vectors.
            if _valid_bm25_corpus(bm25_path):
                log.warning(
                    "cannot inspect dense index (%s); preserving the existing valid BM25 corpus",
                    exc,
                )
                return 0
            log.error("cannot safely build BM25-only because dense state is unknown: %s", exc)
            return 1
        if populated_dense:
            if _valid_bm25_corpus(bm25_path):
                log.info(
                    "dense index is populated (%s); preserving its matching BM25 chunk map",
                    ", ".join(populated_dense),
                )
                return 0
            log.error(
                "dense index is populated but its matching BM25 corpus is absent/invalid; "
                "run a full index build instead of --bm25-only"
            )
            return 1

    docs: list[dict] = []
    semantic_available = not args.bm25_only
    for src_dir in sorted(raw_dir.glob("*")):
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
            if semantic_available:
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
                    # Model/network failures are generally process-wide. Avoid
                    # retrying a multi-GB model load for every document.
                    semantic_available = False
                    chunks = recursive_chunks(
                        text,
                        metadata={"source": coll, "doc_id": doc_id, **meta},
                    )
            else:
                chunks = recursive_chunks(text, metadata={"source": coll, "doc_id": doc_id, **meta})
            for i, c in enumerate(chunks):
                docs.append(
                    {
                        "id": f"{doc_id}#chunk-{i}",
                        "doc_id": doc_id,
                        "source": coll,
                        "text": c.text,
                        "metadata": {k: v for k, v in c.metadata.items() if isinstance(v, (str, int, float, bool))},
                    }
                )

    if not docs:
        log.error("no docs ingested — run scripts 02 and 03 first")
        return 1

    # Persist lexical retrieval before attempting optional dense work. A
    # HuggingFace outage or low-memory reviewer machine can still run BM25 and
    # can still export the retrieval visualization.
    bm25_path.parent.mkdir(parents=True, exist_ok=True)
    bm25_path.write_text(json.dumps({"docs": docs}, indent=2, allow_nan=False))
    log.info("wrote BM25 corpus · %d chunks", len(docs))

    # Embed in batches and persist per collection
    by_coll: dict[str, list[dict]] = {}
    for d in docs:
        by_coll.setdefault(d["source"], []).append(d)

    dense_failures: list[str] = []
    dense_collections = 0
    embedding_dim: int | None = None
    if args.bm25_only:
        log.info("BM25-only mode requested; dense index left unchanged")
    else:
        for coll_name, items in by_coll.items():
            try:
                log.info("embedding %s · %d chunks", coll_name, len(items))
                embs = embed_texts([x["text"] for x in items])
                # Finish embeddings before swapping the collection. If this
                # attempt fails, the handler below explicitly disables the old
                # collection to preserve the BM25/dense identity contract.
                col = reset_collection(coll_name)
                col.add(
                    ids=[x["id"] for x in items],
                    documents=[x["text"] for x in items],
                    metadatas=[
                        {"doc_id": x["doc_id"], "source": x["source"], **x["metadata"]}
                        for x in items
                    ],
                    embeddings=embs.tolist(),
                )
                dense_collections += 1
                embedding_dim = int(embs.shape[1])
            except Exception as exc:
                dense_failures.append(coll_name)
                log.error(
                    "dense build failed for %s (%s); BM25 corpus remains usable",
                    coll_name,
                    exc,
                )
                try:
                    # The new BM25 corpus may assign the same chunk id to
                    # different text than an older dense build. An empty
                    # collection is safe (hybrid uses current BM25); retaining
                    # stale vectors would silently corrupt RRF identity/dedup.
                    reset_collection(coll_name)
                    log.warning("disabled stale dense collection %s after build failure", coll_name)
                except Exception as clear_exc:
                    log.critical(
                        "could not disable stale dense collection %s: %s",
                        coll_name,
                        clear_exc,
                    )
                    return 1

    log.info(
        "done · %d total chunks · %d lexical collections · %d dense collections",
        len(docs),
        len(by_coll),
        dense_collections,
    )
    if embedding_dim is not None:
        log.info("embedding dim = %d", embedding_dim)
    if dense_failures and args.require_dense:
        log.error("required dense collections failed: %s", ", ".join(dense_failures))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
