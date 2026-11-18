"""Reference integrity, scoring boundaries, complete prompts and retrieval scopes."""

import copy
import hashlib
import importlib
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.eval.benchmark import (
    load_benchmark,
    validate_retrieval_references,
    validate_task_references,
)
from app.eval.scoring import citation_check, format_check, validate_grade
from app.llm.evidence import evidence_hash
from app.rag.hybrid_search import _bm25_search, route_corpora, tokenize
from app.schemas import ChatRequest, RetrievedChunk
from tests.test_graph_e2e import MEMO_TEXT, SCORES, _test_safer, _test_submission


def test_frozen_packets_and_carrier_disjoint_holdout_are_valid():
    data = load_benchmark("ground_truth_memos")
    validate_task_references(data)
    assert len(data["cases"]) == 20
    changed = copy.deepcopy(data)
    changed["cases"][0]["inputs"]["submission"]["fleet_size"] += 1
    with pytest.raises(ValueError, match="changed"):
        validate_task_references(changed)


def test_retrieval_labels_require_real_quotations_and_matching_hashes():
    text = "An inspected public source passage."
    docs = [{"id": "report#chunk-0", "source": "ntsb", "text": text}]
    data = {
        "questions": [
            {
                "id": "Q",
                "corpus": "ntsb",
                "relevant_doc_ids": ["report#chunk-0"],
                "references": [
                    {
                        "doc_id": "report#chunk-0",
                        "quote": "public source",
                        "content_sha256": hashlib.sha256(text.encode()).hexdigest(),
                    }
                ],
            }
        ]
    }
    validate_retrieval_references(data, docs)
    data["questions"][0]["references"][0]["quote"] = "unsupported draft label"
    with pytest.raises(ValueError, match="quotation"):
        validate_retrieval_references(data, docs)


def test_grade_requires_all_assertions_and_real_booleans():
    refs = [{"id": "known"}]
    raw = {
        "assertions": [{"id": "known", "covered": True, "reason": "supported"}],
        "material_claims": [{"claim": "fact", "supported": True, "reason": "packet"}],
        "rubric_scores": SCORES,
    }
    validate_grade(raw, refs)
    raw["assertions"][0]["id"] = "invented"
    with pytest.raises(ValueError, match="every reference"):
        validate_grade(raw, refs)
    raw["assertions"][0].update(id="known", covered="false")
    with pytest.raises(ValueError):
        validate_grade(raw, refs)


def test_citation_validation_is_not_claim_support_and_no_refs_are_not_a_pass():
    evidence = {"retrieved_evidence": [{"ref": "[1]"}]}
    assert citation_check("Account observation (SAFER)", evidence)["citation_validity"] is None
    result = citation_check("A statement [1] and a fabricated citation [99]", evidence)
    assert result["citation_validity"] == 0.5
    assert result["invalid_references"] == ["99"]
    assert not format_check("No structured recommendation")
    assert format_check(MEMO_TEXT)


def test_empty_forms_scope_cannot_return_unrelated_industry_chunks(monkeypatch):
    import app.rag.hybrid_search as hybrid

    class BM:
        def get_scores(self, tokens):
            return [10, 20]

    monkeypatch.setattr(
        hybrid,
        "_bm25",
        lambda: (
            BM(),
            [
                {"id": "a", "source": "ntsb", "text": "exclusions"},
                {"id": "b", "source": "10k", "text": "insurance"},
            ],
        ),
    )
    assert _bm25_search("coverage form", 10, ("forms",)) == []
    assert route_corpora("ISO commercial auto coverage form") == ("forms",)
    assert route_corpora("FMCSA hours of service") == ("industry",)
    assert tokenize("OOS-rate 14.61%") == ["oos", "rate", "14", "61"]


async def test_author_and_reviewer_receive_the_same_complete_packet(monkeypatch):
    draft = importlib.import_module("app.graph.nodes.draft_memo")
    critic = importlib.import_module("app.graph.nodes.self_critique")
    sub = _test_submission()
    sub.broker_email = "broker context " * 1800 + "BROKER_END_MARKER"
    long_passage = "source context " * 1800 + "SOURCE_END_MARKER"
    state = {
        "submission": sub,
        "safer_profile": _test_safer(),
        "source_snapshot": {"source_detail": "full original snapshot"},
        "retrieved": [
            RetrievedChunk(doc_id="doc#chunk-0", text=long_passage, source="ntsb", score=1.0)
        ],
    }
    calls = []

    class Fake:
        async def astream(self, messages):
            calls.append(messages[-1].content)
            yield SimpleNamespace(content=MEMO_TEXT)

    monkeypatch.setattr(draft, "gemini", lambda **kw: Fake())
    reviewer = AsyncMock(
        return_value={
            "pass": True,
            "rubric_scores": SCORES,
            "gaps": [],
            "missing_documents": ["verified carrier loss documents"],
        }
    )
    monkeypatch.setattr(critic, "openai_runtime_critique", reviewer)
    from app.config import settings

    monkeypatch.setattr(settings, "openai_api_key", "test-only")
    state.update(await draft.draft_memo(state))
    result = await critic.self_critique(state)
    received = reviewer.call_args.args[1]
    for marker in ["BROKER_END_MARKER", "SOURCE_END_MARKER", "full original snapshot"]:
        assert marker in calls[0] and marker in received
    assert json.loads(received)["submission"]["loss_run"][0]["claims"] == 6
    assert state["draft_packet_hash"] == result["review_packet_hash"] == evidence_hash(state)
    assert result["critique_pass"] and result["missing_documents"]


def test_public_request_cannot_override_frozen_carrier_evidence():
    with pytest.raises(ValueError):
        ChatRequest.model_validate({"message": "triage", "benchmark_safer": {"power_units": 1}})
