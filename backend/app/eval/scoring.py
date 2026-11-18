"""Evidence-aware memo scoring. Counts are derived from validated judgments."""

from __future__ import annotations

import json
import re

from langsmith import traceable
from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator

from app.config import settings
from app.observability.tracing import trace_openai

DIMENSIONS = ("factual_accuracy", "completeness", "calibration", "citations", "format")


class AssertionGrade(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    covered: StrictBool
    reason: str


class MaterialClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claim: str
    supported: StrictBool
    reason: str


class EvidenceGrade(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assertions: list[AssertionGrade] = Field(min_length=1)
    material_claims: list[MaterialClaim] = Field(min_length=1)
    rubric_scores: dict[str, float]

    @model_validator(mode="after")
    def validate_scores(self):
        if set(self.rubric_scores) != set(DIMENSIONS):
            raise ValueError("All five rubric dimensions are required.")
        if any(not 1 <= v <= 5 for v in self.rubric_scores.values()):
            raise ValueError("Rubric scores must be finite and between 1 and 5.")
        return self


def validate_grade(raw: dict, references: list[dict]) -> EvidenceGrade:
    grade = EvidenceGrade.model_validate(raw)
    expected = {r["id"] for r in references}
    actual = [a.id for a in grade.assertions]
    if len(actual) != len(set(actual)) or set(actual) != expected:
        raise ValueError("The evaluator must assess every reference assertion exactly once.")
    return grade


def citation_check(memo: str, evidence: dict) -> dict:
    used = re.findall(r"\[(\d+)\]", memo)
    valid = {d["ref"][1:-1] for d in evidence.get("retrieved_evidence", [])}
    invalid = sorted({ref for ref in used if ref not in valid})
    return {
        "references_used": len(used),
        "invalid_references": invalid,
        "citation_validity": sum(ref in valid for ref in used) / len(used) if used else None,
    }


def format_check(memo: str) -> bool:
    from app.schemas import Disposition

    match = re.search(r"```json\s*(\{.*?\})\s*```", memo, re.S)
    if not match:
        return False
    try:
        value = json.loads(match.group(1))
        Disposition.model_validate(
            {
                "label": value["disposition"],
                "confidence": value["confidence"],
                "drivers": value["drivers"],
            }
        )
        return True
    except (ValueError, TypeError, KeyError):
        return False


def summarize_grade(grade: EvidenceGrade, memo: str, evidence: dict) -> dict:
    caught = sum(a.covered for a in grade.assertions)
    unsupported = sum(not c.supported for c in grade.material_claims)
    return {
        "assertions_met": caught,
        "assertions_total": len(grade.assertions),
        "assertion_recall": caught / len(grade.assertions),
        "unsupported_claims": unsupported,
        "claims_checked": len(grade.material_claims),
        "unsupported_claim_rate": unsupported / len(grade.material_claims),
        "format_valid": format_check(memo),
        **citation_check(memo, evidence),
        "rubric_scores": grade.rubric_scores,
        "assertion_judgments": [a.model_dump() for a in grade.assertions],
        "claim_judgments": [c.model_dump() for c in grade.material_claims],
    }


@traceable(name="grade-evidence", run_type="chain")
async def grade_memo(memo: str, evidence: dict, references: list[dict]) -> dict:
    prompt = """Evaluate this memo against the actual evidence and frozen factual assertions.
The assertions are provisional, source-checked regression criteria, not expert-approved
underwriting decisions. Accept semantically equivalent language and sensible rounding.
A negated or contradicted assertion is NOT covered. A mere keyword mention is insufficient.
Do not penalize a memo for properly acknowledging a missing document. Supplied synthetic
annual aggregates are distinct from verified carrier loss-run documents. Broker claims
are unverified assertions, not inspected MVRs or attachments. Public crash involvement
does not establish fault, insurance claims, or loss payments. BASIC Not Public is unknown.
Only [n] external references in retrieved_evidence are valid. Submission, SAFER and
calculation facts can use named source labels without an external citation. Verify any
[n]-cited material assertion against the complete passage. Industry reports do not
establish account-specific facts. Requests and clearly conditional scenarios are not
asserted facts and must not count as unsupported claims.
Return JSON with exactly:
assertions: [{id, covered: boolean, reason: short evidence-based explanation}] for EVERY
reference assertion exactly once;
material_claims: [{claim: a concise atomic factual claim from the memo, supported: boolean,
reason: source path/ref or why unsupported}] covering its material factual claims;
rubric_scores: {factual_accuracy, completeness, calibration, citations, format}, each 1..5.
Calibration here means appropriate evidence-limited language, not actuarial calibration.
No preference for verbosity; no invented source material.
"""
    payload = {"memo": memo, "complete_evidence": evidence, "reference_assertions": references}
    async with AsyncOpenAI(api_key=settings.openai_api_key, max_retries=1) as raw:
        client = trace_openai(raw)
        response = await client.chat.completions.create(
            model=settings.openai_judge_model,
            response_format={"type": "json_object"},
            temperature=0,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
            max_tokens=6000,
            timeout=100,
        )
    grade = validate_grade(json.loads(response.choices[0].message.content or "{}"), references)
    return summarize_grade(grade, memo, evidence)
