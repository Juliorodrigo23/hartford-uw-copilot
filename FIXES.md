# Fixes: every audit finding, resolved

Companion to `AUDIT.md`. Each finding from the audit, what changed, and where.

---

# Round 2 — hostile-audit fixes (data layer)

The hostile audit (`AUDIT.md`) found the DATA layer was garbage even though the
plumbing was sound. What changed:

**Corpus (AUDIT F3 / Pass 3).** All junk purged from `data/raw/` (nav menus,
1-byte SEC files) along with the index built on it. New ingestion contract:
`app/rag/content_gate.py` gates EVERY document (min length, nav-menu signature,
prose shape, domain keywords, dedupe) — junk is rejected, never written, and
scripts exit nonzero when nothing valid was ingested. Root causes fixed:
`03_download_10ks.py` now takes the LONGEST Item 1A→1B span (the old code
matched the table-of-contents row, which is how "17" became a corpus document);
`02_download_ntsb.py` abandons the JS-rendered investigation pages for the
CAROL API + report PDFs (pypdf). Placeholder-narrative writing is deleted
outright.

**Carriers (AUDIT F1/F2).** The poisoned SAFER cache and the submissions built
on it are purged. `safer_lookup` now prefers FMCSA's official QCMobile JSON API
(`FMCSA_WEBKEY` in .env, free) with the scrape as fallback, and `_is_garbage()`
rejects parser-default profiles (the print-shop shape) instead of caching them.
BASICs come from the API's /basics endpoint instead of the hardcoded `{}`.
`01_download_fmcsa.py` verifies every seed (name assertion + non-UNKNOWN status)
and writes `verified_dots.json`; the invented "mid-market" DOTs are gone from
the seed list. `05_synthesize_subs.py` binds submissions only to verified
mid-market carriers, derives `fleet_size` from the REAL power-unit count (the
86-trucks-on-a-1-truck-entity contradiction is structurally impossible now),
and carries `safer_legal_name` openly while keeping a pseudonym so synthetic
adverse loss runs are never published against a real company's name.

