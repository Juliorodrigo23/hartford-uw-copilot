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
from app.graph.builder import build_graph  # noqa: E402
from app.observability.tracing import maybe_enable_langfuse  # noqa: E402

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


def _warm_models_blocking() -> None:
    """Load the retrieval models into RAM so the FIRST chat request doesn't
    pay 20-40s of model loading mid-stream. Runs in a background thread at
    startup; failures are logged, never fatal (dense retrieval degrades to
    BM25 as usual)."""
    import time as _t

    t0 = _t.time()
    try:
        from app.rag.hybrid_search import _dense_index_ready, _reranker

        if _dense_index_ready():
            from app.rag.embeddings import embed_query

            embed_query("warmup")
        else:
            log.info("dense index empty — no models to warm (BM25-only mode)")
        # BM25-only mode still reranks candidates; warm that path too.
        _reranker()
        app_state["models_warm"] = True
        log.info("retrieval models warm in %.1fs", _t.time() - t0)
    except Exception as e:
        log.error("model warmup failed after %.1fs: %s", _t.time() - t0, e)


app_state: dict = {"models_warm": False, "started_at": time.time()}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Compile the agent graph ONCE against a durable SQLite checkpointer.

    /chat and /traces share this graph, so a run_id streamed by /chat is
    replayable from /traces — across workers and across restarts, because
    the checkpoints live in a file, not in process memory.

    In production, model warmup runs concurrently so the server binds its port
    immediately (Cloud Run readiness) while bge-large loads. Local and test
    processes stay lazy by default to avoid competing native runtime threads.
    """
    import asyncio as _asyncio

    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

    settings.data_dir.mkdir(parents=True, exist_ok=True)
    async with AsyncSqliteSaver.from_conn_string(str(settings.checkpoint_db)) as saver:
        app.state.graph = build_graph(saver)
        maybe_enable_langfuse()
        warmup = (
            _asyncio.get_running_loop().run_in_executor(None, _warm_models_blocking)
            if settings.warm_rag_models
            else None
        )
        app.state.model_warmup = warmup
        log.info(
            "App ready · project=%s region=%s model=%s checkpoints=%s",
            settings.gcp_project_id, settings.gcp_location,
            settings.vertex_model, settings.checkpoint_db,
        )
        try:
            yield
        finally:
            # Cancelling the asyncio wrapper does not kill an already-running
            # executor thread, but it does keep shutdown from retaining a
            # dangling Future. The warmup function catches/logs its own errors.
            if warmup is not None and not warmup.done():
                warmup.cancel()


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

    # NOTE: middleware registered LAST becomes OUTERMOST in Starlette. The
    # rate limiter is registered first so that CORSMiddleware (added after)
    # wraps it — otherwise 429 responses leave without CORS headers and the
    # browser reports them as an opaque NetworkError.
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

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_origin_regex=settings.allowed_origin_regex,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["x-hartford-ratelimit-remaining"],
    )

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

    @app.get("/ready")
    def ready():
        if settings.warm_rag_models and not app_state["models_warm"]:
            return JSONResponse({"status": "warming"}, status_code=503)
        return {"status": "ready"}

    @app.get("/diag")
    def diag() -> dict:
        """One-stop audit of the running instance: what data shipped, whether
        the models are warm, and how long this container has been alive.
        Read-only; this is the first URL to check when chat misbehaves."""
        out: dict = {
            "version": "0.2.0",
            "uptime_s": round(time.time() - app_state["started_at"], 1),
            "models_warm": app_state["models_warm"],
            "model_warmup_enabled": settings.warm_rag_models,
            "vertex_model": settings.vertex_model,
            "vertex_fast_model": settings.vertex_fast_model,
            "vertex_location": settings.gcp_location,
            "critique_provider": settings.critique_provider,
            "openai_judge_model": settings.openai_judge_model,
            "openai_configured": bool(settings.openai_api_key),
            "vertex_transport": settings.vertex_api_transport,
            "checkpoint_db_exists": settings.checkpoint_db.exists(),
        }
        warmup = getattr(app.state, "model_warmup", None)
        try:
            from app.rag.hybrid_search import COLLECTIONS
            from app.rag.store import get_or_create

            out["index_chunks"] = (
                "warming" if warmup is not None and not warmup.done()
                else {name: get_or_create(name).count() for name in COLLECTIONS}
            )
        except Exception as e:
            out["index_chunks"] = f"error: {e}"
        try:
            import json as _json

            bm25 = settings.data_dir / "processed" / "bm25_corpus.json"
            out["bm25_chunks"] = len(_json.loads(bm25.read_text())["docs"]) if bm25.exists() else 0
        except Exception as e:
            out["bm25_chunks"] = f"error: {e}"
        try:
            from app.tools.submissions import list_submissions

            out["submissions"] = len(list_submissions())
        except Exception as e:
            out["submissions"] = f"error: {e}"
        try:
            import json as _json

            meta = settings.artifacts_dir / "model_meta.json"
            out["xgb_model"] = _json.loads(meta.read_text()).get("version") if meta.exists() else None
        except Exception as e:
            out["xgb_model"] = f"error: {e}"
        return out

    @app.get("/")
    def root() -> dict[str, str]:
        return {
            "service": "uw-copilot",
            "endpoints": "/chat (POST), /traces/{run_id} (GET), /eval (GET), /data/{name} (GET)",
        }

    return app


app = create_app()
