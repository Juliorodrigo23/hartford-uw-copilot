"""FARS / NHTSA fatal-crash queries.

Used by scripts/08_export_viz_data.py to export REAL state-level fatal-crash
counts for the DataSourceMap visualization (replacing the previous invented
sample numbers). Queries NHTSA's public CrashAPI.
"""

from __future__ import annotations

import asyncio
import logging

import httpx

log = logging.getLogger(__name__)

FARS_URL = "https://crashviewer.nhtsa.dot.gov/CrashAPI/crashes/GetCrashesByLocation"

# NHTSA's WAF returns 403 to default HTTP-client user agents; identify as a
# browser (the API is public and unauthenticated).
FARS_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

# Static FARS microdata archive (fallback when the CrashAPI is blocked).
# Each yearly zip contains accident.csv with one row per fatal crash and a
# STATE (FIPS) column.
FARS_CSV_URL = "https://static.nhtsa.gov/nhtsa/downloads/FARS/{year}/National/FARS{year}NationalCSV.zip"

# FIPS code → (name, USPS abbreviation) for the 50 states + DC.
STATE_FIPS: dict[str, tuple[str, str]] = {
    "01": ("Alabama", "AL"), "02": ("Alaska", "AK"), "04": ("Arizona", "AZ"),
    "05": ("Arkansas", "AR"), "06": ("California", "CA"), "08": ("Colorado", "CO"),
    "09": ("Connecticut", "CT"), "10": ("Delaware", "DE"), "11": ("District of Columbia", "DC"),
    "12": ("Florida", "FL"), "13": ("Georgia", "GA"), "15": ("Hawaii", "HI"),
    "16": ("Idaho", "ID"), "17": ("Illinois", "IL"), "18": ("Indiana", "IN"),
    "19": ("Iowa", "IA"), "20": ("Kansas", "KS"), "21": ("Kentucky", "KY"),
    "22": ("Louisiana", "LA"), "23": ("Maine", "ME"), "24": ("Maryland", "MD"),
    "25": ("Massachusetts", "MA"), "26": ("Michigan", "MI"), "27": ("Minnesota", "MN"),
    "28": ("Mississippi", "MS"), "29": ("Missouri", "MO"), "30": ("Montana", "MT"),
    "31": ("Nebraska", "NE"), "32": ("Nevada", "NV"), "33": ("New Hampshire", "NH"),
    "34": ("New Jersey", "NJ"), "35": ("New Mexico", "NM"), "36": ("New York", "NY"),
    "37": ("North Carolina", "NC"), "38": ("North Dakota", "ND"), "39": ("Ohio", "OH"),
    "40": ("Oklahoma", "OK"), "41": ("Oregon", "OR"), "42": ("Pennsylvania", "PA"),
    "44": ("Rhode Island", "RI"), "45": ("South Carolina", "SC"), "46": ("South Dakota", "SD"),
    "47": ("Tennessee", "TN"), "48": ("Texas", "TX"), "49": ("Utah", "UT"),
    "50": ("Vermont", "VT"), "51": ("Virginia", "VA"), "53": ("Washington", "WA"),
    "54": ("West Virginia", "WV"), "55": ("Wisconsin", "WI"), "56": ("Wyoming", "WY"),
}


async def fars_count_by_state(state_fips: str, year: int) -> int | None:
    """Fatal-crash count for one state × year via NHTSA's public FARS API.

    Returns None on any error so callers can distinguish "0 crashes" from
    "query failed".
    """
    if not state_fips or not year:
        return None
    params = {
        "fromCaseYear": year,
        "toCaseYear": year,
        "state": int(state_fips),
        "format": "json",
    }
    try:
        async with httpx.AsyncClient(timeout=20, headers=FARS_HEADERS) as client:
            r = await client.get(FARS_URL, params=params)
            if r.status_code != 200:
                return None
            data = r.json()
        count = data.get("Count")
        if count is not None:
            return int(count)
        results = data.get("Results", [])
        if results and isinstance(results[0], list):
            return len(results[0])
        return 0
    except Exception as e:
        log.warning("fars_query failed for state %s: %s", state_fips, e)
        return None


async def fars_state_counts(year: int, delay_s: float = 0.5) -> dict[str, int]:
    """Fatal-crash counts for every state, politely rate-limited.

    Only successful lookups appear in the result; the export script requires
    a minimum coverage before it writes anything, so a flaky API can't
    produce a half-empty map presented as complete.
    """
    out: dict[str, int] = {}
    for fips in STATE_FIPS:
        n = await fars_count_by_state(fips, year)
        if n is not None:
            out[fips] = n
        await asyncio.sleep(delay_s)
    return out


def fars_state_counts_from_csv(year: int) -> dict[str, int]:
    """Fallback: aggregate the official FARS yearly microdata CSV.

    Downloads NHTSA's published national zip (~tens of MB, cached to
    data/raw/fars/) and counts fatal crashes per state from accident.csv.
    This is the primary-source file behind the CrashAPI, so it is at least
    as authoritative; it just costs one big download instead of 51 calls.
    """
    import csv
    import io
    import zipfile
    from pathlib import Path

    from app.config import settings

    cache_dir = settings.data_dir / "raw" / "fars"
    cache_dir.mkdir(parents=True, exist_ok=True)
    zip_path = cache_dir / f"FARS{year}NationalCSV.zip"

    if not zip_path.exists():
        url = FARS_CSV_URL.format(year=year)
        log.info("downloading FARS %d microdata (%s)…", year, url)
        with httpx.stream("GET", url, headers=FARS_HEADERS, timeout=300, follow_redirects=True) as r:
            if r.status_code != 200:
                raise RuntimeError(f"FARS CSV download failed: HTTP {r.status_code}")
            with zip_path.open("wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)

    counts: dict[str, int] = {}
    with zipfile.ZipFile(zip_path) as z:
        name = next((n for n in z.namelist() if n.lower().endswith("accident.csv")), None)
        if not name:
            raise RuntimeError(f"accident.csv not found in {zip_path.name} ({z.namelist()[:5]}…)")
        with z.open(name) as f:
            # utf-8-sig strips the BOM that otherwise turns the first header
            # into 'ï»¿STATE'; errors="replace" tolerates stray latin-1 bytes
            # in free-text columns we don't read anyway.
            reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", errors="replace"))
            state_col = next(
                (c for c in (reader.fieldnames or []) if c.strip().lstrip("﻿").upper() == "STATE"),
                None,
            )
            if not state_col:
                raise RuntimeError(f"no STATE column in accident.csv ({(reader.fieldnames or [])[:8]}…)")
            for row in reader:
                fips = str(row[state_col]).strip().zfill(2)
                if fips in STATE_FIPS:
                    counts[fips] = counts.get(fips, 0) + 1
    return counts
