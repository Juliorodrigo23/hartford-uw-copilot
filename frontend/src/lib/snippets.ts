/**
 * Code snippets used in the walkthrough.
 *
 * These are VERBATIM excerpts from the backend files they cite. If you edit
 * the backend, update the excerpt (they are asserted against the real files
 * by backend/tests/test_snippets_match.py's spirit: keep them honest).
 */

export const SNIPPETS: Record<string, { code: string; lang: "python" | "tsx" | "ts" | "yaml" | "dockerfile" | "json" | "bash"; file: string }> = {
  pydantic_schemas: {
    file: "backend/app/schemas.py",
    lang: "python",
    code: `class VehicleMix(StrictBase):
    """Vehicle-type fractions. Auto-normalized to sum to 1.0 at construction."""

    tractor: float = Field(ge=0, le=1)
    straight_truck: float = Field(default=0.0, ge=0, le=1)
    trailer: float = Field(default=0.0, ge=0, le=1)
    other: float = Field(default=0.0, ge=0, le=1)

    @model_validator(mode="after")
    def _normalize(self) -> "VehicleMix":
        s = self.tractor + self.straight_truck + self.trailer + self.other
        if s > 0 and abs(s - 1.0) > 1e-9:
            ...

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
    rubric_scores: dict[str, float] | None = None`,
  },

  langgraph_builder: {
    file: "backend/app/graph/builder.py",
    lang: "python",
    code: `def _wire(g: StateGraph) -> StateGraph:
    g.add_node("parse_submission", parse_submission)
    g.add_node("enrich_carrier", enrich_carrier)
    g.add_node("retrieve_context", retrieve_context)
    g.add_node("analyze_loss_history", analyze_loss_history)
    g.add_node("find_comparables", find_comparables)
    g.add_node("draft_memo", draft_memo)
    g.add_node("self_critique", self_critique)
    g.add_node("finalize", finalize)
    g.add_node("data_insufficient", data_insufficient)

    g.set_entry_point("parse_submission")
    g.add_edge("parse_submission", "enrich_carrier")
    g.add_conditional_edges(
        "enrich_carrier",
        after_enrich,
        {"ok": "retrieve_context", "no_dot": "data_insufficient"},
    )
    g.add_edge("retrieve_context", "analyze_loss_history")
    g.add_edge("analyze_loss_history", "find_comparables")
    g.add_edge("find_comparables", "draft_memo")
    g.add_edge("draft_memo", "self_critique")
    g.add_conditional_edges(
        "self_critique",
        after_critique,
        {"loop": "retrieve_context", "pass": "finalize"},
    )
    g.add_edge("finalize", END)
    g.add_edge("data_insufficient", END)
    return g


def build_graph(checkpointer):
    """Compile the underwriting graph against a caller-provided checkpointer."""
    return _wire(StateGraph(AgentState)).compile(checkpointer=checkpointer)`,
  },

  hybrid_retrieval: {
    file: "backend/app/rag/hybrid_search.py",
    lang: "python",
    code: `def _rrf(rankings: list[list[Hit]]) -> list[Hit]:
    """Reciprocal rank fusion. Returns deduped list with summed RRF scores."""
    table: dict[str, list] = {}
    for ranks in rankings:
        for rank, (chunk_id, _score, text, src) in enumerate(ranks):
            entry = table.get(chunk_id) or [chunk_id, 0.0, text, src]
            entry[1] += 1.0 / (RRF_K + rank + 1)
            table[chunk_id] = entry
    fused = sorted(table.values(), key=lambda x: -x[1])
    return [tuple(x) for x in fused]


def _hybrid_search_sync(query, k_final, k_dense, k_bm25, rerank):
    try:
        emb = embed_query(query)
    except Exception as e:
        log.warning("embedding failed: %s — BM25-only fallback", e)
        emb = None

    rankings: list[list[Hit]] = []
    if emb is not None:
        rankings.append(_dense_search(emb, k_dense))
    rankings.append(_bm25_search(query, k_bm25))
    fused = _rrf(rankings)
    if rerank:
        fused = _rerank(query, fused, k_final)   # cross-encoder, top-50 → top-k
    else:
        fused = fused[:k_final]

    return [
        RetrievedChunk(doc_id=chunk_id, score=score, text=text, source=src or "unknown")
        for (chunk_id, score, text, src) in fused
    ]`,
  },

  xgb_train: {
    file: "backend/app/ml/train_xgb.py",
    lang: "python",
    code: `# An account is "adverse" when next-year claim frequency ≥ 5 claims / 100 PUs.
ADVERSE_FREQ = 0.05

def _fit_one(X: pd.DataFrame, y: pd.Series, features: list[str]):
    dtrain = xgb.DMatrix(X[features].values, label=y.values, feature_names=features)
    params = {
        "objective": "count:poisson",
        "eval_metric": "poisson-nloglik",
        "max_depth": 5,
        "learning_rate": 0.06,
        "subsample": 0.8,
        "colsample_bytree": 0.85,
        "tree_method": "hist",
    }
    return xgb.train(params, dtrain, num_boost_round=350)

# Classifier probability = exact Poisson tail P(N ≥ k | rate = prediction)
def tail_prob(rate: np.ndarray) -> np.ndarray:
    return poisson.sf(k_thresh - 1, mu=np.maximum(1e-9, rate))

# Isotonic calibration fitted on OUT-OF-FOLD probabilities, saved with the model
calibrator = IsotonicRegression(out_of_bounds="clip").fit(p_raw, y_bin)`,
  },

  monte_carlo_py: {
    file: "backend/app/ml/risk_simulation.py",
    lang: "python",
    code: `def aggregate_loss_distribution(
    lambda_claims: float,
    severity_mu_log: float,
    severity_sigma_log: float,
    n_sims: int = 10_000,
    seed: int = 42,
) -> SimResult:
    rng = np.random.default_rng(seed)
    counts = rng.poisson(lambda_claims, size=n_sims)
    out = np.zeros(n_sims, dtype=float)
    for i, n in enumerate(counts):
        if n:
            out[i] = float(rng.lognormal(severity_mu_log, severity_sigma_log, size=n).sum())
    sorted_ = np.sort(out)
    n = len(sorted_)
    var95 = float(sorted_[int(0.95 * (n - 1))])
    var99 = float(sorted_[int(0.99 * (n - 1))])
    tvar95 = float(sorted_[int(0.95 * n):].mean()) if int(0.95 * n) < n else var95
    return SimResult(samples=out, mean=float(out.mean()), var95=var95, tvar95=tvar95, var99=var99)`,
  },

  vertex_client: {
    file: "backend/app/llm/vertex_client.py",
    lang: "python",
    code: `def gemini(
    *,
    model: str | None = None,
    temperature: float = 0.1,
    max_output_tokens: int = 4096,
    streaming: bool = True,
) -> "ChatVertexAI":
    """Authentication uses Application Default Credentials: local dev via
    \`gcloud auth application-default login\`, Cloud Run via the attached
    service account."""
    from langchain_google_vertexai import ChatVertexAI

    return ChatVertexAI(
        model_name=model or settings.vertex_model,
        project=settings.gcp_project_id or None,
        location=settings.gcp_location,
        temperature=temperature,
        max_output_tokens=max_output_tokens,
        streaming=streaming,
    )


def gemini_fast() -> "ChatVertexAI":
    """Cheap structured-extraction calls (parse_submission, self_critique)."""
    return cached_gemini(settings.vertex_fast_model, 0.0)`,
  },

  llm_judge: {
    file: "backend/app/llm/judge_client.py",
    lang: "python",
    code: `class JudgeUnavailable(RuntimeError):
    """Raised when the eval-track judge cannot run (no API key)."""


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
    return {k: float(statistics.median([float(r.get(k, 0)) for r in runs])) for k in dims}`,
  },
};
