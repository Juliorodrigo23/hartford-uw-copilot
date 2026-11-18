"""Frozen, source-anchored reference assertions and benchmark validation."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from app.rag.hybrid_search import all_documents

GOLDEN_DIR = Path(__file__).with_name("golden_set")


def fingerprint(value) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()
    ).hexdigest()


def load_benchmark(name: str) -> dict:
    data = json.loads((GOLDEN_DIR / f"{name}.json").read_text())
    if data.get("version") != "uw-evidence-v2.0":
        raise ValueError(
            "A versioned v2 benchmark is required; draft/keyword references cannot be scored."
        )
    if data.get("review_status") != "agent_source_checked; underwriter_validation_pending":
        raise ValueError("Reference review provenance is missing or unsupported.")
    return data


def validate_retrieval_references(data: dict, docs: list[dict] | None = None) -> None:
    by_id = {d["id"]: d for d in (all_documents() if docs is None else docs)}
    for question in data["questions"]:
        if "DRAFT" in question.get("_note", ""):
            raise ValueError(f"Unconfirmed retrieval label: {question['id']}")
        ids = question["relevant_doc_ids"]
        if not ids and not question.get("expected_abstention"):
            raise ValueError("Empty relevance labels require an explicit no-evidence case.")
        if set(ids) != {r["doc_id"] for r in question["references"]}:
            raise ValueError("Every labeled passage requires a supporting quotation.")
        for ref in question["references"]:
            doc = by_id.get(ref["doc_id"])
            if (
                doc is None
                or hashlib.sha256(doc["text"].encode()).hexdigest() != ref["content_sha256"]
            ):
                raise ValueError(f"Source changed or is missing: {ref['doc_id']}")
            if " ".join(ref["quote"].split()) not in " ".join(doc["text"].split()):
                raise ValueError(f"Reference quotation is not in source: {ref['doc_id']}")
            if doc.get("source") != question["corpus"]:
                raise ValueError(f"Reference corpus mismatch: {question['id']}")


def validate_task_references(data: dict) -> None:
    groups: dict[str, set[str]] = {}
    for case in data["cases"]:
        inputs = case["inputs"]
        row = {**inputs["submission"], "_safer_snapshot": inputs["source_snapshot"]}
        if row["id"] != inputs["submission_id"] or fingerprint(row) != inputs["packet_sha256"]:
            raise ValueError(f"Frozen submission changed: {case['id']}")
        if fingerprint(inputs["safer_profile"]) != inputs["safer_sha256"]:
            raise ValueError(
                f"Frozen SAFER cache changed: {case['id']}; do not silently use a fresh profile."
            )
        assertions = case["reference_outputs"]["assertions"]
        if not assertions or len({a["id"] for a in assertions}) != len(assertions):
            raise ValueError("Assertions must have unique nonempty IDs.")
        groups.setdefault(row["dot_number"], set()).add(inputs["split"])
    if any(len(splits) > 1 for splits in groups.values()):
        raise ValueError("A carrier appears in both development and holdout sets.")


def manifest() -> dict:
    task = load_benchmark("ground_truth_memos")
    retrieval = load_benchmark("retrieval_questions")
    validate_task_references(task)
    validate_retrieval_references(retrieval)
    docs = all_documents()
    return {
        "version": task["version"],
        "review_status": task["review_status"],
        "limitations": task["limitations"],
        "task_sha256": fingerprint(task),
        "retrieval_sha256": fingerprint(retrieval),
        "corpus_sha256": fingerprint(
            sorted((d["id"], hashlib.sha256(d["text"].encode()).hexdigest()) for d in docs)
        ),
        "n_task_cases": len(task["cases"]),
        "n_retrieval_questions": len(retrieval["questions"]),
        "splits": {
            split: sum(c["inputs"]["split"] == split for c in task["cases"])
            for split in ("development", "holdout")
        },
        "corpus_counts": {
            source: sum(d.get("source") == source for d in docs)
            for source in ("ntsb", "10k", "forms", "industry")
        },
    }
