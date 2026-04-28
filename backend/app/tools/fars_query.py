"""FARS / NHTSA crash query.

NHTSA exposes a fatal-crash query at the public FARS Encyclopedia. The full
microdata is downloadable as zipped CSVs by year. Here we query the public
query endpoint as a JSON shim for the agent.

Off by default (the agent doesn't always need it); included so the system
can be extended at evaluation time.
"""

from __future__ import annotations

import logging

import httpx

log = logging.getLogger(__name__)


async def fars_count_by_state(state: str, year: int) -> int | None:
    """Approximate fatal-crash count for state × year via NHTSA's public FARS API.

    Falls back to None on any error — the calling node treats this as missing.
    """
    if not state or not year:
        return None
    url = f"https://crashviewer.nhtsa.dot.gov/CrashAPI/crashes/GetCrashesByLocation"
    params = {
        "fromCaseYear": year,
        "toCaseYear": year,
        "state": state,
        "format": "json",
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, params=params)
            if r.status_code != 200:
                return None
            data = r.json()
        results = data.get("Results", [])
        if not results:
            return 0
        return int(data.get("Count", len(results[0]) if isinstance(results[0], list) else 0))
    except Exception as e:
        log.warning("fars_query failed: %s", e)
        return None
