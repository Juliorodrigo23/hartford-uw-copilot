"""Lightweight Langfuse hooks (optional)."""

from __future__ import annotations

import logging
import os

log = logging.getLogger(__name__)


def maybe_enable_langfuse() -> bool:
    if not os.getenv("LANGFUSE_PUBLIC_KEY") or not os.getenv("LANGFUSE_SECRET_KEY"):
        return False
    try:
        from langfuse import Langfuse  # type: ignore[import-not-found]

        _ = Langfuse()
        log.info("langfuse tracing enabled")
        return True
    except Exception as e:
        log.warning("langfuse not enabled: %s", e)
        return False
