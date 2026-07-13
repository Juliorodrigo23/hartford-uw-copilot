# Hartford Commercial Auto Underwriting Copilot

A live, deployed demo built for The Hartford Data Scientist (GenAI) interview. Mirrors the Applied AI Middle & Large Business team's stack: **Vertex AI / Gemini**, **LangGraph**, **RAG over real public data** (FMCSA SAFER, NTSB, SEC 10-Ks), **classical ML** (XGBoost loss-frequency with isotonic calibration + SHAP), and a **three-track evaluation harness with real component ablations**.

**Live at:** https://juliooo.com/hartford
**Source:** this repo

## Honesty contract

Everything on the site is either real pipeline output or explicitly labeled. Each visualization carries a provenance badge: `live pipeline data`, `pending` (with the exact command that generates it), or `illustrative` (concept walkthroughs, labeled as such). Eval tracks that have not run show a pending state with the reason; no placeholder numbers exist anywhere in the codebase. The XGBoost tool labels its own predictions (`xgboost` vs `heuristic_fallback`) and the memo prompt refuses to present a heuristic as a model output.

## What's here

- `backend/` — Python. FastAPI on Cloud Run; 9-node LangGraph agent with a durable SQLite checkpointer (so `/traces/{run_id}` replays real runs); hybrid RAG (BM25 + bge dense + RRF + cross-encoder rerank, one chunk-id space end to end); XGBoost loss-frequency (Poisson objective, grouped CV, isotonic calibration, SHAP); eval harness with per-track statuses and real ablation re-runs.
- `frontend/` — Next.js. Long-scroll walkthrough where every visual loads exported pipeline JSON, plus a live chat tab streaming SSE from the backend (with a clearly-bannered recorded-replay mode when no backend is configured).
- `Project description.md` — the JD and the original use-case plan this was built to.

## Run locally

```bash
# 0. Secrets — copy and fill in FMCSA_WEBKEY, OPENAI_API_KEY, GCP_PROJECT_ID
#    (FMCSA_WEBKEY is a free key: https://mobile.fmcsa.dot.gov/QCDevsite/ —
#     it switches carrier lookups to FMCSA's official JSON API)
cp .env.example .env
gcloud auth application-default login   # Vertex AI credentials

# 1. Backend deps
cd backend
uv sync

# 2. Data pipeline — one command, ordered, content-validated
#    (verifies carriers against FMCSA, ingests NTSB/SEC text through a
#    content gate that REJECTS junk instead of indexing it, builds the
#    index, synthesizes submissions whose fleet sizes come from the real
#    SAFER power-unit counts, trains + calibrates the model, runs evals,
#    exports every viz JSON, and captures one verified end-to-end run)
./scripts/run_pipeline.sh            # full (~30-60 min first run)
./scripts/run_pipeline.sh --quick    # skips LLM-judge evals + UMAP
# NOTE: scripts/seed_dot_numbers.json needs real mid-market DOT numbers;
# the pipeline verifies each one and tells you exactly what it rejected.

# 3. API
uv run uvicorn app.main:app --reload --port 8080

# 4. Frontend
cd ../frontend
cp .env.local.example .env.local     # point BACKEND_URL at :8080
pnpm install && pnpm dev
```

Open http://localhost:3000/hartford.

## Tests

```bash
cd backend && uv run pytest          # 27 tests: graph e2e (faked LLMs),
                                     # checkpointer/traces contract, tools,
                                     # streaming, schemas, edges
cd frontend && pnpm exec tsc --noEmit
```

## Deploy

See [DEPLOY.md](./DEPLOY.md). Note: the Docker image ships the built index,
synthesized data, SAFER cache, and model artifacts (see Dockerfile +
`.gcloudignore`), so run the data pipeline BEFORE `gcloud builds submit`.

## Why this exists

The Hartford's Applied AI Middle & Large Business team is doing GenAI on commercial-risk underwriting. Most candidates show up with a generic RAG demo. This is a domain-fitted system — real FMCSA carrier data, real NTSB narratives, real public 10-K risk factors — with an evaluation harness that's the actual differentiator. Built by Julio Contreras for the GD08AE Data Scientist role.
