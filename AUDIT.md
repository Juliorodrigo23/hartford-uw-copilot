# HOSTILE AUDIT — uw-copilot repo

Auditor stance: assume broken until proven otherwise. No code was modified.
Environment caveat, disclosed up front: the audit sandbox has Python 3.10 (repo
targets ≥3.12), no GCP/OpenAI credentials, and no network route to Vertex,
HuggingFace, FMCSA, or NHTSA. Everything that could be executed was executed;
LLM-dependent paths were run to their exact failure points and reported as
observed. The data audited under `backend/data/` is the repo owner's actual
pipeline output from their machine.

---

## PASS 1 — Does it actually run?

**Setup:** clean venv (`python3 -m venv /tmp/audit_venv`), dependencies installed
from PyPI in the audit env (fastapi, uvicorn, sse-starlette, pydantic(+settings),
httpx, langgraph(+sqlite ckpt), langchain-core, langchain-google-vertexai,
chromadb, rank-bm25, numpy, pandas, xgboost<3, scikit-learn, shap, bs4, lxml,
tenacity, openai, pytest). Version friction noted: `pyproject.toml` requires
Python ≥3.12; audit env is 3.10. Code imported and ran regardless.

**Command:**
```
ALLOW_UNSIGNED_DEV=true PYTHONPATH=. /tmp/audit_venv/bin/uvicorn app.main:app --port 8124
curl -N -X POST http://127.0.0.1:8124/chat -H "content-type: application/json" \
  -d '{"message":"Triage this submission.","submission_id":"SUB-001","history":[]}'
```

**Result: the system runs end to end mechanically.** Full SSE stream received:
8 node_enter/exit pairs, 4 tool_call/result pairs, 8 citations, 1 critique_judge,
23 tokens, 1 final. Exact tool outputs observed:

```
safer_lookup  → {"legal_name": "RUSS PRINT SHOP THE HEBRON ADVERTISER INC",
                 "operating_status": "UNKNOWN", "power_units": 1, "drivers": 2, ...}
loss_calc     → {"frequency_per_pu_per_yr": 0.0349, "severity_avg_usd": "88495.8",
                 "loss_ratio_3yr": 0.586, "assumed_premium_per_pu_usd": 5500, "n_years": 5}
xgb_loss_freq → {"pred_claims_next_yr": 3.44, "pi_80": [2.4, 4.8], "shap_top": [],
                 "source": "heuristic_fallback", "model_version": null}
final memo    → "## Underwriting memo\n\nError generating memo: Your default
                 credentials were not found..." (DefaultCredentialsError from Vertex)
critique      → {"judge": "error:gemini-2.5-flash", "passed": true,
                 "error": "critique judge failed ... default credentials were not found"}
```

**Verdict for this pass:** it runs; it does not hide failure. The memo LLM call
requires GCP ADC which this environment lacks; the error is surfaced in the
stream, and the critique gate records that it could not review. Two genuine
problems surfaced during the run (detailed in Passes 2/5): the SAFER data is
garbage for the demo carriers, and the trained model failed to load in a clean
environment and silently degraded to the labeled heuristic.

`pytest`: **27 passed** in the clean venv.

---

## PASS 2 — What is fake?

Ranked by embarrassment if a reviewer finds it.

**F1 (SEVERE) — The "real carrier" story is false in substance.**
`backend/data/synthesized/submissions.json` binds every submission to a DOT that
resolves in SAFER, but the resolved entities are not mid-market trucking fleets.
Verbatim from the shipped cache (`data/raw/fmcsa/safer_cache/*.json`):

```
1129835  RUSS PRINT SHOP THE HEBRON ADVERTISER INC   UNKNOWN  1 PU
2017304  SWIFT'S LANDSCAPING LLC                     UNKNOWN  4 PUs
991122   COMCAST CABLE COMMUNICATIONS MANAGEMENT LLC UNKNOWN  393 PUs
2455910  LUIS A GONZALEZ FLORES                      UNKNOWN  1 PU
264184   SCHNEIDER NATIONAL CARRIERS INC             UNKNOWN  9 PUs   ← Schneider runs >10,000
```

SUB-001 claims `fleet_size: 86` while its own embedded SAFER snapshot says
`power_units: 1`. The agent feeds BOTH numbers to the LLM in one prompt. A
reviewer who types any of these DOTs into SAFER's website sees a print shop.

