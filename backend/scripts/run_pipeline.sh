#!/usr/bin/env bash
# ============================================================================
# One-command data pipeline. Run from backend/:
#
#   ./scripts/run_pipeline.sh            # everything (first run: ~30-60 min)
#   ./scripts/run_pipeline.sh --quick    # skip LLM evals + UMAP (still real data)
#   ./scripts/run_pipeline.sh --viz-only # deterministic Part 05 fallback only
#
# Prereqs:
#   - uv sync
#   - ../.env  (copy ../.env.example):
#       FMCSA_WEBKEY    → free key from https://mobile.fmcsa.dot.gov/QCDevsite/
#                         (official carrier API; strongly recommended)
#       OPENAI_API_KEY  → GPT judge for evals + runtime critique
#       GCP_PROJECT_ID  → Vertex AI (Gemini)
#   - gcloud auth application-default login
#
# Every ingestion step VALIDATES content and fails loudly instead of writing
# junk. If a step exits nonzero, fix the reported issue before continuing —
# the later steps assume verified inputs.
#
# Step 01 needs real mid-market DOT numbers in scripts/seed_dot_numbers.json.
# Sources: FMCSA SMS (ai.fmcsa.dot.gov/SMS) lists carriers by size band;
# public truckers publish their USDOT numbers in 10-Ks and on equipment.
# ============================================================================
set -euo pipefail
BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BACKEND_DIR"

QUICK=0
VIZ_ONLY=0
case "${1:-}" in
  "") ;;
  --quick) QUICK=1 ;;
  --viz-only) VIZ_ONLY=1 ;;
  *) echo "unknown option: $1" >&2; exit 2 ;;
esac

run() { echo; echo "▶ $*"; uv run --project "$BACKEND_DIR" python "$@"; }

# Do this before any network/model step. If the full pipeline is interrupted,
# the frontend still has strict JSON for the retrieval animations; script 08
# replaces it with live output when the real index is available.
run scripts/seed_retrieval_viz.py --if-missing
if [[ "$VIZ_ONLY" == "1" ]]; then
  echo "✔ Deterministic Part 05 retrieval fallback is ready."
  exit 0
fi

run scripts/01_download_fmcsa.py          # verify carriers (writes verified_dots.json)
run scripts/02_download_ntsb.py           # real NTSB narratives (content-gated)
run scripts/03_download_10ks.py           # real 10-K risk factors (content-gated)
run scripts/04_build_index.py             # chunk + embed + BM25
run scripts/05_synthesize_subs.py --rewrite   # submissions on VERIFIED carriers
run scripts/06_train_xgb.py               # model + calibration + empirical PI

if [[ "$QUICK" == "1" ]]; then
  run scripts/07_run_evals.py --skip-generation
  run scripts/08_export_viz_data.py --skip-umap --with-fars
else
  run scripts/07_run_evals.py
  run scripts/08_export_viz_data.py --with-fars
fi

# The artifact that answers "show me one real memo": a captured end-to-end
# run (real SAFER, real retrieval, real model, real Gemini, real critique).
run scripts/09_capture_showcase.py --submission SUB-001

echo
echo "✔ Pipeline complete."
echo "  - verified carriers: scripts/verified_dots.json"
echo "  - eval results:      app/eval/results/eval_results.json"
echo "  - viz exports:       data/exports/ (+ mirrored to frontend/public/data/)"
echo "  - showcase run:      docs/showcase/showcase_memo.md"
echo "NOTE: if the corpus changed, relabel app/eval/golden_set/retrieval_questions.json"
echo "      (the retrieval eval refuses to score against stale chunk ids)."
echo "Next: gcloud builds submit --config ../cloudbuild.yaml .. (see DEPLOY.md);"
echo "      build with --build-arg PREFETCH_MODELS=1 and deploy --memory=4Gi now"
echo "      that the dense index is populated."
