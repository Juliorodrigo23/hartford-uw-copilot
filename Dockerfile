# Multi-stage Cloud Run image. uv handles dependency resolution & install.
#
# IMPORTANT: the runtime stage ships the DATA the agent needs — synthesized
# submissions, the Chroma index, the BM25 corpus, the SAFER cache, model
# artifacts, and viz exports. Build the data pipeline (scripts 01-08) BEFORE
# building this image; scripts/run_pipeline.sh does it in order.

FROM python:3.12-slim AS builder
WORKDIR /app

# uv (zero-config, fast). Pin a recent release tag — older 0.4.x tags
# get GC'd over time on GHCR.
COPY --from=ghcr.io/astral-sh/uv:0.5.5 /uv /uvx /bin/

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never

# OS deps for sentence-transformers / xgboost / lxml
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libxml2-dev libxslt1-dev libgomp1 \
 && rm -rf /var/lib/apt/lists/*

# Sync deps first (cached layer); then copy source.
COPY backend/pyproject.toml /app/backend/
COPY backend/uv.lock /app/backend/
WORKDIR /app/backend
RUN uv sync --frozen --no-dev --no-install-project \
 || uv sync --no-dev --no-install-project

COPY backend/app /app/backend/app
COPY backend/scripts /app/backend/scripts

RUN uv sync --frozen --no-dev || uv sync --no-dev

# Optionally bake the retrieval models into the image so the first query
# never downloads ~1.4GB from HuggingFace at request time. Build with
#   --build-arg PREFETCH_MODELS=1
# once you ship a POPULATED index (scripts 02-04), and deploy Cloud Run with
# --memory=4Gi. With an empty index the backend skips dense retrieval
# entirely, so the default keeps the image small.
ARG PREFETCH_MODELS=0
ENV HF_HOME=/app/hf-cache
RUN if [ "$PREFETCH_MODELS" = "1" ]; then \
      /app/backend/.venv/bin/python -c "\
from sentence_transformers import SentenceTransformer, CrossEncoder; \
SentenceTransformer('BAAI/bge-large-en-v1.5'); \
CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')"; \
    else mkdir -p /app/hf-cache; fi


FROM python:3.12-slim AS runtime
WORKDIR /app/backend

# Same OS deps the runtime needs
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 libxml2 libxslt1.1 \
 && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PORT=8080 \
    PYTHONPATH=/app/backend \
    HF_HOME=/app/hf-cache

# uv'd virtualenv + source (app/ includes ml artifacts + eval golden set/results)
COPY --from=builder /app/backend/.venv /app/backend/.venv
COPY --from=builder /app/backend/app /app/backend/app
COPY --from=builder /app/hf-cache /app/hf-cache

# Runtime data. Without these the agent silently degrades to fallbacks:
#   synthesized/  → submissions + book of business (picker, comparables)
#   chroma/       → dense index      processed/ → BM25 corpus
#   raw/fmcsa/    → SAFER snapshot cache (offline reproducibility)
#   exports/      → viz JSON served by GET /data/{name}
COPY backend/data/synthesized /app/backend/data/synthesized
COPY backend/data/chroma      /app/backend/data/chroma
COPY backend/data/processed   /app/backend/data/processed
COPY backend/data/raw/fmcsa   /app/backend/data/raw/fmcsa
COPY backend/data/exports     /app/backend/data/exports

EXPOSE 8080

# ONE worker: the app is fully async (concurrency comes from asyncio +
# Cloud Run instance scaling), and a second worker would load a second
# ~1.3GB copy of the embedding model into the same container.
CMD ["/app/backend/.venv/bin/uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8080", \
     "--workers", "1", "--proxy-headers", "--forwarded-allow-ips=*"]