**F2 (SEVERE) — The SAFER parser silently returns defaults for every field.**
Every cached profile has `operating_status: "UNKNOWN"` (the parser's fallback,
`app/tools/safer_lookup.py:60`), zero crashes, zero OOS rates, and Schneider at
9 power units. Either the SAFER page layout changed or these DOTs return a
different page shape; either way the parser extracts near-nothing and labels
none of it as a parse failure. Worse: `basic_violations={}` is HARDCODED at
`app/tools/safer_lookup.py:82` — BASIC scores are never parsed at all, yet the
site copy and prompts talk about "BASIC violations" as an input.

**F3 (HIGH) — Ingestion writes garbage with success metadata.**
`scripts/03_download_10ks.py:88-89`: when the Item 1A regex misses, the fallback
takes `text[:60_000]` of whatever the page was; there is no minimum-content
check. Actual result on disk: all 35 SEC files are 1-19 bytes ("7", "17", a
zero-width space), each with a meta JSON containing a real EDGAR URL and no
failure flag. `scripts/02_download_ntsb.py` likewise saved the NTSB site's
navigation menu as four "investigation narratives" (byte-identical MD5
`4464475e...` for 4 of 5 files). The explicit `"fallback": true` marker
(02:117, 03:121) only fires on HTTP failure, not on content failure, so this
garbage is recorded as success.

**F4 (MEDIUM) — Labeled illustrative frontend panels.**
`AttentionHeatmap.tsx` (Math-generated attribution matrix), `SelfCritiqueDiff.tsx`,
`ToolCallStream.tsx`, `LangGraphMachine.tsx` timings, and the `demoStream()` in
`app/api/chat/route.ts` are hardcoded. All carry visible "illustrative" badges or
a demo-replay banner in the UI, so they are disclosed rather than fake, but a
reviewer will note that 4 of the walkthrough's visuals are staged.

**F5 (MEDIUM) — Constants presented with more authority than they earn.**
- `app/tools/xgb_loss_freq.py:117`: the "80% PI" is `yhat*0.72 … yhat*1.42`, a
  hardcoded multiplier pair, not a fitted interval.
- `app/tools/xgb_loss_freq.py:85-91`: the fallback predictor is
  `0.04 × fleet × bump` with hand-picked bump factors (it IS labeled
  `heuristic_fallback` end to end, which saves it from severe).
- `app/tools/loss_calc.py:12`: the loss ratio assumes $5,500/PU premium (this is
  disclosed in the schema and the memo prompt).

**F6 (LOW) — Swallowed exceptions that degrade silently but log.**
Grep-verified surviving cases: `xgb_loss_freq._load_model` catches everything and
returns the fallback tuple (logged ERROR, and predictions are labeled);
`hybrid_search._hybrid_search_sync` catches embedding failure → BM25-only
(logged); `store.get_or_create` re-raises non-not-found errors (fixed earlier);
frontend `useData` maps any fetch failure to an explicit "pending" state. No
case found where an exception produces fabricated data; several produce reduced
capability with a log line.

**F7 (LOW) — Unreachable-in-practice paths.**
LangGraph edges: all reachable; the critique loop's `"loop"` edge is exercised by
`tests/test_graph_e2e.py::test_critique_loop_redrafts_and_increments`. Config
flags that disable components: `disable_rag/critique/comparables/xgb` exist in
state for the ablation harness (documented); `_dense_index_ready()` silently
skips dense retrieval when the index is empty (logged WARNING; by design, but it
is a config-like silent disable a reviewer should know about).

---

## PASS 3 — Is the RAG real?

**Mechanically real, substantively garbage.**

