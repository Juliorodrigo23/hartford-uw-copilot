#!/usr/bin/env bash
# ============================================================================
# Run any backend script inside the production Docker image (Linux).
#
# Why this exists: the eval harness segfaults on macOS arm64 due to a native
# library conflict (torch + onnxruntime + google clients in one process).
# That conflict does not exist on Linux — which is also exactly what Cloud
# Run executes, so evals run here are measured in the production environment.
#
#   ./scripts/run_in_docker.sh scripts/07_run_evals.py --ablations
#   ./scripts/run_in_docker.sh scripts/08_export_viz_data.py --with-fars
#   ./scripts/run_in_docker.sh scripts/09_capture_showcase.py --submission SUB-001
#
# The repo is volume-mounted, so results land straight back on your disk.
# Vertex auth comes from your gcloud ADC (mounted read-only); secrets from
# the repo-root .env (read by app.config inside the container).
# ============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="uw-copilot-backend:local"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <script-path-relative-to-backend/> [args...]" >&2
  exit 1
fi

# Build (cached after the first run). Data must exist; the Dockerfile copies it.
docker build -t "$IMAGE" -f "$REPO/Dockerfile" "$REPO"

ADC="$HOME/.config/gcloud/application_default_credentials.json"
ADC_ARGS=()
if [[ -f "$ADC" ]]; then
  ADC_ARGS=(-v "$HOME/.config/gcloud:/gcloud:ro" \
            -e GOOGLE_APPLICATION_CREDENTIALS=/gcloud/application_default_credentials.json)
else
  echo "WARN: no gcloud ADC at $ADC — Vertex calls will fail (run: gcloud auth application-default login)" >&2
fi

# Mount the live repo over /repo and run with the image's venv. PYTHONPATH
# points at the mounted source so your latest code runs against the image's
# dependencies; app.config resolves data paths + .env from the mount.
exec docker run --rm -it \
  -v "$REPO:/repo" \
  "${ADC_ARGS[@]}" \
  -e HF_HOME=/repo/backend/.hf-cache-linux \
  -e TOKENIZERS_PARALLELISM=false \
  -e PYTHONPATH=/repo/backend \
  -w /repo/backend \
  --entrypoint /app/backend/.venv/bin/python \
  "$IMAGE" "$@"