**Showcase (AUDIT verdict #3).** `scripts/09_capture_showcase.py` captures one
REAL end-to-end run (refusing to publish error memos) to
`docs/showcase/showcase_memo.md` + `showcase_run.json`; the site's
ToolCallStream and SelfCritiqueDiff panels now render that real run (real tool
I/O, real drafts, real judge verdicts) instead of their illustrative examples.

**Secondary findings.** Error memos now finalize as `data_insufficient @ 0.0`
instead of the fabricated `quote_with_surcharge @ 0.5` default. The SHAP
explainer is built from the booster at load time (the version-fragile pickle
that silently downgraded the model to a heuristic in a clean venv is gone;
verified: `source: xgboost` with real attributions in the audit venv). The 80%
PI uses EMPIRICAL out-of-fold residual quantiles stored in model_meta
(measured 0.43-1.67, notably wider than the invented 0.72-1.42 — the hardcoded
interval was overconfident). Comparables are z-scored before cosine so scores
rank instead of saturating at 0.999. The retrieval eval refuses to score a
stale golden set (>50% labeled chunk ids missing from the index). Red-flag
matching uses word boundaries instead of gameable substrings.

Verification: 37 backend tests pass in the clean audit venv (including the
TOC-bug regression test, content-gate tests, garbage-profile rejection, and
QCMobile mapping); frontend typechecks clean.

## Critical

**C1 · Docker image shipped no data** → `Dockerfile` now copies `backend/data/{synthesized,chroma,processed,raw/fmcsa,exports}` into the runtime stage; `.dockerignore` no longer excludes them; new `.gcloudignore` prevents gcloud from falling back to `.gitignore` (which would have silently stripped the data from the Cloud Build upload). The Dockerfile documents that the data pipeline must run before the image build; `scripts/run_pipeline.sh` does it in order.

**C2 · Empty RAG index** → cannot be fully fixed from this sandbox (FMCSA/NTSB/SEC/HuggingFace are network-blocked here). Fixed everything around it: `04_build_index.py` is now truly idempotent (`reset_collection` drop-and-recreate instead of the silently-failing `delete(where={})`), the chunk-id contract is consistent end to end, `retrieve_context` logs loudly when the index is empty, the memo prompt forbids fabricating `[n]` citations when no evidence was retrieved, and the self-critique rubric treats a nonexistent citation as a critical gap. Run `./scripts/run_pipeline.sh` locally to build the real index.

**C3 · Fabricated eval results** → the fabricated file is deleted. `07_run_evals.py` has no `--quick` constants anymore: every track emits `status: ok | skipped` with a reason, judge placeholders were removed (`judge_memo` now raises `JudgeUnavailable` instead of returning zeros, `judge_iqr` is computed from actual judge runs), the RAGAs zeros block is gone, and ablations are REAL re-runs of the agent with per-component disable flags (`--ablations`). The dashboard renders pending cards with the exact command for anything skipped.

**C4 · /traces could never hit** → one graph, one checkpointer: `app.main` compiles the graph in the FastAPI lifespan against an `AsyncSqliteSaver` (file-backed, shared by both uvicorn workers and across restarts); `/chat` and `/traces` both use `app.state.graph`. Verified by `tests/test_graph_e2e.py::test_traces_read_what_chat_wrote`.

## High

**H1 · Heuristic dressed as XGBoost** → `XGBPrediction.source` (`"xgboost"` | `"heuristic_fallback"`) plus `model_version`; the fallback produces NO fake SHAP values; the memo prompt explicitly instructs the model to describe a fallback as a heuristic. Also: the model is now actually trained (artifacts committed workflow via script 06), with isotonic calibration and real grouped-CV metrics. Training-data provenance (`synthetic` vs `parquet`) is recorded in `model_meta.json` and shown on the site.

**H2 · Unresolvable DOTs / flagship demo broken** → `05_synthesize_subs.py` verifies every DOT through `safer_lookup` (cache, then live) BEFORE assignment and excludes failures. Regenerated `submissions.json`: all 30 submissions now map to the 13 verified-resolvable DOTs (SUB-001 → DOT 1129835, real SAFER profile). The picker fallback with mismatched fake data is gone.

**H3 · Canned demo indistinguishable from live** → `demoStream` now emits a `demo_notice` SSE event first; the chat page shows a persistent "Recorded replay" banner; the replay memo itself says it is not a live run; synthetic tool outputs are labeled `(SYNTHETIC)`.

**H4 · Critique fails open silently** → still fails open (a judge outage should not kill the run) but never silently: `critique_error` lands in state, `critique_judge` becomes `error:<judge>`, the SSE `critique_judge` event carries `passed/error/gaps`, and the trace panel shows "this memo was NOT quality-checked". Malformed judge JSON is now a visible error too (parsed through `CritiqueVerdict`).

**H5 · Judge placeholders as scores** → removed everywhere (see C3).

## Medium

**M1 · Hardcoded visualization fiction** → wired to real exports: `XGBSHAP`, `CalibrationCurve`, `ConfusionMatrixOverTime` (from `model_insights.json`: real SHAP, real out-of-fold calibration bins, real per-version confusion matrices on the adverse-frequency target), `HybridSearchBars` + `RagRetrievalRays` (from `retrieval_example.json`: real per-stage rankings via `hybrid_search.search_stages`), `FreqSeverityHeatmap` (from `loss_landscape.json`), `DataSourceMap` (from `fars_state_metrics.json`: real NHTSA FARS counts), `ChunkingStrip` (real chunker output when exported). The remaining concept pieces (`AttentionHeatmap`, `SelfCritiqueDiff`, `ToolCallStream`, `LangGraphMachine` playback) carry explicit `illustrative` badges explaining exactly what is and isn't real. Every data-backed visual shows `live pipeline data` or an explicit `pending` card with the generating command.

**M2 · Never-generated data files** → `export_fars_state_metrics` implemented (real NHTSA CrashAPI, with a minimum-coverage guard); `embeddings_umap` export unchanged but the component now shows a pending badge instead of silently rendering synthetic points.

**M3 · Snippets didn't match the code** → `snippets.ts` replaced with verbatim excerpts of the current backend files.

**M4 · Backend silent exception swallowing** → `submissions.py` logs every dropped record at ERROR; `store.get_or_create` only treats the library's not-found signal as "create", everything else propagates; `04_build_index` uses `reset_collection`; `_dense_search` logs collection failures at ERROR and skips empty collections explicitly.

**M5 · Frontend `.catch(() => {})` + fake fallbacks** → replaced by the `useData` hook with a three-state contract (`loading | live | missing`) and pending cards. No component substitutes invented numbers for missing data.

**M6 · BM25/golden doc-id mismatch** → single chunk-id space (`<doc>#chunk-<i>`) across BM25, dense, RRF, and the golden set; documented as an identity contract in `hybrid_search.py` and `04_build_index.py`; RRF dedup covered by a test.

**M7 · Critique-loop token restream garbage** → `draft_iters` in state; the SSE layer emits a `redraft` event and re-streams cleanly; tokens are whitespace-preserving (`split_stream_tokens`, round-trip tested). The chat UI clears the memo on `redraft`.

**M8 · Phantom security/ops features** → real per-IP sliding-window rate limiter on `POST /chat` driven by `RATE_LIMIT_PER_MIN`, returning 429 + `retry-after` and setting `x-hartford-ratelimit-remaining` on responses (the proxy forwards it). CORS Vercel wildcard moved to `allow_origin_regex`. The Vercel route's limiter documents its per-instance nature.

**M9 · Zero-filled LossStats** → `loss_stats` returns `None` for an empty loss run; the memo prompt instructs the model to treat loss history as UNKNOWN. The premium assumption is a schema field (`assumed_premium_per_pu_usd`) and the prompt requires disclosing it when the loss ratio is cited. Bonus fix: the 3-year loss ratio now uses the last 3 years of incurred (it previously divided 5 years of losses by 3 years of premium).

**M10 · Endpoints without a working consumer** → `/data/{name}` serves `backend/data/exports/` (ships in the image; name-sanitized), `/traces` works (C4), `/eval` unchanged and functional. The frontend still prefers static files; the backend endpoints are the deployed-data source of truth.

## Low

**L1 · Loop edge dead in practice** → the loop is now traversable and tested (`test_critique_loop_redrafts_and_increments`); judge failures are visible (H4); redrafts actually incorporate critique gaps (the memo prompt gets a `CRITIQUE FEEDBACK` section and retrieval broadens with the gap text).

**L2 · Dead code** → removed: `rag/rerank.py`, `safer_lookup_sync`, `_after`, `store.list_collections`, unused `fetchJson`/`snippetPath`/`Submission` type in `lib/api.ts`. Wired in: `fars_query` (used by script 08), `maybe_enable_langfuse` (called in the app lifespan), `CritiqueVerdict` (validates judge output), `CorpusKind` (collection names), `ChatRequest.history` (chat page sends the last 6 turns; `draft_memo` includes them in the prompt).

**L3 · Leftovers** → stale `checkpoints.sqlite` deleted (the path is now the real checkpoint DB, recreated at startup); unused deps removed from `pyproject.toml` (`ragas`, `datasets`, `langchain-community`, `google-cloud-secret-manager`); `xgboost` pinned `<3` (shap incompatibility, discovered by actually training).

**L4 · Docstring lies** → `VehicleMix` auto-normalizes via a real `model_validator`; isotonic calibration is implemented, not just promised; script 08's docstring matches its outputs; `ALLOW_UNSIGNED_DEV` default documented in `.env.example` with a MUST-be-false note for prod (cloudbuild sets it).

## Verification

- `backend: pytest` → 27 passed (graph e2e with faked LLMs over real cached SAFER data, checkpointer/traces contract, ablation flags, fail-open-flagged critique, token round-trip, tool contracts).
- `frontend: tsc --noEmit` → clean.
- Trained model artifacts + regenerated `submissions.json`, `submissions_index.json`, `model_insights.json`, `loss_landscape.json`, `monte_carlo.json`, honest `eval_results.json` produced in-session.

## What still needs YOUR machine (network + credentials)

1. `cp .env.example .env`, paste `OPENAI_API_KEY`, set `GCP_PROJECT_ID`, `gcloud auth application-default login`.
2. `cd backend && ./scripts/run_pipeline.sh` — downloads FMCSA/NTSB/SEC, builds the real index, re-verifies DOTs (add more real DOT numbers to `scripts/seed_dot_numbers.json` to get 30 unique carriers), runs the full evals + ablations, exports everything including UMAP and FARS.
3. `gcloud builds submit --config cloudbuild.yaml .` then set `BACKEND_URL`/`HMAC_SECRET` in Vercel.