Inventory (measured directly from the repo owner's built artifacts):
- Raw documents: 5 NTSB txt + 35 SEC txt (+ meta JSONs).
- Chunks: **49** in `data/processed/bm25_corpus.json`, same 49 ids in Chroma.
- Chunk strategy: semantic chunker (cosine-distance breakpoints, target ≈220
  tokens, overlap 30) with recursive fallback; observed NTSB chunks ~1,400 chars.
- Embeddings: Chroma reports **dimension 1024** (consistent with
  BAAI/bge-large-en-v1.5), 49 vectors, persisted at `backend/data/chroma/`
  (loaded on startup, rebuilt only by `scripts/04_build_index.py`, which
  drop-recreates collections).
- Corpus content: **4 of 5 NTSB docs are the same scraped navigation menu**;
  **all 35 SEC docs are 1-19 bytes of junk**. Exactly ONE document
  (`ntsb-2024-01`, the Etna, Ohio I-70 investigation) contains real narrative.

Three queries through the actual retrieval code (`_hybrid_search_sync`, BM25 path;
dense query-encoding unavailable in the audit env because sentence-transformers is
not installed here — the stored vectors themselves were inspected directly). Raw
output, verbatim:

```
QUERY: driver fatigue hours of service violations long-haul fleet
  [ntsb-2024-01#chunk-1] source=ntsb score=0.0164
  TEXT: 'truck-tractor in combination with a 2017 Strickland semitrailer (Freightliner
  combination vehicle), operated by Mid-State Systems Inc., was traveling west in the
  right lane of Interstate 70 (I-70) near Etna, Ohio. Near milepost 118.8, ...'
  [ntsb-2024-01#chunk-3] score=0.0161  TEXT: 'queue development, and lanes affected; ...'
  [ntsb-2024-01#chunk-2] score=0.0159  TEXT: 'driver's inattention and failure to respond...'
  [ntsb-2024-01#chunk-4] score=0.0156  TEXT: 'Union of America: Inform your members about the Etna, Ohio, crash...'
  [ntsb-2024-01#chunk-0] score=0.0154  TEXT: 'Investigations\nInvestigation Process\n...'  ← NAV MENU

QUERY: brake failure jackknife interstate crash
  [ntsb-2024-01#chunk-1] score=0.0164  (same Etna chunk)
  [ntsb-2024-01#chunk-0] score=0.0161  ← NAV MENU ranked #2
  ... (same five chunks, reshuffled)

QUERY: insurance market hardening nuclear verdicts risk factors
  [ntsb-2024-01#chunk-2] score=0.0164  (same Etna chunks again — there is nothing
  else in the corpus with real text; the 10-K chunks are single characters)
```

Two damning observations. First, **every query returns the same document**
because the corpus effectively contains one document. Second, the reported
"scores" (~0.0164, 0.0161, 0.0159...) are Reciprocal Rank Fusion constants
(1/(60+rank)), not similarities — with one ranker and a five-chunk pool, the
scores are position artifacts and nearly identical across unrelated queries. A
reviewer who asks "show me the retrieval for a hazmat question" gets an Ohio
traffic-queue crash with a straight face.

The retrieval golden set (`app/eval/golden_set/retrieval_questions.json`) labels
chunks like `ntsb-2019-04#chunk-0` as relevant for fatigue queries; that chunk is
now a navigation menu. The golden set is stale against the built index.

---

## PASS 4 — Is the agent real?

Yes — the graph is real and was traced live. Full state deltas per node
(truncated at 220 chars per field; full dump in the audit transcript):

```
NODE parse_submission → {"submission": {"id":"SUB-001","carrier_name":"ABC Transport Inc",
  "dot_number":"1129835","fleet_size":86,...}, "parse_notes":["loaded submission SUB-001 from disk"]}
NODE enrich_carrier   → {"safer_profile": {"legal_name":"RUSS PRINT SHOP...","power_units":1,...},
  "tool_calls":[safer_lookup], "data_insufficient_reason": null}
NODE retrieve_context → {"retrieved": list[8 chunks], "citations": list[8]}
NODE analyze_loss_history → {"loss_stats": {freq 0.0349, sev 88495.8, LR 0.586, n_years 5},
  "xgb_pred": {"pred_claims_next_yr": 3.44, "pi_80":[2.4,4.8], "source":"heuristic_fallback"},
  "tool_calls": [loss_calc, xgb_loss_freq]}
NODE find_comparables → {"comparables": top-5 from book, best score 0.9994}
NODE draft_memo       → memo_md = "Error generating memo: DefaultCredentialsError..." (draft_iters: 1)
NODE self_critique    → {"critique_pass": true, "critique_judge": "error:gemini-2.5-flash",
  "critique_error": "...default credentials were not found..."}
NODE finalize         → {"memo": Memo(disposition=quote_with_surcharge conf 0.5 — the
  regex fallback, since the error memo has no JSON block)}
```

- **XGBoost tool payload/return:** input features derived from SUB-001 + the
  SAFER profile; returned 3.44 claims (80% "PI" 2.4-4.8), `source:
  heuristic_fallback` because the SHAP explainer pickle failed to load in this
  environment (see Pass 5).
- **Does the value reach the final output?** In this credential-less run: NO —
  the memo is an error string, so the tool result is computed and then unused.
  The prompt template (`app/llm/prompts/memo.py`, LOSS-FREQUENCY PREDICTION
  section) does inject it verbatim when generation works, and the SSE trace
  shows it to the user regardless. But this audit cannot confirm the LLM quotes
  it, and neither can the repo owner until a credentialed end-to-end memo is
  captured and published.
- **Self-critique loop:** routing allows at most 2 critique passes
  (`app/graph/edges.py`, MAX_CRITIQUE_ITERS=2); the loop genuinely re-enters
  retrieval and re-drafts (proven by `test_critique_loop_redrafts_and_increments`,
  which asserts draft_iters==2). In THIS run it terminated after one pass — not
  because it always does, but because the judge itself errored and the gate
  fails open with a recorded `critique_error`. Honest, but it means: with no
  OpenAI key and no Vertex, the QA gate is decorative.
- Disposition fallback: with no ```json block in the memo, `finalize` emits
  `quote_with_surcharge @ 0.5` — a default disposition on an error memo. It is
  visible as such, but a stricter design would emit `data_insufficient` here.

---

## PASS 5 — Is the model real?

A model exists and was actually trained — but read the fine print.

- **Artifacts:** `xgb_loss_freq.json` (booster), `shap_explainer.pkl`,
  `isotonic_calibrator.pkl`, `model_meta.json` (version `v3-isotonic-2026-07-10`).
- **Training data: SYNTHETIC.** `model_meta.json` says `"training_data":
  "synthetic"`, 4,000 rows generated in `app/ml/train_xgb.py::_load_training_frame`
  with a hand-written latent-risk formula. This is disclosed in code, metadata,
  and on the site. It is still a model trained on data the author invented:
  public sources provide features but no per-carrier claim outcomes, so no real
  target exists anywhere in this repo.
- **Features (10):** fleet_size_log, oos_vehicle, oos_driver, crashes_24mo_total,
  crashes_24mo_fatal, tractor_share, n_states, is_general_freight, is_hazmat,
  is_tank. All available at inference in a real workflow (SAFER + application),
  BUT: given Pass 2/F2, the OOS and crash features are all ZERO in every cached
  profile, so at inference the model effectively sees fleet size and commodity
  only.
- **Split:** 5-fold GroupKFold by carrier_id; reported metrics are out-of-fold
  (v1 AUC 0.977, v2 0.9794, v3 0.9807; Brier 0.020→0.018 with isotonic).
- **Leakage flags (real ones):**
  1. The synthetic target's latent formula is a function of the features
     (crashes_24mo_total, oos rates, fleet size). The model is rediscovering the
     author's own generating equation; the 0.98 AUC measures curve-fitting to a
     known formula, not underwriting skill. Anyone quoting these numbers as
     model quality should be stopped.
  2. The "adverse frequency" label threshold is `k = ceil(0.05 × fleet_size)`
     while fleet_size_log is a feature and fleet size drives the synthetic rate;
     v1 (fleet-only) scoring AUC 0.977 is the tell that target structure, not
     signal, dominates.
- **Portability failure (observed live):** in the clean venv the SHAP explainer
  pickle failed to unpickle (`TypeError: code expected at most 16 arguments, got
  18` — a numba-serialized code object from a different Python version), so
  `_load_model` returned None and the run silently used the labeled heuristic
  DESPITE trained weights sitting on disk. The same booster loads fine; the
  pickle is the fragile part. In the Docker image (pinned 3.12 + uv.lock) it
  should match, but nothing verifies this at build time.

**Weights are not random and not absent — but the headline metrics describe a
synthetic exercise, and the deployed inference path can quietly lose SHAP + the
booster to a pickle-compat failure.**

---

## PASS 6 — Is the eval harness real?

The code is real and runs; the results are currently **empty**.

- `app/eval/results/eval_results.json` (also the copy the dashboard serves):
  generated 2026-07-09, ALL FOUR tracks `status: "skipped"`. Retrieval's reason:
  "index returned no chunks for any query" — the file predates the index build
  on 2026-07-10 and was never regenerated. The live site's eval dashboard
  therefore shows four pending cards and zero evidence of quality.
- What it measures when run: Track 1 recall@5/10, MRR, nDCG@10 against
  `retrieval_questions.json` (10 questions, hand-labeled chunk ids — ground truth
  the author owns, BUT stale against the rebuilt index per Pass 3). Track 2
  GPT-judged rubric + pairwise winrate vs a no-tools baseline. Track 3 red-flag
  recall / forbidden-claim counts against 5 hand-written ground-truth cases
  (author-owned ground truth; matching is case-insensitive SUBSTRING — "OOS"
  matching anywhere in the memo counts as a caught red flag, which is gameable
  and generous). Ablations re-run the real agent with per-component disable flags.
- **Same-model grading:** Track 2's judge is GPT (cross-family from the Gemini
  generator) — good. The RUNTIME critique, however, falls back to
  Gemini-Flash-judging-Gemini whenever no OpenAI key is configured
  (`self_critique._resolve_provider`), i.e. same-family self-grading is the
  silent default in any deployment without the key. Flag.
- **Computed but never reported:** Track 3's `per_submission` breakdown and
  `failures` lists are written to the results file but rendered nowhere in the
  dashboard; fold-level CV metrics for the model are exported but only the mean
  AUC is shown.

---

## PASS 7 — Would a reviewer find this credible?

README claims, checked against evidence:

| Claim | Verdict |
|---|---|
| "Real LangGraph agent on Vertex AI / Gemini" | VERIFIED (graph traced live; Vertex wiring real; generation itself unverified in audit env for lack of credentials) |
| "RAG over real public data (FMCSA SAFER, NTSB, SEC 10-Ks)" | **FALSE as shipped** — pipeline is real, but the actual corpus is 1 real NTSB doc + nav menus + 1-byte SEC stubs, and SAFER profiles parse to defaults |
| "hybrid RAG (BM25 + bge dense + RRF + cross-encoder, one chunk-id space)" | VERIFIED mechanically (49 vectors @1024-dim, BM25 corpus, fusion + rerank code exercised) |
| "XGBoost loss-frequency with isotonic calibration + SHAP, grouped CV" | VERIFIED as code + artifacts; metrics describe SYNTHETIC data (disclosed) and the explainer pickle is environment-fragile |
| "durable SQLite checkpointer so /traces replays real runs" | VERIFIED (state snapshot retrieved for the audit run's thread id) |
| "three-track eval harness with real component ablations" | UNVERIFIED — harness code is real and tested, but every track in the shipped results file is `skipped`; no real eval number exists anywhere |
| "every submission's DOT verified to resolve in SAFER" | TECHNICALLY TRUE, SUBSTANTIVELY MISLEADING — they resolve to print shops, individuals, and Comcast, with parser-default fields |
| "Everything on the site is real pipeline output or explicitly labeled" | LARGELY VERIFIED — badges/pending states exist and work; but "live pipeline data" badges will proudly display metrics derived from the garbage corpus once evals are re-run without fixing ingestion |
| "27 tests" | VERIFIED (27 passed in a clean venv) |

**Five questions a skeptical senior engineer asks that this repo cannot answer today:**
1. "Show me one real memo, generated end to end on the deployed system, that
   cites a retrieved chunk and quotes the model's prediction." (None exists in
   the repo; the audit env cannot produce one.)
2. "Pull up DOT 1129835 on SAFER's website next to your SUB-001 card. Explain
   the print shop." (No answer.)
3. "Open any 10-K file in your corpus." (They are one character long.)
4. "What's your red-flag recall?" (Every eval track says `skipped`.)
5. "Why does a fleet-size-only model get 0.977 AUC, and what would these
   features do on real loss outcomes?" (Because the target is a function of the
   features by construction; unanswerable for real data.)

---

## VERDICT

**No — do not send this to a hiring manager yet.**

The architecture, honesty mechanisms, tests, and plumbing are genuinely solid,
and the system runs end to end. But the DATA layer — the exact thing the README
stakes its credibility on ("real public data, not toy fixtures") — is currently
garbage all the way down, and a reviewer will find it in under five minutes by
opening one corpus file or one SAFER link.

Three things that must be fixed first, in order:

1. **The corpus.** NTSB pages are JS-rendered (you scraped their nav menu) and
   the SEC extractor wrote 1-byte files with success metadata. Re-ingest from
   sources that actually serve text (NTSB report PDFs / CAROL API; EDGAR full
   10-K documents with a minimum-length validation gate that refuses to index
   junk), rebuild the index, regenerate the golden set against it, then re-run
   the evals so the dashboard shows real numbers.
2. **The carriers.** Replace the seed DOT list with verified mid-market trucking
   fleets (SAFER exposes real ones; the publicly traded carriers' DOTs are
   published) and fix the SAFER parser, which currently returns
   `UNKNOWN`/zeros/hardcoded-empty BASICs for every profile. A submission's
   fleet_size should reconcile with its SAFER power_units, not contradict it 86:1.
3. **One verified end-to-end artifact.** Run the deployed system with real
   credentials on one submission; publish the resulting memo, its trace, and its
   citations in the repo (and confirm the model artifacts load inside the actual
   container, given the pickle fragility observed here). Until a single real
   memo exists, every claim about generation quality is faith.
