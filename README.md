# Hartford Commercial Auto Underwriting Copilot

A live, deployed demo built for The Hartford Data Scientist (GenAI) interview. Mirrors the Applied AI Middle & Large Business team's stack: **Vertex AI / Gemini**, **LangGraph**, **RAG over real public data** (FMCSA SAFER, NTSB, SEC 10-Ks), **classical ML** (XGBoost loss-frequency), and a **three-track evaluation harness**.

**Live at:** https://juliooo.com/hartford
**Source:** this repo

## What's here

- `backend/` — Python pipeline. FastAPI on Cloud Run; LangGraph 8-node agent; Chroma RAG with hybrid search + rerank; XGBoost loss-freq predictor; eval harness.
- `frontend/` — Next.js site. Long-scroll walkthrough with animated visualizations + a live chat tab that streams from the real backend.
- `Project description.md` — the JD and the original use-case plan this was built to.

## Run locally

```bash
# 1. Backend
cd backend
uv sync
cp ../.env.example ../.env  # fill in secrets
uv run uvicorn app.main:app --reload --port 8080

# 2. Data prep (one-time, ~30–60 min wall clock the first time)
uv run python scripts/01_download_fmcsa.py
uv run python scripts/02_download_ntsb.py
uv run python scripts/03_download_10ks.py
uv run python scripts/04_build_index.py
uv run python scripts/05_synthesize_subs.py
uv run python scripts/06_train_xgb.py
uv run python scripts/07_run_evals.py
uv run python scripts/08_export_viz_data.py

# 3. Frontend
cd ../frontend
pnpm install
pnpm dev
```

Open http://localhost:3000/hartford.

## Deploy

See [DEPLOY.md](./DEPLOY.md).

## Why this exists

The Hartford's Applied AI Middle & Large Business team is doing GenAI on commercial-risk underwriting. Most candidates show up with a generic RAG demo. This is a domain-fitted system — real FMCSA carrier data, real NTSB narratives, real public 10-K risk factors — with an evaluation harness that's the actual differentiator. Built by Julio Contreras for the GD08AE Data Scientist role.
