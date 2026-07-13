"""Tool-layer contracts: honest absence reporting, provenance labeling,
fusion identity, judge availability."""

from datetime import date
from decimal import Decimal

import pytest

from app.llm.judge_client import JudgeUnavailable, judge_memo, pairwise_compare
from app.rag.hybrid_search import _rrf
from app.schemas import CritiqueVerdict, Submission, VehicleMix
from app.tools.loss_calc import loss_stats
from app.tools.xgb_loss_freq import _fallback


def _sub(loss_run=()):
    return Submission(
        id="T-1",
        carrier_name="Test Carrier",
        dot_number="123",
        fleet_size=100,
        vehicle_mix=VehicleMix(tractor=1.0),
        states_of_operation=["TX"],
        effective_date=date.today(),
        loss_run=list(loss_run),
        broker_email="",
    )


def test_loss_stats_none_for_empty_run():
    """No loss run must yield None, not zero-filled stats presented as computed."""
    assert loss_stats(_sub()) is None


def test_loss_stats_discloses_premium_assumption():
    from app.schemas import LossYear

    s = loss_stats(_sub([LossYear(year=2024, claims=4, incurred_usd=Decimal("400000"))]))
    assert s is not None
    assert s.assumed_premium_per_pu_usd == 5500
    assert s.n_years == 1


def test_fallback_prediction_is_labeled():
    pred = _fallback(_sub(), None)
    assert pred.source == "heuristic_fallback"
    assert pred.shap_top == []  # no model → no SHAP values to fabricate


def test_vehicle_mix_normalizes_at_construction():
    m = VehicleMix(tractor=0.6, straight_truck=0.6)
    assert abs(m.tractor + m.straight_truck + m.trailer + m.other - 1.0) < 1e-9
    assert abs(m.tractor - 0.5) < 1e-9


def test_rrf_dedups_by_chunk_id():
    a = [("doc#chunk-0", 1.0, "t", "ntsb"), ("doc#chunk-1", 0.5, "t", "ntsb")]
    b = [("doc#chunk-0", 9.9, "t", "ntsb")]
    fused = _rrf([a, b])
    ids = [f[0] for f in fused]
    assert ids.count("doc#chunk-0") == 1
    # appearing in both rankings must outrank a single appearance
    assert ids[0] == "doc#chunk-0"


def test_judge_raises_without_key(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "openai_api_key", "")
    with pytest.raises(JudgeUnavailable):
        judge_memo("memo", {})
    with pytest.raises(JudgeUnavailable):
        pairwise_compare("a", "b", {})


def test_critique_verdict_parses_judge_json():
    v = CritiqueVerdict.model_validate(
        {"pass": False, "rubric_scores": {"format": 5}, "gaps": ["missing OOS driver"], "extra": "ignored"}
    )
    assert v.pass_ is False
    assert v.gaps == ["missing OOS driver"]


def test_critique_verdict_defaults():
    v = CritiqueVerdict.model_validate({})
    assert v.pass_ is True and v.rubric_scores == {} and v.gaps == []
