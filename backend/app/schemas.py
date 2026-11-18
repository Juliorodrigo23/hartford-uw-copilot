"""Domain schemas — Pydantic v2.

These types are the contract between every node, every tool, and the API.
The frontend's `lib/api.ts` mirrors a subset of them.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictBase(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class LossYear(StrictBase):
    year: int = Field(ge=1990, le=2100)
    claims: int = Field(ge=0)
    incurred_usd: Decimal = Field(ge=0)


class VehicleMix(StrictBase):
    """Vehicle-type fractions. Auto-normalized to sum to 1.0 at construction.
    An all-zero mix is left untouched (callers treat it as unknown)."""

    tractor: float = Field(ge=0, le=1)
    straight_truck: float = Field(default=0.0, ge=0, le=1)
    trailer: float = Field(default=0.0, ge=0, le=1)
    other: float = Field(default=0.0, ge=0, le=1)

    @model_validator(mode="after")
    def _normalize(self) -> VehicleMix:
        s = self.tractor + self.straight_truck + self.trailer + self.other
        if s > 0 and abs(s - 1.0) > 1e-9:
            object.__setattr__(self, "tractor", self.tractor / s)
            object.__setattr__(self, "straight_truck", self.straight_truck / s)
            object.__setattr__(self, "trailer", self.trailer / s)
            object.__setattr__(self, "other", self.other / s)
        return self

    def normalized(self) -> VehicleMix:
        """Kept for backward compatibility; construction already normalizes."""
        return self


class Submission(StrictBase):
    id: str
    # Synthetic pseudonym used on the demo (a fabricated adverse loss run
    # must never be published under a real company's name)…
    carrier_name: str
    dot_number: str
    # …but the REAL SAFER identity is carried alongside for transparency,
    # and fleet_size is derived from the real SAFER power-unit count so the
    # submission never contradicts the federal record.
    safer_legal_name: str | None = None
    fleet_size: int = Field(ge=1)
    vehicle_mix: VehicleMix
    states_of_operation: list[str]
    effective_date: date
    loss_run: list[LossYear]
    broker_email: str
    commodity: str = Field(default="general_freight")


class SAFERProfile(StrictBase):
    legal_name: str
    operating_status: str
    power_units: int
    drivers: int
    crashes_24mo_total: int = 0
    crashes_24mo_fatal: int = 0
    crashes_24mo_injury: int = 0
    crashes_24mo_towaway: int = 0
    oos_rate_vehicle: float = 0.0
    oos_rate_driver: float = 0.0
    oos_rate_hazmat: float | None = None
    basic_violations: dict[str, str] = Field(default_factory=dict)
    raw_dot: str | None = None


class LossStats(StrictBase):
    frequency_per_pu_per_yr: float
    severity_avg_usd: Decimal
    trend_3yr_pct: float
    loss_ratio_3yr: float
    # The loss ratio is computed against an assumed premium; surfacing the
    # assumption keeps the memo honest about where the denominator comes from.
    assumed_premium_per_pu_usd: int = 5500
    n_years: int = 0


class XGBPrediction(StrictBase):
    pred_claims_next_yr: float
    pi_80: tuple[float, float]
    shap_top: list[dict[str, Any]] = Field(default_factory=list)
    # Provenance: "xgboost" when the trained booster produced the number,
    # "heuristic_fallback" when model artifacts were unavailable. The memo
    # prompt and the trace UI both surface this so a fallback is never
    # presented as a model output.
    source: Literal["xgboost", "heuristic_fallback"] = "xgboost"
    model_version: str | None = None


class ToolCall(StrictBase):
    id: str
    name: str
    input: dict[str, Any]
    output: dict[str, Any] | None = None
    ms: int | None = None


class Citation(StrictBase):
    ref: str  # "[1]"
    doc_id: str
    snippet: str


class RetrievedChunk(StrictBase):
    doc_id: str  # chunk id, e.g. "ntsb-2019-04#chunk-3"
    score: float
    text: str
    source: str  # CorpusKind value


class Disposition(StrictBase):
    label: Literal["decline", "quote_with_surcharge", "quote", "data_insufficient"]
    confidence: float = Field(ge=0, le=1)
    drivers: list[str]


class Memo(StrictBase):
    submission_id: str
    disposition: Disposition
    body_md: str
    citations: list[Citation] = Field(default_factory=list)
    producer_summary: str = ""
    rubric_scores: dict[str, float] | None = None


class CritiqueVerdict(BaseModel):
    """Validated shape of a judge response. Both the OpenAI and Gemini
    critique paths parse into this before the node trusts any field."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    pass_: bool = Field(alias="pass")
    rubric_scores: dict[str, Annotated[float, Field(ge=1, le=5, allow_inf_nan=False)]] = Field(min_length=1)
    gaps: list[str] = Field(default_factory=list)
    missing_documents: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def enforce_rubric(self) -> CritiqueVerdict:
        required = {"factual_accuracy", "completeness", "calibration", "citations", "format"}
        if set(self.rubric_scores) != required:
            raise ValueError("all five rubric dimensions are required")
        if self.gaps or any(score < 4 for score in self.rubric_scores.values()):
            self.pass_ = False
        return self


class ChatRequest(StrictBase):
    message: str = Field(min_length=1, max_length=12000)
    submission_id: str | None = Field(default=None, max_length=100)
    history: list[dict[Literal["role", "content"], str]] = Field(default_factory=list, max_length=12)
    # "openai" / "gemini" / None — overrides the env-default critique judge
    critique_provider: Literal["openai", "gemini"] | None = None

    @model_validator(mode="after")
    def bound_history(self) -> ChatRequest:
        for turn in self.history:
            if turn.get("role") not in ("user", "assistant"):
                raise ValueError("history role must be user or assistant")
            if len(turn.get("content", "")) > 12000:
                raise ValueError("history content is too long")
        return self


class CorpusKind(str, Enum):
    NTSB = "ntsb"
    SEC_10K = "10k"
    FORMS = "forms"
    INDUSTRY = "industry"
    FMCSA = "fmcsa"
