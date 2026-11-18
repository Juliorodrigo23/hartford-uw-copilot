"""finalize / data_insufficient — terminal nodes."""

from __future__ import annotations

import json
import re

from app.graph.state import AgentState
from app.schemas import Disposition, Memo


def _extract_disposition(memo_md: str) -> Disposition:
    """Pull the JSON block out of the memo. Default to a soft fallback."""
    m = re.search(r"```json\s*(\{.*?\})\s*```", memo_md, re.DOTALL)
    if m:
        try:
            data = json.loads(m.group(1))
            label = data.get("disposition")
            if label not in {"decline", "quote_with_surcharge", "quote", "data_insufficient"}:
                raise ValueError("missing or invalid disposition")
            return Disposition(
                label=label,  # type: ignore[arg-type]
                confidence=float(data.get("confidence", 0.6)),
                drivers=list(data.get("drivers") or []),
            )
        except (json.JSONDecodeError, ValueError, TypeError):
            pass
    return Disposition(label="data_insufficient", confidence=0.0, drivers=["No valid structured recommendation; human review required."])


def _producer_summary(memo_md: str) -> str:
    """Pull the producer-summary section if present."""
    m = re.search(r"##\s*Producer.*?\n(.+?)(?=\n##|\Z)", memo_md, re.DOTALL | re.IGNORECASE)
    return (m.group(1).strip() if m else "")[:1200]


async def finalize(state: AgentState) -> AgentState:
    sub = state.get("submission")
    memo_md = state.get("memo_md", "")
    if not memo_md or "Error generating memo" in memo_md:
        # A failed generation is not an underwriting opinion. Emitting the
        # soft default ("quote_with_surcharge @ 0.5") on an error memo would
        # be a fabricated recommendation.
        disposition = Disposition(
            label="data_insufficient",
            confidence=0.0,
            drivers=["memo generation failed — no recommendation produced"],
        )
    else:
        disposition = _extract_disposition(memo_md)
    memo = Memo(
        submission_id=sub.id if sub else "AD_HOC",
        disposition=disposition,
        body_md=memo_md,
        citations=state.get("citations", []) or [],
        producer_summary=_producer_summary(memo_md),
        rubric_scores=state.get("rubric_scores"),
    )
    return {"memo": memo, "disposition": disposition}


async def data_insufficient(state: AgentState) -> AgentState:
    sub = state.get("submission")
    reason = state.get("data_insufficient_reason") or "carrier could not be enriched"
    body = (
        "## Underwriting memo\n\n"
        f"**Recommendation:** Cannot triage — {reason}.\n\n"
        "We were unable to resolve the carrier in the FMCSA SAFER service, "
        "which means we have no operating-authority status, no crash counts, "
        "and no BASIC scores to ground a recommendation. Route this submission "
        "to a human underwriter for manual workup before any quote.\n"
    )
    memo = Memo(
        submission_id=sub.id if sub else "AD_HOC",
        disposition=Disposition(label="data_insufficient", confidence=1.0, drivers=[reason]),
        body_md=body,
        producer_summary="Need additional information from the broker before we can quote.",
    )
    return {"memo": memo, "memo_md": body, "disposition": memo.disposition}
