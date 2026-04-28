"""FMCSA SAFER lookup.

We scrape the public SAFER Company Snapshot page (it has no public REST API
that returns JSON). Cached aggressively to disk so repeated lookups don't
re-hit FMCSA, and so the eval suite is reproducible offline.

If a DOT number doesn't resolve, returns None — the caller routes to the
`data_insufficient` terminal.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from pathlib import Path

import httpx
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_exponential_jitter

from app.config import settings
from app.schemas import SAFERProfile

log = logging.getLogger(__name__)

CACHE_DIR = settings.data_dir / "raw" / "fmcsa" / "safer_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


SAFER_URL = "https://safer.fmcsa.dot.gov/query.asp"


def _cache_path(dot: str) -> Path:
    return CACHE_DIR / f"{dot}.json"


def _parse_snapshot(html: str, dot: str) -> SAFERProfile | None:
    """Extract the fields we care about from the SAFER snapshot HTML.

    SAFER returns a long set of <th>...</th><td>...</td> pairs. Labels may be
    wrapped in <a class="querylabel">. We use BeautifulSoup for robust parsing.
    """
    if "Record Not Found" in html or "RECORD NOT FOUND" in html or "no record" in html.lower():
        return None

    soup = BeautifulSoup(html, "lxml")

    def field(label: str) -> str | None:
        """Find the <td> that follows the <th> whose text contains `label`."""
        for th in soup.find_all("th"):
            txt = (th.get_text() or "").strip().lower().rstrip(":")
            if txt == label.lower() or txt.startswith(label.lower()):
                td = th.find_next("td")
                if td:
                    return td.get_text(separator=" ", strip=True)
        return None

    legal = field("Legal Name") or field("DBA Name") or "(unknown)"
    op_status = field("Operating Status") or "UNKNOWN"
    pus = int(_first_int(field("Power Units")) or 0)
    drivers = int(_first_int(field("Drivers")) or 0)

    # Crash table — find the table after the "Crashes" header.
    c_total, c_fatal, c_injury, c_tow = _parse_crash_table(soup)

    # Inspection / OOS table
    oos_v, oos_d, oos_h = _parse_oos_rates(soup)

    return SAFERProfile(
        legal_name=legal,
        operating_status=op_status,
        power_units=pus,
        drivers=drivers,
        crashes_24mo_total=c_total,
        crashes_24mo_fatal=c_fatal,
        crashes_24mo_injury=c_injury,
        crashes_24mo_towaway=c_tow,
        oos_rate_vehicle=oos_v or 0.0,
        oos_rate_driver=oos_d or 0.0,
        oos_rate_hazmat=oos_h,
        basic_violations={},
        raw_dot=dot,
    )


def _parse_crash_table(soup: BeautifulSoup) -> tuple[int, int, int, int]:
    """Find the US crashes table; rows are columns Fatal | Injury | Tow | Total."""
    for table in soup.find_all("table", summary=re.compile("Crashes", re.IGNORECASE)):
        rows = table.find_all("tr")
        for r in rows:
            cells = [c.get_text(strip=True) for c in r.find_all("td")]
            if len(cells) >= 4 and all(re.fullmatch(r"\d+", c or "") for c in cells[:4]):
                fatal, injury, tow, total = (int(cells[i]) for i in range(4))
                return total, fatal, injury, tow
    return 0, 0, 0, 0


def _parse_oos_rates(soup: BeautifulSoup) -> tuple[float | None, float | None, float | None]:
    """Inspection table: rows include 'Out of Service %' for Vehicle / Driver / Hazmat."""
    veh = drv = haz = None
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if len(rows) < 3:
            continue
        for r in rows:
            head = r.find("th")
            if not head:
                continue
            label = head.get_text(separator=" ", strip=True).lower()
            if "out of service" not in label or "%" not in label:
                continue
            cells = [c.get_text(strip=True) for c in r.find_all("td")]
            pcts = [_first_pct(c) for c in cells]
            # Common column order: Vehicle | Driver | Hazmat | Total/National Avg
            if len(pcts) >= 2:
                veh = pcts[0] if pcts[0] is not None else veh
                drv = pcts[1] if pcts[1] is not None else drv
                if len(pcts) >= 3 and pcts[2] is not None:
                    haz = pcts[2]
    return veh, drv, haz


def _first_int(s: str | None) -> str | None:
    if not s:
        return None
    m = re.search(r"(\d+)", s)
    return m.group(1) if m else None


def _first_pct(s: str | None) -> float | None:
    if not s:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)\s*%", s)
    return (float(m.group(1)) / 100.0) if m else None


def _after(needle: str, html: str, *, lookahead: str) -> str | None:
    """Find a small slice of HTML containing both needle and lookahead."""
    idx = html.lower().find(needle.lower())
    if idx < 0:
        return None
    slice_ = html[idx : idx + 4000]
    if lookahead.lower() in slice_.lower():
        return slice_
    return None


@retry(stop=stop_after_attempt(3), wait=wait_exponential_jitter(initial=1, max=8))
async def _fetch_snapshot(dot: str) -> str | None:
    payload = {
        "searchtype": "ANY",
        "query_type": "queryCarrierSnapshot",
        "query_param": "USDOT",
        "query_string": dot,
    }
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        r = await client.post(SAFER_URL, data=payload, headers={
            "User-Agent": "uw-copilot-demo/0.1 (research, contact 23juliorod@gmail.com)",
        })
        if r.status_code != 200:
            return None
        return r.text


async def safer_lookup(dot: str) -> SAFERProfile | None:
    """Look up a DOT number via the SAFER Company Snapshot.

    Cache hit: returns the cached profile (deserialized).
    Cache miss: hits FMCSA, parses, persists, returns.
    """
    p = _cache_path(dot)
    if p.exists():
        try:
            return SAFERProfile(**json.loads(p.read_text()))
        except Exception:
            log.warning("corrupt safer cache for %s; refetching", dot)

    try:
        html = await _fetch_snapshot(dot)
    except Exception as e:
        log.warning("SAFER fetch failed for %s: %s", dot, e)
        return None
    if not html:
        return None
    profile = _parse_snapshot(html, dot)
    if profile:
        p.write_text(profile.model_dump_json(indent=2))
    return profile


# Sync convenience for ad-hoc REPL / scripts.
def safer_lookup_sync(dot: str) -> SAFERProfile | None:
    return asyncio.run(safer_lookup(dot))
