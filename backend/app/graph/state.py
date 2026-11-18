"""Shared state object for the LangGraph agent."""

from __future__ import annotations

from typing import Any, TypedDict

from app.schemas import (
    Citation,
    Disposition,
    LossStats,
    Memo,
    RetrievedChunk,
    SAFERProfile,
    Submission,
    ToolCall,
    XGBPrediction,
)


class AgentState(TypedDict, total=False):
    # Input
    submission_id: str | None
    user_message: str
    history: list[dict[str, str]]

    # Parsed
    submission: Submission | None
    parse_notes: list[str]

    # Enrichment
    safer_profile: SAFERProfile | None

    # Retrieval
    retrieved: list[RetrievedChunk]
    citations: list[Citation]

    # Loss + ML
    loss_stats: LossStats | None
    xgb_pred: XGBPrediction | None

    # Comparables
    comparables: list[dict[str, Any]]

    # Memo
    memo_md: str
    draft_iters: int  # how many times draft_memo has produced a full draft
    disposition: Disposition | None
    memo: Memo | None

    # Critique
    critique_pass: bool
    critique_iters: int
    critique_gaps: list[str]
    rubric_scores: dict[str, float]
    critique_judge: str  # "gpt-4o" | "gemini-2.5-flash" | "skipped" | "disabled"
    critique_error: str | None  # set when the judge errored and the gate passed open
    critique_warning: str | None  # automatic provider substitution, with a valid verdict
    critique_provider_override: str | None  # "openai" | "gemini" | None

    # Tooling traces
    tool_calls: list[ToolCall]
    tool_results: list[ToolCall]

    # Routing flags
    data_insufficient_reason: str | None

    # Ablation switches (used by the eval harness to measure component
    # contributions on the REAL graph rather than a simulated one)
    disable_rag: bool
    disable_critique: bool
    disable_comparables: bool
    disable_xgb: bool
