"""FastAPI entrypoint."""

from __future__ import annotations

import logging
import time
from collections import deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.compat import apply_platform_workarounds

apply_platform_workarounds()  # before torch/onnx load lazily at first request

from app.config import settings  # noqa: E402
from app.graph.builder import build_graph
from app.observability.tracing import maybe_enable_langfuse


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")
log = logging.getLogger("uw-copilot")


# ---------------------------------------------------------------------------
# Rate limiting — sliding window per client IP, applied to POST /chat.
# In-memory per container instance; the Vercel proxy applies its own hourly
# limit upstream. For multi-instance global limits swap in Redis; for a
# single-service demo this is the honest, dependency-free choice.
# ---------------------------------------------------------------------------
_WINDOW_S = 60.0
_buckets: dict[str, deque[float]] = {}


def _rate_check(ip: str) -> tuple[bool, int]:
    now = time.monotonic()
    q = _buckets.setdefault(ip, deque())
    while q and now - q[0] > _WINDOW_S:
        q.popleft()
    limit = settings.rate_limit_per_min
    if len(q) >= limit:
        return False, 0
    q.append(now)
    return True, limit - len(q)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Compile the agent graph ONCE against a durable SQLite checkpointer.

    /chat and /traces share this graph, so a run_id streamed by /chat is
    replayable from /traces — across workers and across restarts, because
    the checkpoints live in a file, not in process memory.
    """
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

    settings.data_dir.mkdir(parents=True, exist_ok=True)
    async with AsyncSqliteSaver.from_conn_string(str(settings.checkpoint_db)) as saver:
        app.state.graph = build_graph(saver)
        maybe_enable_langfuse()
        log.info(
            "App ready · project=%s region=%s model=%s checkpoints=%s",
            settings.gcp_project_id, settings.gcp_location,
            settings.vertex_model, settings.checkpoint_db,
        )
        yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="Commercial Auto Underwriting Copilot",
        version="0.2.0",
        description=(
            "Backend for the Hartford UW copilot demo. Real LangGraph agent on "
            "Vertex AI / Gemini, hybrid RAG over public FMCSA / NTSB / SEC data."
        ),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_origin_regex=settings.allowed_origin_regex,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["x-hartford-ratelimit-remaining"],
    )

    @app.middleware("http")
    async def rate_limit_chat(request: Request, call_next):
        if request.url.path == "/chat" and request.method == "POST":
            ip = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip() or (
                request.client.host if request.client else "anon"
            )
            allowed, remaining = _rate_check(ip)
            if not allowed:
                return JSONResponse(
                    {"detail": "rate limit exceeded"},
                    status_code=429,
                    headers={"retry-after": "60", "x-hartford-ratelimit-remaining": "0"},
                )
            response = await call_next(request)
            response.headers["x-hartford-ratelimit-remaining"] = str(remaining)
            return response
        return await call_next(request)

    # Routers import the graph via request.app.state — import late to keep
    # module import cheap.
    from app.api.chat import router as chat_router
    from app.api.data import router as data_router
    from app.api.eval import router as eval_router
    from app.api.traces import router as traces_router

    app.include_router(chat_router)
    app.include_router(traces_router)
    app.include_router(eval_router)
    app.include_router(data_router)

    # Note: /healthz is reserved by GCP infra layers (returns GFE 404 from the public URL).
    # Use /health for external health checks instead.
    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": "0.2.0"}

    @app.get("/")
    def root() -> dict[str, str]:
        return {
            "service": "uw-copilot",
            "endpoints": "/chat (POST), /traces/{run_id} (GET), /eval (GET), /data/{name} (GET)",
        }

    return app


app = create_app()
