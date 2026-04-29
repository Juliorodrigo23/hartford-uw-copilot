"""Domain schemas — Pydantic v2.

These types are the contract between every node, every tool, and the API.
The frontend's `lib/api.ts` mirrors a subset of them.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field, ConfigDict


class StrictBase(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class LossYear(StrictBase):
    year: int = Field(ge=1990, le=2100)
    claims: int = Field(ge=0)
    incurred_usd: Decimal = Field(ge=0)


class VehicleMix(StrictBase):
    """Fractions sum to 1 (validated)."""

    tractor: float = Field(ge=0, le=1)
    straight_truck: float = Field(default=0.0, ge=0, le=1)
    trailer: float = Field(default=0.0, ge=0, le=1)
    other: float = Field(default=0.0, ge=0, le=1)

    def normalized(self) -> "VehicleMix":
        s = self.tractor + self.straight_truck + self.trailer + self.other
        if s == 0:
            return self
        return VehicleMix(
            tractor=self.tractor / s,
            straight_truck=self.straight_truck / s,
            trailer=self.trailer / s,
            other=self.other / s,
        )


class Submission(StrictBase):
    id: str
    carrier_name: str
    dot_number: str
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


class XGBPrediction(StrictBase):
    pred_claims_next_yr: float
    pi_80: tuple[float, float]
    shap_top: list[dict[str, Any]] = Field(default_factory=list)


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
    doc_id: str
    score: float
    text: str
    source: str  # ntsb / 10k / forms / industry


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


class CritiqueVerdict(StrictBase):
    pass_: bool = Field(alias="pass")
    rubric_scores: dict[str, float]
    gaps: list[str] = Field(default_factory=list)


class ChatRequest(StrictBase):
    message: str
    submission_id: str | None = None
    history: list[dict[str, str]] = Field(default_factory=list)
    # "openai" / "gemini" / None — overrides the env-default critique judge
    critique_provider: str | None = None


class CorpusKind(StrEnum):
    NTSB = "ntsb"
    SEC_10K = "10k"
    FORMS = "forms"
    INDUSTRY = "industry"
    FMCSA = "fmcsa"
