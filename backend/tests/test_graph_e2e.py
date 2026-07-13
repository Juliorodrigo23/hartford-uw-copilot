"""End-to-end graph runs with faked LLMs.

Covers: the full happy path, the data_insufficient short-circuit, ablation
flags, critique fail-open-but-flagged behavior, and checkpointer sharing
(the /traces contract).
"""

from __future__ import annotations

import importlib

import pytest
from langgraph.checkpoint.memory import MemorySaver

from app.graph.builder import build_graph

# The nodes package re-exports the node FUNCTIONS under the same names as the
# submodules, so plain `import app.graph.nodes.draft_memo as m` resolves to
# the function. importlib returns the real modules.
draft_memo_mod = importlib.import_module("app.graph.nodes.draft_memo")
critique_mod = importlib.import_module("app.graph.nodes.self_critique")

MEMO_TEXT = (
    "## Underwriting memo\n\n**Recommendation:** quote_with_surcharge\n\n"
    "## Producer summary\nShort summary.\n\n"
    '```json\n{"disposition": "quote_with_surcharge", "confidence": 0.7, "drivers": ["x"]}\n```\n'
)


class _FakeStreamingLLM:
    def astream(self, _messages):
        async def gen():
            for piece in (MEMO_TEXT[: len(MEMO_TEXT) // 2], MEMO_TEXT[len(MEMO_TEXT) // 2 :]):
                yield type("Piece", (), {"content": piece})()
        return gen()


def _test_submission():
    from datetime import date
    from decimal import Decimal

    from app.schemas import LossYear, Submission, VehicleMix

    return Submission(
        id="SUB-001",
        carrier_name="Test Carrier Inc",
        dot_number="1234567",
        safer_legal_name="MIDWEST FREIGHT LLC",
        fleet_size=140,
        vehicle_mix=VehicleMix(tractor=0.9, straight_truck=0.1),
        states_of_operation=["TX", "OK"],
        effective_date=date(2026, 8, 1),
        loss_run=[LossYear(year=2024, claims=6, incurred_usd=Decimal("480000"))],
        broker_email="please quote",
    )


def _test_safer():
    from app.schemas import SAFERProfile

    return SAFERProfile(
        legal_name="MIDWEST FREIGHT LLC",
        operating_status="AUTHORIZED",
        power_units=142,
        drivers=150,
        crashes_24mo_total=11,
        crashes_24mo_fatal=0,
        oos_rate_vehicle=0.22,
        oos_rate_driver=0.05,
    )


@pytest.fixture()
def fake_llms(monkeypatch):
    """Fake the LLMs AND the data-layer lookups so the graph tests are fully
    self-contained (submissions.json and the SAFER cache are pipeline outputs
    that only exist after scripts 01/05 run on a networked machine)."""
    parse_mod = importlib.import_module("app.graph.nodes.parse_submission")
    enrich_mod = importlib.import_module("app.graph.nodes.enrich_carrier")
    retrieve_mod = importlib.import_module("app.graph.nodes.retrieve_context")

    monkeypatch.setattr(draft_memo_mod, "gemini", lambda **_kw: _FakeStreamingLLM())
    monkeypatch.setattr(parse_mod, "load_submission", lambda sid: _test_submission() if sid == "SUB-001" else None)

    async def fake_safer(_dot):
        return _test_safer()

    monkeypatch.setattr(enrich_mod, "safer_lookup", fake_safer)

    async def fake_retrieval(**_kwargs):
        return []

    # A populated developer Chroma directory must not make these graph tests
    # download/load native embedding models. Retrieval has focused tests of its
    # own; this fixture deliberately keeps the graph suite data-independent.
    monkeypatch.setattr(retrieve_mod, "hybrid_search", fake_retrieval)

    async def fake_critique(_memo, _evidence):
        return {"pass": True, "rubric_scores": {"format": 5}, "gaps": []}

    monkeypatch.setattr(critique_mod, "_gemini_critique", fake_critique)
    monkeypatch.setattr(critique_mod, "openai_runtime_critique", fake_critique)


def _initial(sub_id: str | None, **extra):
    return {
        "submission_id": sub_id,
        "user_message": "Triage this submission.",
        "history": [],
        "tool_calls": [],
        "tool_results": [],
        "retrieved": [],
        "citations": [],
        "critique_iters": 0,
        "draft_iters": 0,
        **extra,
    }


async def test_happy_path_produces_memo(fake_llms):
    graph = build_graph(MemorySaver())
    state = await graph.ainvoke(_initial("SUB-001"), config={"configurable": {"thread_id": "t1"}})
    assert state["memo"] is not None
    assert state["disposition"].label == "quote_with_surcharge"
    # Memo fields are whitespace-stripped by the schema config
    assert state["memo"].body_md == MEMO_TEXT.strip()
    # SAFER enrichment came from the shipped cache
    assert state["safer_profile"] is not None
    # tool provenance is explicit
    assert state["xgb_pred"].source in ("xgboost", "heuristic_fallback")


async def test_unknown_dot_routes_to_data_insufficient(fake_llms, monkeypatch):
    enrich_mod = importlib.import_module("app.graph.nodes.enrich_carrier")

    async def no_profile(_dot):
        return None

    monkeypatch.setattr(enrich_mod, "safer_lookup", no_profile)
    graph = build_graph(MemorySaver())
    state = await graph.ainvoke(_initial("SUB-001"), config={"configurable": {"thread_id": "t2"}})
    assert state["disposition"].label == "data_insufficient"
    assert "human underwriter" in state["memo"].body_md


async def test_ablation_flags_disable_components(fake_llms):
    graph = build_graph(MemorySaver())
    state = await graph.ainvoke(
        _initial("SUB-001", disable_rag=True, disable_comparables=True, disable_xgb=True, disable_critique=True),
        config={"configurable": {"thread_id": "t3"}},
    )
    assert state["retrieved"] == []
    assert state["comparables"] == []
    assert state.get("xgb_pred") is None
    assert state["critique_judge"] == "disabled"
    assert state["memo"] is not None  # still finalizes


async def test_critique_failure_fails_open_but_flagged(fake_llms, monkeypatch):
    async def boom(_memo, _evidence):
        raise RuntimeError("judge down")

    async def unavailable(_memo, _evidence):
        return None

    monkeypatch.setattr(critique_mod, "_gemini_critique", boom)
    monkeypatch.setattr(critique_mod, "openai_runtime_critique", unavailable)
    graph = build_graph(MemorySaver())
    state = await graph.ainvoke(_initial("SUB-001"), config={"configurable": {"thread_id": "t4"}})
    # run completed (fail open) …
    assert state["memo"] is not None
    # … but the failure is recorded, never hidden
    assert state["critique_judge"].startswith("error:")
    assert "judge down" in (state["critique_error"] or "")


async def test_critique_loop_redrafts_and_increments(fake_llms, monkeypatch):
    calls = {"n": 0}

    async def fail_once(_memo, _evidence):
        calls["n"] += 1
        if calls["n"] == 1:
            return {"pass": False, "rubric_scores": {}, "gaps": ["missing driver OOS"]}
        return {"pass": True, "rubric_scores": {}, "gaps": []}

    monkeypatch.setattr(critique_mod, "_gemini_critique", fail_once)
    monkeypatch.setattr(critique_mod, "openai_runtime_critique", lambda *a: _none())
    graph = build_graph(MemorySaver())
    state = await graph.ainvoke(_initial("SUB-001"), config={"configurable": {"thread_id": "t5"}})
    assert state["critique_iters"] == 2
    assert state["draft_iters"] == 2  # the loop actually produced a second draft
    assert state["critique_pass"] is True


async def _none():
    return None


async def test_traces_read_what_chat_wrote(fake_llms, tmp_path):
    """The /traces contract: one shared checkpointer, durable across 'requests'."""
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

    db = tmp_path / "ckpt.sqlite"
    async with AsyncSqliteSaver.from_conn_string(str(db)) as saver:
        graph = build_graph(saver)
        await graph.ainvoke(_initial("SUB-001"), config={"configurable": {"thread_id": "run-xyz"}})
        snap = await graph.aget_state({"configurable": {"thread_id": "run-xyz"}})
        assert snap is not None and snap.values
        assert snap.values["memo"].body_md == MEMO_TEXT.strip()
        missing = await graph.aget_state({"configurable": {"thread_id": "nope"}})
        assert not missing.values  # unknown run id yields empty values → 404
