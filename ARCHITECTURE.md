# Architecture

This repo is a portfolio demo built for The Hartford's Applied AI (GenAI) Data Scientist role: a commercial-auto underwriting copilot. It has three moving parts:

1. **`backend/`**: a Python FastAPI service that hosts a LangGraph agent (Gemini on Vertex AI) with a durable SQLite checkpointer, a hybrid RAG stack (Chroma + BM25 + RRF + cross-encoder rerank), classical ML tools (calibrated XGBoost loss frequency, Monte Carlo risk simulation), and a three-track evaluation harness with real component ablations.
2. **`frontend/`**: a Next.js site with a long-scroll "pipeline walkthrough" (every visualization loads exported pipeline JSON and carries a provenance badge) and a live chat page that streams the agent's run over SSE.
3. **`backend/scripts/`**: a numbered offline data pipeline (01 to 08, orchestrated by `run_pipeline.sh`) that downloads public data (FMCSA SAFER, NTSB, SEC 10-Ks), builds the vector index, synthesizes demo submissions from verified-resolvable DOTs, trains and calibrates the ML model, runs evals, and exports JSON for the frontend.

Deployment: backend as a Docker image on Cloud Run (via `cloudbuild.yaml`; the image ships the built index, synthesized data, SAFER cache, model artifacts, and viz exports), frontend on Vercel under `juliooo.com/hartford`. The short-lived `/api/sign` route HMAC-signs the exact body so the browser can stream directly from Cloud Run; `/api/chat` remains a same-origin signed proxy fallback for CORS/connectivity failures and recorded-demo mode.

**Honesty contract:** every number on the site is real pipeline output, an explicit pending state, or a labeled illustration. No placeholder metrics exist in the codebase.

---

## Backend modules

### `app/main.py`
**What:** FastAPI entrypoint. `create_app()` adds CORS (exact origins + a regex for Vercel previews), a sliding-window per-IP rate limiter on `POST /chat` (driven by `RATE_LIMIT_PER_MIN`, sets `x-hartford-ratelimit-remaining`, 429 + `retry-after` on excess), and mounts the four routers. The **lifespan** compiles the agent graph ONCE against an `AsyncSqliteSaver` (file at `settings.checkpoint_db`) and stores it on `app.state.graph`; it also enables Langfuse tracing when keys are present.
**Why:** one shared graph + file-backed checkpoints is what makes `/traces/{run_id}` actually replay `/chat` runs, across both uvicorn workers and restarts.

### `app/config.py`
**What:** `Settings` (pydantic-settings), env-driven from the repo-root `.env`: GCP/Vertex, OpenAI judge (key + model), critique provider policy, HMAC auth, data/exports/checkpoint paths, RAG model names (overridable), CORS, rate limit.
**Why:** every module reads `settings`; environment differences are absorbed in one place.

### `app/schemas.py`
**What:** the domain contract, Pydantic v2, `extra="forbid"`. Notables: `VehicleMix` auto-normalizes to sum 1.0 via a model validator; `LossStats` carries `assumed_premium_per_pu_usd` and `n_years` so the loss-ratio denominator is disclosed; `XGBPrediction` carries `source: "xgboost" | "heuristic_fallback"` + `model_version` so a heuristic can never masquerade as a model; `CritiqueVerdict` validates judge JSON before any field is trusted; `CorpusKind` names the corpora.
**Why:** these types are the interface between every node, tool, and API; the frontend's `lib/api.ts` mirrors the export/result subset.

### `app/api/auth.py`
**What:** `verify_hmac(request)`: HMAC-SHA256 of `ts + body` with a shared secret, 5-minute replay window. Skipped when `ALLOW_UNSIGNED_DEV=true` (local dev only; cloudbuild sets it false).

