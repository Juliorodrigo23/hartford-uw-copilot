"""GPT-4o judge for the LLM-as-judge eval track.

Cross-family judging (Gemini generates, GPT-4o judges) avoids the
self-judging bias well-documented in the eval literature.
"""

from __future__ import annotations

import json
import statistics
from typing import Any

from openai import OpenAI

from app.config import settings


JUDGE_SYSTEM = "You are a strict JSON-only response evaluator."


JUDGE_PROMPT = """You are a senior commercial-auto underwriter evaluating an underwriting memo.
Score the memo from 1-5 (integers) on each dimension. Output strict JSON with these keys:
factual_accuracy, completeness, calibration, citations, format.

Rubric:
- factual_accuracy: every numerical claim is supported by the retrieved chunks. 5 = perfect, 1 = multiple unsupported claims.
- completeness: every material exposure is addressed. 5 = covers all flags from ground truth, 1 = misses majority.
- calibration: risk language matches severity. Avoid soft-pedaling adverse data. 5 = appropriate. 1 = mis-calibrated.
- citations: every [n] reference is grounded. 5 = all claims cited where required. 1 = no citations.
- format: valid markdown, sections present, machine-parseable disposition. 5 = clean. 1 = malformed.

MEMO:
{memo}

GROUND TRUTH (key signals the memo SHOULD surface):
{ground_truth}
"""


def _client() -> OpenAI:
    return OpenAI(api_key=settings.openai_api_key)


def judge_memo(memo: str, ground_truth: dict[str, Any], n_runs: int = 3) -> dict[str, float]:
    """Run the judge n times. Return median scores per dimension."""
    if not settings.openai_api_key:
        # Allow local dev without an OpenAI key. Returns a deterministic
        # placeholder so the eval pipeline doesn't crash.
        return {"factual_accuracy": 0.0, "completeness": 0.0, "calibration": 0.0, "citations": 0.0, "format": 0.0}
    client = _client()
    runs: list[dict[str, int]] = []
    for _ in range(n_runs):
        r = client.chat.completions.create(
            model="gpt-4o",
            response_format={"type": "json_object"},
            temperature=0.0,
            messages=[
                {"role": "system", "content": JUDGE_SYSTEM},
                {"role": "user", "content": JUDGE_PROMPT.format(
                    memo=memo, ground_truth=json.dumps(ground_truth, indent=2)
                )},
            ],
        )
        try:
            runs.append(json.loads(r.choices[0].message.content or "{}"))
        except json.JSONDecodeError:
            continue
    if not runs:
        return {"factual_accuracy": 0.0, "completeness": 0.0, "calibration": 0.0, "citations": 0.0, "format": 0.0}
    keys = runs[0].keys()
    return {k: float(statistics.median([r.get(k, 0) for r in runs])) for k in keys}


def pairwise_compare(memo_a: str, memo_b: str, ground_truth: dict[str, Any]) -> str:
    """Pairwise A/B preference. Returns 'A', 'B', or 'tie'."""
    if not settings.openai_api_key:
        return "tie"
    client = _client()
    prompt = f"""Compare two underwriting memos for the same submission. Pick the better one
on the rubric (factual_accuracy, completeness, calibration, citations, format).
Output strict JSON: {{"winner": "A" | "B" | "tie", "reason": "..."}}.

GROUND TRUTH: {json.dumps(ground_truth, indent=2)}

MEMO A:
{memo_a}

MEMO B:
{memo_b}
"""
    r = client.chat.completions.create(
        model="gpt-4o",
        response_format={"type": "json_object"},
        temperature=0.0,
        messages=[
            {"role": "system", "content": JUDGE_SYSTEM},
            {"role": "user", "content": prompt},
        ],
    )
    try:
        out = json.loads(r.choices[0].message.content or "{}")
        return out.get("winner", "tie")
    except json.JSONDecodeError:
        return "tie"
