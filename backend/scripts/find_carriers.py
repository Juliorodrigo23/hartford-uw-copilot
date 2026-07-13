"""Find REAL carrier DOT numbers via FMCSA's QCMobile name search.

The repo's original seed list contained invented DOT numbers (the hostile
audit found a print shop behind the flagship demo submission). This tool
makes guessing unnecessary: search by name fragments, filter by fleet size,
and paste verified DOTs straight into seed_dot_numbers.json.

Usage:
  uv run python scripts/find_carriers.py "werner enterprises"
  uv run python scripts/find_carriers.py trucking express logistics --min-pu 20 --max-pu 1500
  uv run python scripts/find_carriers.py freight --min-pu 50 --max-pu 800 --json

Requires FMCSA_WEBKEY in the repo-root .env.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import urllib.parse
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings  # noqa: E402

logging.basicConfig(level=logging.WARNING)
log = logging.getLogger("find_carriers")

SEARCH_URL = "https://mobile.fmcsa.dot.gov/qc/services/carriers/name/{name}"


def _rows_from_response(payload: dict) -> list[dict]:
    content = payload.get("content")
    if content is None:
        return []
    if isinstance(content, dict):
        content = [content]
    rows = []
    for item in content:
        carrier = item.get("carrier") if isinstance(item, dict) else None
        if not isinstance(carrier, dict):
            carrier = item if isinstance(item, dict) else {}
        if carrier.get("legalName"):
            rows.append(carrier)
    return rows


def _i(v) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def search(term: str, webkey: str) -> list[dict]:
    url = SEARCH_URL.format(name=urllib.parse.quote(term))
    r = httpx.get(url, params={"webKey": webkey, "size": 100}, timeout=30)
    if r.status_code in (401, 403):
        raise SystemExit(f"QCMobile rejected the webKey (HTTP {r.status_code}) — check FMCSA_WEBKEY")
    if r.status_code != 200:
        log.warning("search %r → HTTP %s", term, r.status_code)
        return []
    return _rows_from_response(r.json())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("terms", nargs="+", help="name fragments to search")
    ap.add_argument("--min-pu", type=int, default=20)
    ap.add_argument("--max-pu", type=int, default=1500)
    ap.add_argument("--json", action="store_true", help="emit seed_dot_numbers.json entries")
    args = ap.parse_args()

    if not settings.fmcsa_webkey:
        raise SystemExit("FMCSA_WEBKEY is not set in the repo-root .env")

    seen: set[str] = set()
    hits: list[dict] = []
    for term in args.terms:
        for c in search(term, settings.fmcsa_webkey):
            dot = str(c.get("dotNumber") or "")
            pus = _i(c.get("totalPowerUnits", c.get("totPowerUnits")))
            status = str(c.get("statusCode") or "")
            allowed = str(c.get("allowedToOperate", "")).upper()
            if not dot or dot in seen:
                continue
            seen.add(dot)
            if not (args.min_pu <= pus <= args.max_pu):
                continue
            # Strictly ACTIVE only: an explicit statusCode wins; the
            # allowedToOperate flag is only trusted when statusCode is absent
            # (previously inactive "I" carriers slipped through via that flag).
            if status:
                if status.upper() != "A":
                    continue
            elif allowed != "Y":
                continue
            hits.append({"dot": dot, "name": c["legalName"], "power_units": pus, "status": status or allowed})

    hits.sort(key=lambda h: -h["power_units"])
    if args.json:
        print(json.dumps([{"dot": h["dot"]} for h in hits], indent=2))
    else:
        print(f"{'DOT':<10} {'PUs':<6} {'status':<7} legal name")
        for h in hits:
            print(f"{h['dot']:<10} {h['power_units']:<6} {h['status']:<7} {h['name']}")
        print(f"\n{len(hits)} active carriers in the {args.min_pu}-{args.max_pu} PU band.")
        print("Add chosen DOTs to scripts/seed_dot_numbers.json as {\"dot\": \"...\"} entries,")
        print("then run scripts/01_download_fmcsa.py to verify and cache them.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
