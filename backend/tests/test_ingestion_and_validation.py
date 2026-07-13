"""Tests for the garbage-proofing added after the hostile audit:
content gate, 10-K extractor TOC bug, SAFER profile validation,
error-memo disposition, and empirical PI plumbing."""

from __future__ import annotations

from app.rag.content_gate import validate_document
from app.schemas import SAFERProfile


# --- content gate -----------------------------------------------------------

NAV_MENU = (
    "Investigations\nInvestigation Process\nInvestigation Reports\n"
    "Investigation Dockets\nNews & Events\nEvents\nNewsroom\n" * 40
)

REAL_NARRATIVE = (
    "On the night of the crash, a truck-tractor in combination with a semitrailer "
    "was traveling west on Interstate 70. The driver failed to respond to slowing "
    "traffic ahead. Investigators reviewed hours-of-service logs and the carrier's "
    "inspection history. The vehicle's brakes were within adjustment limits. "
) * 30


def test_gate_rejects_short_junk():
    r = validate_document("17", min_chars=2500)
    assert not r.ok and "too short" in r.reason


def test_gate_rejects_nav_menu():
    r = validate_document(NAV_MENU, min_chars=100)
    assert not r.ok
    assert "navigation" in r.reason or "menu-shaped" in r.reason


def test_gate_accepts_real_narrative():
    r = validate_document(REAL_NARRATIVE, min_chars=2500, required_any=("crash", "driver"))
    assert r.ok, r.reason


def test_gate_requires_domain_keywords():
    generic = ("This is a long passage of perfectly fluent prose about gardening and "
               "the joys of composting in early spring. It goes on at length. ") * 60
    r = validate_document(generic, min_chars=2500, required_any=("crash", "carrier", "vehicle"))
    assert not r.ok and "keyword" in r.reason


def test_gate_dedupes():
    seen: set[str] = set()
    assert validate_document(REAL_NARRATIVE, min_chars=100, seen_fingerprints=seen).ok
    r = validate_document(REAL_NARRATIVE, min_chars=100, seen_fingerprints=seen)
    assert not r.ok and "duplicate" in r.reason


# --- 10-K extractor: the TOC bug --------------------------------------------

def test_risk_factor_extractor_skips_toc_row():
    import importlib.util
    from pathlib import Path

    spec = importlib.util.spec_from_file_location(
        "dl10k", Path(__file__).resolve().parents[1] / "scripts" / "03_download_10ks.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    body = "Our business faces substantial risk from accident frequency and insurance claims. " * 200
    html = f"""
    <html><body>
      <p>TABLE OF CONTENTS</p>
      <p>Item 1A. Risk Factors</p><p>17</p><p>Item 1B. Unresolved Staff Comments</p>
      <p>PART I</p>
      <p>Item 1A. Risk Factors</p>
      <p>{body}</p>
      <p>Item 1B. Unresolved Staff Comments</p>
    </body></html>
    """
    section = mod._extract_risk_factors(html)
    # The old extractor returned "17" (the TOC page number). The fix takes
    # the LONGEST Item 1A→1B span.
    assert len(section) > 5000
    assert "accident frequency" in section
    assert section.strip() != "17"


# --- SAFER validation --------------------------------------------------------

def _profile(**kw) -> SAFERProfile:
    base = dict(
        legal_name="X", operating_status="UNKNOWN", power_units=1, drivers=1,
        crashes_24mo_total=0, oos_rate_vehicle=0.0, oos_rate_driver=0.0,
    )
    base.update(kw)
    return SAFERProfile(**base)


def test_garbage_profile_rejected():
    from app.tools.safer_lookup import _is_garbage

    assert _is_garbage(_profile())  # the print-shop shape
    assert not _is_garbage(_profile(operating_status="AUTHORIZED", power_units=140,
                                    oos_rate_vehicle=0.21, crashes_24mo_total=12))
    # UNKNOWN status but real activity → not parser defaults
    assert not _is_garbage(_profile(power_units=250, crashes_24mo_total=9, oos_rate_vehicle=0.15))


def test_qcmobile_mapping_normalizes_percentages():
    from app.tools.safer_lookup import _profile_from_qcmobile

    payload = {"content": {"carrier": {
        "legalName": "MIDWEST FREIGHT LLC", "statusCode": "A",
        "totalPowerUnits": 240, "totalDrivers": 260,
        "crashTotal": 14, "fatalCrash": 1, "injCrash": 6, "towawayCrash": 7,
        "vehicleOosRate": 22.4, "driverOosRate": 4.1,
    }}}
    p = _profile_from_qcmobile(payload, "1234567")
    assert p is not None
    assert p.operating_status == "AUTHORIZED"
    assert p.power_units == 240
    assert abs(p.oos_rate_vehicle - 0.224) < 1e-9
    assert abs(p.oos_rate_driver - 0.041) < 1e-9


def test_qcmobile_sub_one_percent_rates_stay_percentages():
    """Regression: a 0.87% driver OOS rate must become 0.0087, not 0.87.
    (The old conditional divide rendered it as 'Driver OOS 87%' in the UI.)"""
    from app.tools.safer_lookup import _profile_from_qcmobile

    payload = {"content": {"carrier": {
        "legalName": "TINY OOS CARRIER", "statusCode": "A",
        "totalPowerUnits": 600, "totalDrivers": 650,
        "vehicleOosRate": 0.5, "driverOosRate": 0.87,
    }}}
    p = _profile_from_qcmobile(payload, "7654321")
    assert p is not None
    assert abs(p.oos_rate_vehicle - 0.005) < 1e-9
    assert abs(p.oos_rate_driver - 0.0087) < 1e-9


# --- finalize: no fabricated recommendation on error memos -------------------

async def test_error_memo_yields_data_insufficient():
    from app.graph.nodes.finalize import finalize

    state = {"memo_md": "## Underwriting memo\n\nError generating memo: boom", "submission": None}
    out = await finalize(state)
    assert out["disposition"].label == "data_insufficient"
    assert out["disposition"].confidence == 0.0


# --- word-boundary red-flag matching -----------------------------------------

def test_redflag_word_boundaries():
    from app.eval.task_level import _term_present

    assert _term_present("Vehicle OOS rate is elevated.", "OOS")
    assert not _term_present("The chOOSe function was used.", "OOS")
    assert _term_present("BASIC HoS  Compliance above threshold", "HoS Compliance")
