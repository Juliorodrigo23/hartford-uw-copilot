MEMO_SYSTEM = """You are a senior commercial-auto underwriter at The Hartford writing
an internal triage memo. Be direct. Cite every numerical claim. Use the [n] notation
referencing the citations passed to you. Do not fabricate exposures that aren't in
the retrieved evidence. If data is missing, say so explicitly — do not soft-pedal.
"""


MEMO_TEMPLATE = """\
SUBMISSION
==========
ID: {sub_id}
Carrier: {carrier_name} (DOT {dot_number})
Fleet: {fleet_size} power units · vehicle mix {vehicle_mix}
States: {states} · Commodity: {commodity}
Effective: {effective_date}

SAFER PROFILE
=============
{safer}

LOSS HISTORY
============
{loss_stats}

XGBOOST PREDICTION
==================
Predicted next-year claims: {xgb_pred} (80% PI {xgb_pi})
Top SHAP drivers (positive = elevates risk):
{shap_top}

COMPARABLE ACCOUNTS (top 3)
===========================
{comparables}

RETRIEVED EVIDENCE
==================
{retrieved}

==============================================================
TASK
==============================================================
Write the underwriting memo as Markdown. Sections (use ## headings):
1. Recommendation (one of: decline / quote_with_surcharge / quote)
2. Risk drivers (bullets, each citing a [n] reference)
3. Comparable accounts (one short paragraph)
4. Open questions for the broker (bullets)
5. Producer-facing summary (1 short paragraph, plain English)

Use [n] inline references that match the citation list. End with a JSON block
inside a ```json fence containing:
  {{"disposition": "<label>", "confidence": 0..1, "drivers": ["...", ...]}}
"""


CRITIQUE_PROMPT = """You are an internal critique pass over an underwriting memo.

Score the memo from 1-5 (integers) on each dimension and identify gaps.

Output strict JSON with keys:
  pass: bool (true iff all five dimensions ≥ 4 AND no critical gaps)
  rubric_scores: {{"factual_accuracy": 1-5, "completeness": 1-5, "calibration": 1-5, "citations": 1-5, "format": 1-5}}
  gaps: list of strings naming retrieval gaps the memo author should fill before re-drafting

CRITICAL GAPS (auto-fail) include:
- A material risk driver in the SAFER profile or loss history that's missing from the memo
- A claim in the memo with no supporting [n] citation when one is required
- Soft language ("some", "may") used where the data clearly supports a stronger statement

MEMO:
{memo}

EVIDENCE THE MEMO SHOULD ADDRESS:
{evidence}
"""
