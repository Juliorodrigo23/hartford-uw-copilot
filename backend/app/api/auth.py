"""HMAC verification for the chat endpoint.

The Vercel API route signs `<ts>.<body>` with the shared secret. Here we
verify and reject if signature is missing/invalid OR ts is more than 5 minutes
old (replay protection).

In dev (`ALLOW_UNSIGNED_DEV=true`) we skip verification.
"""

from __future__ import annotations

import hashlib
import hmac
import time

from fastapi import Request, HTTPException, status

from app.config import settings


MAX_SKEW_MS = 5 * 60 * 1000


async def verify_hmac(request: Request) -> None:
    if settings.allow_unsigned_dev:
        return
    ts = request.headers.get("x-hartford-ts")
    sig = request.headers.get("x-hartford-sig")
    if not ts or not sig:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing signature")
    try:
        ts_ms = int(ts)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="bad timestamp")
    now_ms = int(time.time() * 1000)
    if abs(now_ms - ts_ms) > MAX_SKEW_MS:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="stale timestamp")
    body = await request.body()
    expected = hmac.new(
        settings.hmac_secret.encode("utf-8"),
        ts.encode("utf-8") + body,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="bad signature")
