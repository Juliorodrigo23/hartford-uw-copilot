# Commercial Insurance Agentic Underwriting Copilot

An observable, evaluation-first commercial auto underwriting system. It turns a submission packet into a cited decision-support memo by combining a stateful LangGraph agent, hybrid retrieval, public carrier evidence, an XGBoost risk tool, and a bounded critique-and-repair loop.

**[Explore the live project](https://juliooo.com/agentic-underwriting)**

> This is decision support, not automated underwriting. The sample submissions and book-of-business records are synthetic; cited carrier and safety evidence comes from public sources.

![Commercial insurance underwriting command center](docs/images/underwriting-command-center.jpg)

## What the system demonstrates

| Capability | Implementation |
| --- | --- |
| Agent workflow | Nine typed LangGraph nodes, two conditional routers, a bounded repair loop, and durable SQLite checkpoints |
| Retrieval | Chroma dense search with `BAAI/bge-large-en-v1.5` + BM25 + reciprocal rank fusion (`k=60`) + cross-encoder reranking from 50 candidates to 10 |
| Generative AI | Gemini 2.5 Pro drafts the memo through Vertex AI; Gemini 2.5 Flash handles fast-model duties and provides the fallback critic |
| Independent critique | GPT-4o critiques Gemini drafts when an OpenAI key is configured, reducing same-model judging bias |
| Classical ML | XGBoost loss-frequency prediction with isotonic calibration and SHAP feature attribution |
| Evidence and tools | FMCSA carrier enrichment, NTSB narratives, SEC 10-K risk factors, loss calculations, and comparable-account search |
| Evaluation | Retrieval, generation, and task-level tracks plus component ablations for RAG, critique, comparables, and XGBoost |
| Delivery | FastAPI/SSE backend on Cloud Run and a Next.js 15 interface on Vercel |

## Executable architecture

This is the graph compiled in `backend/app/graph/builder.py`. The alternate terminal path catches submissions without a usable DOT number; the critique router can reopen retrieval and regenerate the memo before finalization.

```mermaid
flowchart LR
    A["Parse submission"] --> B["Enrich carrier<br/>FMCSA SAFER"]
    B -->|DOT found| C["Retrieve context<br/>dense + BM25 + RRF + rerank"]
    B -->|DOT missing| X["Data insufficient"]
    C --> D["Analyze loss history<br/>XGBoost + SHAP"]
    D --> E["Find comparables"]
    E --> F["Draft memo<br/>Gemini 2.5 Pro"]
    F --> G["Self-critique<br/>GPT-4o or Gemini Flash"]
    G -->|evidence gaps and budget remains| C
    G -->|pass or loop limit| H["Finalize typed package"]
```

![LangGraph architecture and recorded repair trace](docs/images/langgraph-architecture.jpg)

### Model authentication

Gemini does not use a personal API key in this deployment. The backend calls Gemini through Google Vertex AI:

- Local development uses Google Application Default Credentials from `gcloud auth application-default login`.
- Cloud Run uses its attached service account, which has the Vertex AI User role.
- `OPENAI_API_KEY` is separate. It enables the cross-family GPT-4o critic and LLM-as-judge evaluation; if it is absent, runtime critique falls back to Gemini 2.5 Flash.

## Retrieval and evidence flow

```mermaid
flowchart LR
    Q["Underwriting question"] --> D["Dense candidates<br/>BGE embeddings"]
    Q --> B["Lexical candidates<br/>BM25"]
    D --> R["Reciprocal rank fusion<br/>k = 60"]
    B --> R
    R --> C["Cross-encoder rerank<br/>50 → 10"]
    C --> M["Cited memo evidence"]
    G["Critic gaps"] -->|gap-specific repair query| Q
```

Dense retrieval handles semantic similarity while BM25 preserves rare insurance and carrier terminology. Both rankings use one chunk-ID space, are fused, reranked, and carried into the memo as inspectable citations. If model weights or an index are unavailable, the interface displays a clearly labeled deterministic fallback rather than presenting synthetic retrieval as live output.

## Recorded sample run

The repository includes a captured end-to-end `SUB-001` trace. It is a reproducible replay of real pipeline output, not a claim that every browser session is invoking the backend.

| Recorded signal | Value |
| --- | ---: |
| Submitted fleet | 619 power units |
| Five-year loss run | 207 claims · $23.9M incurred |
| Verified FMCSA profile | 604 power units · 712 drivers · 41 crashes in 24 months |
| Retrieved evidence | 15 cited chunks |
| Risk model | 3.69 predicted next-year claims · 80% interval 1.6–6.2 |
| Critique | GPT-4o identified four gaps and reopened the evidence chain |
| Graph trace | 13 node transitions · two memo drafts |
| Final package | Decline · 95% confidence · 88.35 seconds |

The recorded outcome is illustrative decision support for a synthetic alias linked to a public carrier profile. It is not a real carrier decision.

## Evaluation, including the misses

`backend/scripts/07_run_evals.py` runs three independent tracks and records `ok` or `skipped` explicitly—missing results are never backfilled with invented values.

| Track | Latest tracked result | Scope |
| --- | ---: | --- |
| Retrieval | recall@10 **40.0%** · MRR **0.199** · nDCG@10 **0.233** | 10 golden questions |
| Generation | **80%** pairwise win rate over the baseline | 5 cases, multi-judge runs |
| Task level | red-flag recall **33.3%** · hallucination rate **20.0%** | 5 synthetic cases |

The task-level sample is intentionally small and the misses are visible. These numbers are evidence for iteration, not production-readiness claims.

The ablation suite re-runs the agent as:

- full system;
- without self-critique;
- without RAG;
- without comparable-account search;
- without the XGBoost loss-frequency tool.

That makes it possible to test whether each component changes retrieval, red-flag recall, or hallucination behavior instead of assuming that a more complex graph is automatically better.

## Repository map

```text
backend/
  app/
    graph/          # LangGraph state, nodes, routers, and checkpoints
    llm/            # Vertex AI Gemini and OpenAI judge clients
    tools/          # SAFER, loss, XGBoost, and comparable-account tools
    eval/           # retrieval, generation, task-level, and ablation tracks
  data/             # tracked public/synthetic artifacts and frontend exports
  scripts/          # ingestion, indexing, training, evaluation, and capture

frontend/
  src/app/          # overview, architecture, pipeline, and live-demo routes
  src/components/   # trace, retrieval, evaluation, and model visualizations
  public/data/      # validated browser-safe pipeline exports
```

## Run locally

### Prerequisites

- Python 3.11+, [uv](https://docs.astral.sh/uv/), Node.js, and pnpm
- A Google Cloud project with Vertex AI enabled
- Optional: an FMCSA web key for live carrier lookup
- Optional: an OpenAI key for the GPT-4o critic and generation evaluation

```bash
# Repository root
cp .env.example .env
gcloud auth application-default login

# Backend
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8080

# Frontend, in another terminal
cd frontend
cp .env.local.example .env.local
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The frontend defaults to `http://127.0.0.1:8080` for the local API. To mirror the deployment subpath, set `NEXT_PUBLIC_BASE_PATH=/hartford` and open `/hartford`.

### Build or refresh the data artifacts

The full orchestrator validates public inputs, builds retrieval indexes, trains the classical model, evaluates the agent, exports visualization data, and captures a showcase run.

```bash
cd backend
./scripts/run_pipeline.sh          # full pipeline
./scripts/run_pipeline.sh --quick  # skips LLM-judge evals and UMAP
```

When the corpus, submissions, and model are already current, refresh from evaluation onward:

```bash
cd backend
uv run python scripts/07_run_evals.py --ablations
uv run python scripts/08_export_viz_data.py --skip-umap
uv run python scripts/09_capture_showcase.py --submission SUB-001
```

`pnpm dev` and `pnpm build` run the frontend data sync automatically. Run it directly with:

```bash
cd frontend
pnpm run data:sync
```

## Test

```bash
cd backend
uv run pytest

cd ../frontend
pnpm exec tsc --noEmit
pnpm build
```

## Deploy

Run the data pipeline before building the Cloud Run image so the validated index, cached evidence, synthesized submissions, and model artifacts are included.

```bash
# Repository root — backend
gcloud builds submit --config cloudbuild.yaml .

# Frontend
cd frontend
vercel --prod
```

See [DEPLOY.md](./DEPLOY.md) for environment variables, secret setup, signed proxy requests, and health checks.

## Provenance and responsible use

- FMCSA SAFER profiles, NTSB accident narratives, NHTSA/FARS aggregates, and SEC filings are public-source evidence.
- Submission packets, carrier aliases, and book-of-business comparables are synthetic.
- Visualizations declare whether their data is live pipeline output, pending, or illustrative.
- The live demo keeps a human underwriter at the decision boundary.
- This portfolio system has not been validated for production insurance decisions.

Built by [Julio Contreras](https://juliooo.com).
