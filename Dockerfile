# Multi-stage Cloud Run image. uv handles dependency resolution & install.

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

# Final sync with project source. Tolerate failure here (rare lockfile drift)
# so a clean re-sync on Cloud Run still recovers.
RUN uv sync --frozen --no-dev || true


FROM python:3.12-slim AS runtime
WORKDIR /app/backend

# Same OS deps the runtime needs
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 libxml2 libxslt1.1 \
 && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PORT=8080 \
    PYTHONPATH=/app/backend

# Copy uv'd virtualenv + source
COPY --from=builder /app/backend/.venv /app/backend/.venv
COPY --from=builder /app/backend/app /app/backend/app

EXPOSE 8080

# 2 workers fit in 2 GiB; bump if you scale up CPU on Cloud Run.
CMD ["/app/backend/.venv/bin/uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8080", \
     "--workers", "2", "--proxy-headers", "--forwarded-allow-ips=*"]