### `app/api/chat.py`
**What:** `POST /chat` validates a `ChatRequest` and streams SSE from `request.app.state.graph.astream(..., stream_mode="updates")`. Events: `node_enter`/`node_exit`, `tool_call`/`tool_result` (deduped by id), `citation`, `critique_judge` (including `passed`, `error`, `gaps` so judge outages are visible), `token`, `redraft` (the critique loop produced a new draft; client clears and the full new draft re-streams), `final`, `error`. `split_stream_tokens` keeps whitespace so the streamed memo reassembles byte-for-byte.
**Why:** the trace panel needs a structured, ordered event protocol; this module adapts LangGraph's update stream to it.

### `app/api/traces.py`
**What:** `GET /traces/{run_id}` → `await app.state.graph.aget_state(thread_id)`; 404 when the snapshot has no values; `_serialize` converts Pydantic values to JSON.
**Why:** replay/scrub of completed runs; works because it reads the same SQLite checkpointer `/chat` writes.

### `app/api/eval.py` / `app/api/data.py`
**What:** `/eval` serves `app/eval/results/eval_results.json` (ships inside the image). `/data/{name}` serves `backend/data/exports/*.json` (name-sanitized; also ships in the image; script 08 writes it).

### `app/graph/state.py`
**What:** `AgentState` TypedDict: inputs (submission_id, user_message, history), parsed submission, SAFER profile, retrieved chunks + citations, loss stats + XGB prediction, comparables, memo text + `draft_iters`, critique bookkeeping (`critique_pass/iters/gaps`, `rubric_scores`, `critique_judge`, `critique_error`, provider override), tool traces, `data_insufficient_reason`, and ablation switches (`disable_rag/critique/comparables/xgb`) that the eval harness uses to measure component contributions on the real graph.

### `app/graph/builder.py`
**What:** `_wire()` builds the 9-node topology; `build_graph(checkpointer)` is the factory (FastAPI passes the AsyncSqliteSaver); `get_graph()` is an lru-cached MemorySaver compile for scripts/evals/tests.

```
parse_submission → enrich_carrier
enrich_carrier   →(after_enrich)→ "ok": retrieve_context | "no_dot": data_insufficient
retrieve_context → analyze_loss_history → find_comparables → draft_memo → self_critique
self_critique    →(after_critique)→ "loop": retrieve_context | "pass": finalize
finalize → END      data_insufficient → END
```

### `app/graph/edges.py`
**What:** `after_enrich` (None SAFER profile → `"no_dot"`) and `after_critique` (pass, or give up after `MAX_CRITIQUE_ITERS=2`). Pure and unit-tested.

