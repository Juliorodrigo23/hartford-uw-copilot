/**
 * Code snippets used in the walkthrough.
 * In production, script 08 (backend) extracts these from real backend files
 * and writes them to /public/snippets/*.json. For now we inline the canonical
 * versions so the site renders before the backend exports anything.
 *
 * Each snippet ends up rendered with file_path:line_number annotations so an
 * interviewer can navigate to the actual code on GitHub.
 */

export const SNIPPETS: Record<string, { code: string; lang: "python" | "tsx" | "ts" | "yaml" | "dockerfile" | "json" | "bash"; file: string }> = {
  pydantic_schemas: {
    file: "backend/app/schemas.py",
    lang: "python",
    code: `from datetime import date
from decimal import Decimal
from pydantic import BaseModel, Field

class LossYear(BaseModel):
    year: int
    claims: int = Field(ge=0)
    incurred_usd: Decimal

class Submission(BaseModel):
    id: str
    carrier_name: str
    dot_number: str
    fleet_size: int = Field(ge=1)
    vehicle_mix: dict[str, float]              # {"tractor":0.78, "straight_truck":0.22}
    states_of_operation: list[str]
    effective_date: date
    loss_run: list[LossYear]
    broker_email: str

class RiskScore(BaseModel):
    label: str                                  # "decline" | "quote_with_surcharge" | "quote"
    confidence: float = Field(ge=0, le=1)
    drivers: list[str]                          # ranked, machine-readable

class Memo(BaseModel):
    submission_id: str
    risk_score: RiskScore
    body_md: str
    citations: list[str]                        # ["[1] ntsb-2019-04#chunk-12", ...]
    producer_summary: str`,
  },

  langgraph_builder: {
    file: "backend/app/graph/builder.py",
    lang: "python",
    code: `from langgraph.graph import StateGraph, END
from langgraph.checkpoint.sqlite import SqliteSaver
from app.graph.state import AgentState
from app.graph.nodes import (
    parse_submission, enrich_carrier, retrieve_context,
    analyze_loss_history, find_comparables, draft_memo,
    self_critique, finalize, data_insufficient,
)
from app.graph.edges import after_enrich, after_critique

def build():
    g = StateGraph(AgentState)
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
    g.add_conditional_edges("enrich_carrier", after_enrich, {
        "ok": "retrieve_context",
        "no_dot": "data_insufficient",
    })
    g.add_edge("retrieve_context", "analyze_loss_history")
    g.add_edge("analyze_loss_history", "find_comparables")
    g.add_edge("find_comparables", "draft_memo")
    g.add_edge("draft_memo", "self_critique")
    g.add_conditional_edges("self_critique", after_critique, {
        "loop": "retrieve_context",
        "pass": "finalize",
    })
    g.add_edge("finalize", END)
    g.add_edge("data_insufficient", END)

    return g.compile(checkpointer=SqliteSaver.from_conn_string("data/checkpoints.sqlite"))`,
  },

  hybrid_retrieval: {
    file: "backend/app/rag/hybrid_search.py",
    lang: "python",
    code: `from rank_bm25 import BM25Okapi
from sentence_transformers import CrossEncoder
import numpy as np

class HybridRetriever:
    """BM25 + dense + Reciprocal Rank Fusion + cross-encoder rerank."""

    def __init__(self, chroma_collection, bm25_corpus, k_dense=50, k_bm25=50, k_final=10):
        self.chroma = chroma_collection
        self.bm25 = BM25Okapi([t.split() for t in bm25_corpus])
        self.bm25_ids = list(range(len(bm25_corpus)))
        self.reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
        self.k_dense, self.k_bm25, self.k_final = k_dense, k_bm25, k_final

    def search(self, query: str, embedding: np.ndarray) -> list[dict]:
        # Dense top-k
        d = self.chroma.query(query_embeddings=[embedding], n_results=self.k_dense)
        dense_ids = d["ids"][0]

        # BM25 top-k
        bm25_scores = self.bm25.get_scores(query.split())
        bm25_top = np.argsort(bm25_scores)[::-1][: self.k_bm25].tolist()

        # Reciprocal rank fusion (k=60 is the standard constant)
        rrf: dict[str, float] = {}
        for rank, doc_id in enumerate(dense_ids):
            rrf[doc_id] = rrf.get(doc_id, 0) + 1 / (60 + rank + 1)
        for rank, idx in enumerate(bm25_top):
            doc_id = self.bm25_ids[idx]
            rrf[doc_id] = rrf.get(doc_id, 0) + 1 / (60 + rank + 1)

        fused = sorted(rrf.items(), key=lambda x: x[1], reverse=True)[:50]

        # Cross-encoder rerank top-50 → top-k_final
        pairs = [(query, self.chroma.get(ids=[doc_id])["documents"][0]) for doc_id, _ in fused]
        scores = self.reranker.predict(pairs)
        order = np.argsort(scores)[::-1][: self.k_final]
        return [{"doc_id": fused[i][0], "score": float(scores[i])} for i in order]`,
  },

  vertex_client: {
    file: "backend/app/llm/vertex_client.py",
    lang: "python",
    code: `from langchain_google_vertexai import ChatVertexAI
from langchain_core.prompts import ChatPromptTemplate
from app.config import settings

# Single source of truth for the underwriting LLM.
# Streamed, deterministic temperature, JSON-mode output for structured nodes.
def gemini(model: str | None = None, *, temperature: float = 0.1) -> ChatVertexAI:
    return ChatVertexAI(
        model_name=model or settings.vertex_model,
        project=settings.gcp_project_id,
        location=settings.gcp_location,
        temperature=temperature,
        max_output_tokens=4096,
        streaming=True,
        # Service-account auth via Application Default Credentials.
    )

# A separate, smaller model for cheap structured-extraction calls.
def gemini_fast() -> ChatVertexAI:
    return gemini(settings.vertex_fast_model, temperature=0.0)`,
  },

  xgb_train: {
    file: "backend/app/ml/train_xgb.py",
    lang: "python",
    code: `import xgboost as xgb
import pandas as pd
import shap
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import brier_score_loss
from sklearn.model_selection import GroupKFold

def train(features: pd.DataFrame, target: pd.Series, group: pd.Series):
    # GroupKFold by carrier so the same fleet never appears in train+val.
    cv = GroupKFold(n_splits=5)
    base = xgb.XGBClassifier(
        max_depth=5, n_estimators=400, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8,
        objective="binary:logistic",
        eval_metric="logloss",
        tree_method="hist",
    )

    fold_scores = []
    for tr, va in cv.split(features, target, groups=group):
        base.fit(features.iloc[tr], target.iloc[tr])
        p = base.predict_proba(features.iloc[va])[:, 1]
        fold_scores.append(brier_score_loss(target.iloc[va], p))

    # Refit on all data, then isotonic-calibrate on a held-out year.
    final = CalibratedClassifierCV(base, method="isotonic", cv=3)
    final.fit(features, target)

    # SHAP explainer for the underlying booster (not the calibrator wrapper).
    explainer = shap.TreeExplainer(base)
    return final, explainer, {"cv_brier_mean": float(sum(fold_scores) / len(fold_scores))}`,
  },

  llm_judge: {
    file: "backend/app/eval/generation.py",
    lang: "python",
    code: `import json
from openai import OpenAI
from app.config import settings

JUDGE_PROMPT = """You are a senior commercial-auto underwriter evaluating an underwriting memo.
Score the memo from 1-5 on each dimension. Output strict JSON: {"factual_accuracy": int, ...}.

Memo:
{memo}

Submission ground truth:
{ground_truth}

Dimensions:
- factual_accuracy: claims supported by retrieved chunks
- completeness: covers all material exposures
- calibration: risk language matches severity (no soft-pedaling)
- citations: every numerical claim has a [n] reference
- format: valid markdown, sections present"""

def judge_memo(memo: str, ground_truth: dict, n_runs: int = 3) -> dict:
    """Cross-family LLM-as-judge. Median of 3 runs to reduce noise."""
    client = OpenAI(api_key=settings.openai_api_key)
    scores: list[dict] = []
    for _ in range(n_runs):
        r = client.chat.completions.create(
            model="gpt-4o",
            response_format={"type": "json_object"},
            temperature=0.0,
            messages=[
                {"role": "system", "content": "You return only JSON."},
                {"role": "user", "content": JUDGE_PROMPT.format(
                    memo=memo, ground_truth=json.dumps(ground_truth)
                )},
            ],
        )
        scores.append(json.loads(r.choices[0].message.content))
    return {k: median([s[k] for s in scores]) for k in scores[0]}`,
  },

  fastapi_chat: {
    file: "backend/app/api/chat.py",
    lang: "python",
    code: `from fastapi import APIRouter, Request, HTTPException
from sse_starlette.sse import EventSourceResponse
import json, time, uuid
from app.graph.builder import build
from app.api.auth import verify_hmac

router = APIRouter()
graph = build()

@router.post("/chat")
async def chat(req: Request):
    verify_hmac(req)
    body = await req.json()
    submission_id = body.get("submission_id")
    message = body["message"]

    async def event_stream():
        run_id = uuid.uuid4().hex
        t0 = time.time()
        try:
            async for ev in graph.astream(
                {"submission_id": submission_id, "user_message": message, "history": body.get("history", [])},
                config={"configurable": {"thread_id": run_id}},
                stream_mode="values",
            ):
                # Emit a node_enter event for each node transition.
                node = ev.get("__metadata__", {}).get("source")
                if node:
                    yield {"event": "node_enter", "data": json.dumps({"node": node, "t_ms": int((time.time()-t0)*1000)})}
                # Stream tokens as they arrive from the draft_memo node.
                if "memo_chunk" in ev:
                    yield {"event": "token", "data": json.dumps({"text": ev["memo_chunk"]})}
                # Tool calls and results
                for tc in ev.get("tool_calls", []):
                    yield {"event": "tool_call", "data": json.dumps(tc)}
                for tr in ev.get("tool_results", []):
                    yield {"event": "tool_result", "data": json.dumps(tr)}
            yield {"event": "final", "data": json.dumps({"memo": ev.get("memo", ""), "run_id": run_id})}
        except Exception as e:
            yield {"event": "error", "data": json.dumps({"message": str(e)})}

    return EventSourceResponse(event_stream())`,
  },

  monte_carlo_py: {
    file: "backend/app/ml/risk_simulation.py",
    lang: "python",
    code: `import numpy as np

def aggregate_loss_distribution(
    lambda_claims: float,
    severity_mu_log: float,
    severity_sigma_log: float,
    n_sims: int = 10_000,
    rng: np.random.Generator | None = None,
) -> np.ndarray:
    """Compound-Poisson-LogNormal aggregate loss simulation.

    For each year:
      N ~ Poisson(lambda_claims)
      Sᵢ ~ LogNormal(mu, sigma) for i = 1..N
      L  = sum(Sᵢ)

    Returns the empirical distribution over n_sims realizations. Caller
    derives Var, TVaR, etc. from this.
    """
    rng = rng or np.random.default_rng(seed=42)
    counts = rng.poisson(lambda_claims, size=n_sims)
    out = np.zeros(n_sims)
    for i, n in enumerate(counts):
        if n:
            out[i] = rng.lognormal(severity_mu_log, severity_sigma_log, size=n).sum()
    return out`,
  },

  dockerfile: {
    file: "Dockerfile",
    lang: "dockerfile",
    code: `FROM python:3.12-slim AS builder
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY backend/pyproject.toml backend/uv.lock /app/
RUN uv sync --frozen --no-install-project --no-dev
COPY backend/app /app/app
RUN uv sync --frozen --no-dev

FROM python:3.12-slim
WORKDIR /app
ENV PORT=8080 PYTHONUNBUFFERED=1
COPY --from=builder /app /app
EXPOSE 8080
CMD ["/app/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "2"]`,
  },
};
