"""Install a deterministic, no-model fallback for the retrieval visuals.

This script intentionally has no project dependencies. It can run before
``uv sync``, without network access, API keys, Chroma, or model weights:

    uv run --project backend python backend/scripts/seed_retrieval_viz.py

The seed follows the exact ``retrieval_example.json`` browser contract and is
explicitly marked ``deterministic_seed_from_real_export``. A successful real
export from script 08 replaces it and marks itself ``pipeline``.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
SEED_PATH = Path(__file__).with_name("retrieval_example.seed.json")
DEFAULT_OUTPUT_DIRS = (
    REPO_ROOT / "backend" / "data" / "exports",
    REPO_ROOT / "frontend" / "public" / "data",
)
STAGES = ("bm25", "dense", "rrf", "reranked")


def _reject_constant(value: str) -> None:
    raise ValueError(f"non-standard JSON constant: {value}")


def strict_json_loads(text: str) -> Any:
    """Parse browser-compatible JSON (reject NaN and infinities)."""
    return json.loads(text, parse_constant=_reject_constant)


def strict_json_dumps(payload: Any, *, indent: int | None = None) -> str:
    """Serialize browser-compatible JSON and reject non-finite floats."""
    return json.dumps(payload, indent=indent, allow_nan=False)


def validate_retrieval_payload(payload: Any) -> dict[str, Any]:
    """Validate the small cross-language contract used by both retrieval views."""
    if not isinstance(payload, dict):
        raise ValueError("retrieval payload must be an object")
    queries = payload.get("queries")
    if not isinstance(queries, list) or not queries:
        raise ValueError("retrieval payload must contain at least one query")

    for query_index, query in enumerate(queries):
        if not isinstance(query, dict) or not isinstance(query.get("query"), str):
            raise ValueError(f"queries[{query_index}] is missing query text")
        for stage in STAGES:
            hits = query.get(stage)
            if not isinstance(hits, list) or not hits:
                raise ValueError(f"queries[{query_index}].{stage} must contain hits")
            for hit_index, hit in enumerate(hits):
                where = f"queries[{query_index}].{stage}[{hit_index}]"
                if not isinstance(hit, dict):
                    raise ValueError(f"{where} must be an object")
                for key in ("id", "source", "snippet"):
                    if not isinstance(hit.get(key), str) or not hit[key]:
                        raise ValueError(f"{where}.{key} must be a non-empty string")
                score = hit.get("score")
                if isinstance(score, bool) or not isinstance(score, (int, float)):
                    raise ValueError(f"{where}.score must be numeric")
                if not math.isfinite(float(score)):
                    raise ValueError(f"{where}.score must be finite")

    # Also exercise the strict serializer so nested future fields cannot
    # smuggle a NaN into a file the browser will reject wholesale.
    strict_json_dumps(payload)
    return payload


def load_seed_payload() -> dict[str, Any]:
    return validate_retrieval_payload(strict_json_loads(SEED_PATH.read_text()))


def write_seed_exports(
    output_dirs: list[Path] | tuple[Path, ...] = DEFAULT_OUTPUT_DIRS,
    *,
    only_if_missing: bool = False,
) -> list[Path]:
    """Atomically populate every requested output directory with the seed.

    With ``only_if_missing``, an existing *valid* real export is preserved;
    malformed JSON (including Python ``NaN``) is repaired with the seed.
    """
    payload = load_seed_payload()
    text = strict_json_dumps(payload, indent=2) + "\n"
    written: list[Path] = []

    for output_dir in output_dirs:
        path = output_dir.resolve() / "retrieval_example.json"
        if only_if_missing and path.exists():
            try:
                validate_retrieval_payload(strict_json_loads(path.read_text()))
                continue
            except (OSError, TypeError, ValueError, json.JSONDecodeError):
                pass
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.tmp")
        tmp.write_text(text)
        tmp.replace(path)
        written.append(path)
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--if-missing",
        action="store_true",
        help="Preserve an existing strict/valid retrieval export; repair invalid files.",
    )
    parser.add_argument(
        "--output-dir",
        action="append",
        type=Path,
        help="Output directory (repeatable). Defaults to backend + frontend data dirs.",
    )
    args = parser.parse_args()
    outputs = args.output_dir or list(DEFAULT_OUTPUT_DIRS)
    written = write_seed_exports(outputs, only_if_missing=args.if_missing)
    if written:
        for path in written:
            print(f"wrote deterministic retrieval fallback: {path}")
    else:
        print("retrieval export already exists and passed strict validation")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