### `app/graph/nodes/`
- **`parse_submission`**: loads the synthesized submission by id, else Gemini-Flash extraction from free text into a validated `Submission`.
- **`enrich_carrier`**: `safer_lookup(dot)` (cache → live scrape), records a `ToolCall`; a miss sets `data_insufficient_reason`.
- **`retrieve_context`**: honors `disable_rag`; builds the query from submission + SAFER signals + user message (+ critique gaps on loop passes); merges retrievals across iterations deduped by chunk id and numbers citations against the merged list so `[n]` refs match what the model sees.
- **`analyze_loss_history`**: `loss_stats` (None when no loss run — absence is reported, not zeros) and `xgb_predict` (skippable via `disable_xgb`), both recorded as ToolCalls.
- **`find_comparables`**: honors `disable_comparables`; queries with the REAL upstream evidence (SAFER OOS rates, computed loss stats), not median placeholders.
- **`draft_memo`**: formats all evidence into `MEMO_TEMPLATE` (which now includes the user's question, conversation history, and prior critique gaps), labels heuristic predictions as heuristics in the prompt, streams Gemini Pro, increments `draft_iters`.
- **`self_critique`**: honors `disable_critique`; resolves the judge (per-request override > env > auto), runs GPT-4o (falling back to Gemini Flash, recorded) and validates the verdict through `CritiqueVerdict`. Failure policy: FAIL OPEN, VISIBLY — the run finalizes but `critique_error` and `critique_judge="error:<judge>"` propagate to the UI.
- **`finalize` / `data_insufficient`**: extract the machine-readable disposition + producer summary into a `Memo`; or emit the fixed "route to a human underwriter" memo.

### `app/llm/`
- **`vertex_client.py`**: lazily-imported `ChatVertexAI` factories (`gemini`, `cached_gemini`, `gemini_fast`); ADC auth.
- **`judge_client.py`**: GPT judging. Eval surface (`judge_memo`, `pairwise_compare`) **raises `JudgeUnavailable`** without a key so the runner marks tracks skipped instead of recording fake zeros. Runtime surface (`openai_runtime_critique`) returns None on unavailability so the node falls back to Gemini and records the substitution.
- **`prompts/`**: parse extraction prompt; memo system/template (citation discipline: never emit an `[n]` not in the evidence list; disclose the premium assumption; describe heuristics as heuristics); critique rubric (a nonexistent citation is a critical gap).

### `app/rag/`
- **`chunker.py`**: semantic (cosine-distance breakpoints) + recursive chunkers; index-build time only.
- **`embeddings.py`**: lazy sentence-transformers wrapper (`settings.embed_model`, default bge-large).
- **`store.py`**: Chroma persistent client; `get_or_create` treats ONLY not-found as "create" (index corruption propagates); `reset_collection` gives the index build true idempotence.
- **`hybrid_search.py`**: the retrieval pipeline with a documented identity contract: every stage keys by chunk id (`<doc>#chunk-<i>`), so RRF dedup and golden-set matching are exact. `hybrid_search` (async, executor-wrapped) → embed → dense over all `CorpusKind` collections + BM25 → `_rrf` → cross-encoder `_rerank`. `search_stages` exposes per-stage rankings for the export script so the frontend shows REAL ranker disagreement.

### `app/tools/`
- **`safer_lookup.py`**: FMCSA SAFER Company Snapshot scraper with disk cache and tenacity retries; None on no-match (routes to `data_insufficient`).
- **`loss_calc.py`**: frequency/severity/trend/loss ratio; returns None for an empty loss run; the loss ratio uses last-3-years incurred against the disclosed premium assumption.
- **`xgb_loss_freq.py`**: loads booster + SHAP explainer + version metadata; predictions carry provenance (`source`, `model_version`); the fallback is labeled and produces no fake SHAP values.
- **`comparable_search.py`**: cosine over a 9-dim tabular feature vector against the 200-account book, fed with real SAFER/loss inputs from the caller.
- **`submissions.py`**: loads/caches synthesized submissions; malformed records are dropped LOUDLY (ERROR logs with ids).
- **`fars_query.py`**: NHTSA FARS CrashAPI client + `STATE_FIPS`; `fars_state_counts` powers the real state-metrics export in script 08.

### `app/ml/`
- **`features.py`**: canonical 10-feature encoding shared by training and inference.
- **`train_xgb.py`**: Poisson-objective XGBoost. Classification framing is underwriting-relevant: "adverse frequency" (≥ 5 claims per 100 PUs next year) with EXACT Poisson tail probabilities, avoiding the degenerate "≥1 claim" target. Trains three real feature ablations (v1 fleet-only, v2 +SAFER, v3 full) on the same GroupKFold split for the model-evolution visual; fits an isotonic calibrator on out-of-fold probabilities; saves booster, calibrator, SHAP explainer, and `model_meta.json` (version, training-data provenance `synthetic|parquet`, CV metrics, per-version confusion matrices, calibration bins, global importance).
- **`risk_simulation.py`**: compound Poisson-LogNormal Monte Carlo (mean/VaR/TVaR).

### `app/eval/`
Every track returns `status: ok | skipped` with a reason; **no zero-filled placeholders exist**.
- **`retrieval.py`** (Track 1): recall@k / MRR / nDCG against the golden questions; marks itself skipped when the golden set is missing or the index returns nothing (an infra failure is not a quality score).
- **`generation.py`** (Track 2): full agent vs no-tools baseline, judged by GPT (median of 3), pairwise winrate, judge IQR computed from actual run dispersion; skipped without an OpenAI key.
- **`task_level.py`** (Track 3): red-flag recall + hallucination counts per ground-truth case; accepts `extra_state` for ablations; LLM-failure stub memos count as failures, never as scores.
- **`ablations.py`**: maps ablation names to state flags and re-runs the REAL task-level eval per component (`evaluate_all_ablations`).

### `app/observability/tracing.py`
**What:** `maybe_enable_langfuse()`, called from the app lifespan; enabled when env keys exist.

### `scripts/` (offline pipeline; `run_pipeline.sh` runs 01→08)
1. **`01_download_fmcsa.py`**: resolves seed DOTs through `safer_lookup`, populating the cache.
2. **`02_download_ntsb.py`** / **`03_download_10ks.py`**: NTSB narratives; SEC 10-K Item 1A sections (EDGAR-compliant User-Agent).
3. **`04_build_index.py`**: chunk → embed → per-corpus Chroma (drop-and-recreate idempotence) + unified BM25 corpus; chunk-id contract enforced.
4. **`05_synthesize_subs.py`**: 30 submissions, every DOT VERIFIED resolvable before assignment (cache → live; failures excluded), plus the 200-account book.
5. **`06_train_xgb.py`**: training entrypoint (see `ml/train_xgb.py`).
6. **`07_run_evals.py`**: all tracks with statuses; `--skip-generation` marks Track 2 skipped (never fakes it); `--ablations` runs real component re-runs.
7. **`08_export_viz_data.py`**: writes every viz JSON to `backend/data/exports/` AND `frontend/public/data/`: `eval_results`, `submissions_index`, `monte_carlo`, `model_insights` (real SHAP waterfall for a real submission via the production predict path, calibration bins, version confusion matrices), `loss_landscape`, `retrieval_example` (real per-stage rankings), `chunking_example` (real chunker boundaries), `embeddings_umap`, `fars_state_metrics` (`--with-fars`; real NHTSA counts with a minimum-coverage guard). Prerequisite-missing exports are skipped with a log line, never faked.

### `tests/`
27 tests: graph end-to-end with faked LLMs over the real shipped SAFER cache (happy path, data_insufficient routing, ablation flags, critique fail-open-but-flagged, critique loop redraft), the checkpointer/traces contract (AsyncSqliteSaver roundtrip), token-stream byte-for-byte round-trips, tool contracts (loss stats absence, fallback labeling, RRF dedup, judge unavailability, verdict parsing), schemas, and edge routers.

---

## Frontend modules

### `src/app/`
- **`layout.tsx` / `page.tsx`**: shell, hero, about, overview map.
- **`pipeline/page.tsx`**: the 11-section walkthrough; prose + `CodeBlock` (verbatim snippets from `lib/snippets.ts`) + the viz components.
- **`chat/page.tsx`**: live demo. Streams `parseSSE` events into `MessageStream` + `AgentTracePanel`; sends the last 6 turns as `history`; handles `redraft` (clears the memo before the new draft streams); shows a persistent banner on `demo_notice`; critique judge toggle per request.
- **`api/sign/route.ts`**: returns a timestamped HMAC for the exact request body, enabling long browser → Cloud Run streams without a serverless duration ceiling.
- **`api/chat/route.ts`**: same-origin fallback proxy: per-IP hourly limiter (documented as per-instance), HMAC signing, SSE piping, and explicit upstream errors. With no `BACKEND_URL` it streams a recorded replay that ANNOUNCES itself via `demo_notice` and labeled synthetic payloads.

### `src/lib/`
- **`api.ts`**: `dataPath` + typed mirrors of the export/result schemas (`EvalResults` with per-track statuses, `ModelInsights`, `RetrievalExample`, `LossLandscape`, `FarsStateMetrics`, `ChunkingExample`).
- **`useData.ts`**: the one honest data-loading hook: `loading | live | missing`; components NEVER substitute invented numbers for missing data.
- **`sse.ts`**: SSE parser for the full event protocol including `redraft`, `demo_notice`, and the enriched `critique_judge` payload.
- **`snippets.ts`**: verbatim excerpts from the real backend files.

### `src/components/`
- **`DataBadge.tsx`**: provenance badges (`live pipeline data` / `pending` with the generating command / `illustrative` with an explanation) + `PendingCard`. Every visualization carries one.
- **`chat/`**: `SubmissionPicker` (real index, loading/error states, no fake fallback), `MessageStream` (markdown-ish renderer with citation chips), `AgentTracePanel` (live nodes/tools/citations; judge banner shows pass/fail, gaps, and "NOT quality-checked" on judge errors), `SuggestedPrompts`.
- **`viz/`** — data-backed (badge: live/pending): `EvalDashboard` + `AblationTable` (status-aware per track), `XGBSHAP`, `CalibrationCurve`, `ConfusionMatrixOverTime` (all from `model_insights.json`), `HybridSearchBars` + `RagRetrievalRays` (`retrieval_example.json`), `FreqSeverityHeatmap` (`loss_landscape.json`), `DataSourceMap` (`fars_state_metrics.json`), `ChunkingStrip` (`chunking_example.json`, labeled algorithm-demo fallback), `EmbeddingCloud3D` (`embeddings_umap.json`, pending badge on fallback), `MonteCarloLoss` (client-side simulation mirroring `risk_simulation.py`). Labeled illustrations: `AttentionHeatmap` (attribution METHOD demo), `SelfCritiqueDiff`, `ToolCallStream`, `LangGraphMachine` (real topology, representative timings).
- **`intro/`, `nav/`, `pipeline/Section`, `code/CodeBlock`**: presentational.

---

## Deployment artifacts

- **`Dockerfile`**: two-stage uv build; runtime ships `.venv`, `app/` (incl. ml artifacts + eval results), and `backend/data/{synthesized,chroma,processed,raw/fmcsa,exports}`. 2 uvicorn workers sharing the SQLite checkpointer.
- **`.dockerignore` / `.gcloudignore`**: keep runtime data in the build context/upload (gcloud would otherwise fall back to `.gitignore` and strip it) while dropping raw corpus text and dev dirs.
- **`cloudbuild.yaml`**: build → Artifact Registry → Cloud Run (`ALLOW_UNSIGNED_DEV=false`, HMAC + OpenAI key from Secret Manager).
- **`.env.example`** (root) and **`frontend/.env.local.example`**: drop-in key files.

---

## Call graph: one user request, end to end

Scenario: the user picks a submission on `/chat`, types a question, and hits send. Backend deployed, `BACKEND_URL` set.

```
BROWSER (frontend)
│ ChatPage.send(text)                                  chat/page.tsx
│   → POST {basePath}/api/sign, then stream directly from Cloud Run
│   → on signing/CORS/connectivity failure, POST {basePath}/api/chat as a same-origin fallback
│
NEXT.JS ROUTES (frontend/src/app/api/{sign,chat}/route.ts)
│ sign: HMAC(ts + body) → short-lived direct-stream credentials
│ chat fallback: rateLimit(ip) → HMAC(ts + body) → fetch ${BACKEND_URL}/chat → pipe SSE back
│   (no BACKEND_URL → demoStream() with a demo_notice event and labeled synthetic data)
│
FASTAPI (backend)
│ rate_limit_chat middleware (app/main.py) → _rate_check(ip) → 429 or remaining header
│ chat(request)                                        api/chat.py
│   → verify_hmac(request)                             api/auth.py
│   → ChatRequest.model_validate(body)                 schemas.py
│   → graph = request.app.state.graph                  compiled in main.lifespan with AsyncSqliteSaver
│   → EventSourceResponse(event_stream())
│
│ event_stream() → graph.astream(initial_state, thread_id=run_id, stream_mode="updates")
│       │
│       ├─ NODE parse_submission                       nodes/parse_submission.py
│       │    → load_submission(sub_id) → _all()        tools/submissions.py
│       │    (free-text: gemini_fast() → ainvoke(PARSE_*) → Submission(...))
│       │
│       ├─ NODE enrich_carrier                         nodes/enrich_carrier.py
│       │    → safer_lookup(dot)                       tools/safer_lookup.py
│       │         → _cache_path hit → SAFERProfile(**cached)
│       │         → miss: _fetch_snapshot → _parse_snapshot
│       │              → _parse_crash_table / _parse_oos_rates / _first_int / _first_pct
│       │    → ToolCall(...)  [tool_call / tool_result SSE]
│       │
│       ├─ EDGE after_enrich                           graph/edges.py
│       │    "ok" → retrieve_context | "no_dot" → data_insufficient → END
│       │
│       ├─ NODE retrieve_context                       nodes/retrieve_context.py
│       │    (disable_rag → skip)
│       │    → _build_query(state) [+ critique gaps on loop passes]
│       │    → hybrid_search(query, k_final=10)        rag/hybrid_search.py
│       │         → run_in_executor(_hybrid_search_sync)
│       │              → embed_query → _model()        rag/embeddings.py
│       │              → _dense_search → get_or_create → col.query   rag/store.py
│       │              → _bm25_search → _bm25()  [chunk-id keyed]
│       │              → _rrf → _rerank → _reranker()  [cross-encoder]
│       │    → merge w/ prior retrievals (dedup by chunk id)
│       │    → Citation(...) numbered against the MERGED list  [citation SSE]
│       │
│       ├─ NODE analyze_loss_history                   nodes/analyze_loss_history.py
│       │    → loss_stats(sub)  [None = no loss runs]  tools/loss_calc.py
│       │    → xgb_predict(sub, safer)                 tools/xgb_loss_freq.py
│       │         → _load_model() → _features → booster.predict → explainer (SHAP)
│       │         → or _fallback (source="heuristic_fallback", no fake SHAP)
│       │
│       ├─ NODE find_comparables                       nodes/find_comparables.py
│       │    → comparable_search(sub, safer=…, loss=…) tools/comparable_search.py
│       │         → _book() → _featurize_sub → cosine top-k
│       │
│       ├─ NODE draft_memo                             nodes/draft_memo.py
│       │    → _format_safer/_loss/_retrieved/_xgb/_comps/_history
│       │    → MEMO_TEMPLATE.format(..., critique_feedback=…)
│       │    → gemini().astream → memo_md, draft_iters += 1
│       │      [chat.py: redraft event on a new draft, then whitespace-
│       │       preserving token SSE via split_stream_tokens]
│       │
│       ├─ NODE self_critique                          nodes/self_critique.py
│       │    (disable_critique → pass, judge="disabled")
│       │    → _evidence_summary (includes the VALID citation refs)
│       │    → _resolve_provider → openai_runtime_critique  llm/judge_client.py
│       │         → None → _gemini_critique → gemini_fast()
│       │    → CritiqueVerdict.model_validate(raw)
│       │    → error path: pass=True + critique_error + judge="error:<judge>"
│       │      [critique_judge SSE with passed/error/gaps]
│       │
│       ├─ EDGE after_critique                         graph/edges.py
│       │    "loop" → retrieve_context (gap-augmented; at most once, MAX=2)
│       │    "pass" → finalize
│       │
│       └─ NODE finalize                               nodes/finalize.py
│            → _extract_disposition(```json block```) → _producer_summary → Memo → END
│
│   epilogue: final node_exit → {"event":"final",{memo, run_id}}   (errors → error event)
│   run state persisted in checkpoints.sqlite → GET /traces/{run_id} replays it
│
BROWSER (frontend)
│ for await ev of parseSSE(res.body)                   lib/sse.ts → parseChunk
│   node_enter/exit → AgentTracePanel      tool_call/result → dedupeToolPairs
│   citation → chips + panel               critique_judge → pass/fail/error banner
│   redraft → clear memo text              token → updateLastByAppend
│   final → renderMemo → decorate ([n] → citation chips)
```

Short-circuit: unresolvable DOT → `data_insufficient` → fixed "route to a human underwriter" memo (every SHIPPED submission's DOT is verified resolvable, so this path only fires for ad-hoc input).

No-backend path: `demoStream()` replays the protocol with a leading `demo_notice`; the UI banners it as a recording.
