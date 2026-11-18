"""GPT-4o judge — used both by the eval track and (optionally) at runtime.

Cross-family judging (Gemini generates, GPT-4o judges) avoids the
self-judging bias well-documented in the eval literature.

Two surfaces:
  - judge_memo / pairwise_compare → eval pipeline (sync, n-of-k median).
    These RAISE JudgeUnavailable when OpenAI is not configured. The eval
    runner catches that and marks the track "skipped" — placeholder scores
    are never written into results.
  - openai_runtime_critique → runtime critique node, async, single-shot.
    Returns None when unavailable; the node falls back to the Gemini judge
    and records which judge actually ran.
"""

from __future__ import annotations

import json
import logging
import statistics
from typing import Any

from openai import AsyncOpenAI, OpenAI

from app.config import settings
from app.observability.tracing import trace_openai

log = logging.getLogger(__name__)


class JudgeUnavailable(RuntimeError):
    """Raised when the eval-track judge cannot run (no API key)."""


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
    if not settings.openai_api_key:
        raise JudgeUnavailable(
            "OPENAI_API_KEY is not set. Drop your key into the repo-root .env "
            "(see .env.example) to enable the GPT judge."
        )
    return trace_openai(OpenAI(api_key=settings.openai_api_key))


def judge_memo(memo: str, ground_truth: dict[str, Any], n_runs: int = 3) -> dict[str, float]:
    """Run the judge n times. Return median scores per dimension.

    Raises JudgeUnavailable when OpenAI is not configured, so callers can
    mark the track as skipped instead of recording fake zeros.
    """
    client = _client()
    dims = ["factual_accuracy", "completeness", "calibration", "citations", "format"]
    runs: list[dict[str, int]] = []
    for _ in range(n_runs):
        r = client.chat.completions.create(
            model=settings.openai_judge_model,
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
        raise JudgeUnavailable("judge returned no parseable responses")
    return {k: float(statistics.median([float(r.get(k, 0)) for r in runs])) for k in dims}


def pairwise_compare(memo_a: str, memo_b: str, ground_truth: dict[str, Any]) -> str:
    """Pairwise A/B preference. Returns 'A', 'B', or 'tie'.

    Raises JudgeUnavailable when OpenAI is not configured.
    """
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
        model=settings.openai_judge_model,
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


# ---------------------------------------------------------------------------
# Runtime critique — invoked by the LangGraph self_critique node when
# CRITIQUE_PROVIDER=openai (or =auto and a key is present).
# ---------------------------------------------------------------------------

RUNTIME_CRITIQUE_SYSTEM = (
    "You are a senior commercial-auto underwriter doing a strict QA pass on a "
    "freshly-drafted underwriting memo. Return JSON only."
)

RUNTIME_CRITIQUE_PROMPT = """Score this memo on a 1-5 rubric and decide whether it should pass.

Output strict JSON:
{{
  "pass": true | false,
  "rubric_scores": {{
    "factual_accuracy": 1-5,
    "completeness": 1-5,
    "calibration": 1-5,
    "citations": 1-5,
    "format": 1-5
  }},
  "gaps": ["short, retrieval-actionable gap descriptions"]
}}

Pass criteria: pass=true iff every rubric score >= 4 AND no critical gap.
Critical gaps include: a material risk driver that's missing, an unsupported [n]-cited claim,
or soft language used where the data clearly supports a stronger statement.

MEMO:
{memo}

EVIDENCE THE MEMO SHOULD ADDRESS:
{evidence}
"""


async def openai_runtime_critique(memo: str, evidence: str) -> dict[str, Any] | None:
    """Return None when unconfigured, or raise JudgeUnavailable on failure.
    The node permits an announced provider substitution only in auto mode.
    """
    if not settings.openai_api_key:
        return None
    try:
        async with AsyncOpenAI(api_key=settings.openai_api_key, max_retries=0) as client:
            client = trace_openai(client)
            r = await client.chat.completions.create(
                model=settings.openai_judge_model,
                response_format={"type": "json_object"},
                temperature=0.0,
                messages=[
                    {"role": "system", "content": RUNTIME_CRITIQUE_SYSTEM},
                    {"role": "user", "content": RUNTIME_CRITIQUE_PROMPT.format(
                        memo=memo[:16000], evidence=evidence[:10000]
                    )},
                ],
                max_tokens=1000,
                timeout=30,
            )
        text = r.choices[0].message.content or "{}"
        return json.loads(text)
    except Exception as e:
        # Provider exception messages can include credential fragments. Keep
        # the browser-safe failure useful without returning the raw response.
        code = getattr(e, "status_code", None)
        reason = f"HTTP {code}" if code else type(e).__name__
        log.warning("OpenAI runtime critique failed (%s)", reason)
        raise JudgeUnavailable(f"OpenAI critique unavailable ({reason})") from None
