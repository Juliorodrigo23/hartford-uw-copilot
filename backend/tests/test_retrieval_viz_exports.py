"""Regression tests for the Part 05 retrieval visualization contract."""

from __future__ import annotations

import importlib
import math

import numpy as np
import pytest

import app.rag.hybrid_search as hybrid
from scripts.seed_retrieval_viz import (
    load_seed_payload,
    strict_json_dumps,
    strict_json_loads,
    validate_retrieval_payload,
    write_seed_exports,
)


def test_seed_is_strict_finite_and_derived_from_real_export():
    payload = load_seed_payload()

    assert payload["provenance"]["kind"] == "deterministic_seed_from_real_export"
    for query in payload["queries"]:
        # The no-model rerank fallback must use existing real RRF hits rather
        # than attaching invented claims to real-looking document ids.
        assert query["reranked"] == query["rrf"]
        for stage in ("bm25", "dense", "rrf", "reranked"):
            assert all(math.isfinite(hit["score"]) for hit in query[stage])
    assert "NaN" not in strict_json_dumps(payload)


def test_browser_json_helpers_reject_nan():
    with pytest.raises(ValueError, match="non-standard JSON constant"):
        strict_json_loads('{"score": NaN}')
    with pytest.raises(ValueError, match="finite"):
        validate_retrieval_payload(
            {
                "queries": [
                    {
                        "query": "q",
                        **{
                            stage: [
                                {
                                    "id": "seed#chunk-0",
                                    "score": float("nan"),
                                    "source": "seed",
                                    "snippet": "explicit synthetic test hit",
                                }
                            ]
                            for stage in ("bm25", "dense", "rrf", "reranked")
                        },
                    }
                ]
            }
        )


def test_seed_writer_repairs_invalid_export_from_any_cwd(tmp_path):
    output = tmp_path / "nested" / "public" / "data"
    output.mkdir(parents=True)
    target = output / "retrieval_example.json"
    target.write_text('{"score": NaN}')

    written = write_seed_exports([output], only_if_missing=True)

    assert written == [target]
    validate_retrieval_payload(strict_json_loads(target.read_text()))


def test_bm25_identity_guard_rejects_duplicate_or_nonfinite_corpus(tmp_path):
    build_index = importlib.import_module("scripts.04_build_index")
    corpus = tmp_path / "bm25_corpus.json"
    valid_doc = {"id": "doc#chunk-0", "text": "validated narrative"}

    corpus.write_text(strict_json_dumps({"docs": [valid_doc]}))
    assert build_index._valid_bm25_corpus(corpus)

    corpus.write_text(strict_json_dumps({"docs": [valid_doc, valid_doc]}))
    assert not build_index._valid_bm25_corpus(corpus)

    corpus.write_text('{"docs":[{"id":"doc#chunk-0","text":"x","score":NaN}]}')
    assert not build_index._valid_bm25_corpus(corpus)


@pytest.mark.parametrize(
    "scores",
    [
        [float("nan"), float("nan"), float("nan")],
        [0.9, float("nan"), 0.1],
        [0.9, float("inf"), 0.1],
    ],
)
def test_reranker_never_leaks_non_finite_scores(monkeypatch, scores):
    class BadReranker:
        def predict(self, _pairs):
            return np.asarray(scores)

    hits: list[hybrid.Hit] = [
        ("a#chunk-0", 0.032, "alpha", "ntsb"),
        ("b#chunk-0", 0.031, "beta", "10k"),
        ("c#chunk-0", 0.030, "gamma", "industry"),
    ]
    monkeypatch.setattr(hybrid, "_reranker", lambda: BadReranker())

    result = hybrid._rerank("query", hits, 3)

    assert result == hits
    assert all(math.isfinite(hit[1]) for hit in result)
