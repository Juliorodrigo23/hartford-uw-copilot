"""FastAPI entrypoint."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.chat import router as chat_router
from app.api.data import router as data_router
from app.api.eval import router as eval_router
from app.api.traces import router as traces_router
from app.config import settings


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")
log = logging.getLogger("uw-copilot")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Commercial Auto Underwriting Copilot",
        version="0.1.0",
        description=(
            "Backend for the Hartford UW copilot demo. Real LangGraph agent on "
            "Vertex AI / Gemini, hybrid RAG over public FMCSA / NTSB / SEC data."
        ),
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["x-hartford-ratelimit-remaining"],
    )

    app.include_router(chat_router)
    app.include_router(traces_router)
    app.include_router(eval_router)
    app.include_router(data_router)

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok", "version": "0.1.0"}

    @app.get("/")
    def root() -> dict[str, str]:
        return {
            "service": "uw-copilot",
            "endpoints": "/chat (POST), /traces/{run_id} (GET), /eval (GET), /data/{name} (GET)",
        }

    log.info("App ready · project=%s region=%s model=%s", settings.gcp_project_id, settings.gcp_location, settings.vertex_model)
    return app


app = create_app()
