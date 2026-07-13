"""Resolve and VERIFY carrier profiles for the demo.

Post-mortem baked into this script: the previous seed list contained DOT
numbers that resolved to a print shop, a landscaping company, and Comcast —
and the old pipeline cached them without question. This version:

  - Resolves seeds through app.tools.safer_lookup (QCMobile API when
    FMCSA_WEBKEY is set; validated scrape otherwise — garbage profiles are
    rejected there and never cached).
  - VERIFIES fit for the demo: operating status must not be UNKNOWN, and
    power units must fall inside the mid-market band (MIN_PU..MAX_PU).
    Optional per-seed name expectation (`expect`) is enforced when present.
  - Prints a scoreboard and writes `verified_dots.json`, which script 05
    consumes. Nothing unverified ever reaches the submission layer again.

Seed file format (scripts/seed_dot_numbers.json), both forms accepted:
  ["1234567", ...]                              — bare DOT numbers
  [{"dot": "1234567", "expect": "WERNER"}, ...] — with a name assertion

Where to find real DOT numbers: FMCSA's SMS site (ai.fmcsa.dot.gov/SMS)
lists carriers by size band; public truckers print their USDOT number in
their 10-Ks and on equipment.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.tools.safer_lookup import safer_lookup  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("01_download_fmcsa")

MIN_PU = 20     # mid-market band for demo submissions
MAX_PU = 1500
VERIFIED_PATH = Path(__file__).parent / "verified_dots.json"


def _load_seeds() -> list[dict]:
    seed_path = Path(__file__).parent / "seed_dot_numbers.json"
    if not seed_path.exists():
        log.error(
            "no seed list at %s. Create it with real DOT numbers "
            "(see module docstring for sources).", seed_path,
        )
        return []
    raw = json.loads(seed_path.read_text())
    out = []
    for item in raw:
        if isinstance(item, dict):
            out.append({"dot": str(item["dot"]), "expect": item.get("expect")})
        else:
            out.append({"dot": str(item), "expect": None})
    return out


async def main() -> int:
    seeds = _load_seeds()
    if not seeds:
        return 1
    if not settings.fmcsa_webkey:
        log.warning(
            "FMCSA_WEBKEY not set — falling back to the SAFER page scrape, "
            "which is layout-fragile. Get a free key at "
            "https://mobile.fmcsa.dot.gov/QCDevsite/ and put it in .env."
        )

    verified: list[dict] = []
    rejected: list[tuple[str, str]] = []
    for s in seeds:
        dot = s["dot"]
        try:
            profile = await safer_lookup(dot)
        except Exception as e:
            rejected.append((dot, f"lookup error: {e}"))
            continue
        if profile is None:
            rejected.append((dot, "did not resolve to a validated profile"))
            continue
        if s["expect"] and s["expect"].upper() not in profile.legal_name.upper():
            rejected.append((dot, f"name mismatch: expected ~'{s['expect']}', got '{profile.legal_name}'"))
            continue
        if profile.operating_status.upper() == "UNKNOWN":
            rejected.append((dot, f"operating status UNKNOWN ({profile.legal_name})"))
            continue
        in_band = MIN_PU <= profile.power_units <= MAX_PU
        verified.append({
            "dot": dot,
            "legal_name": profile.legal_name,
            "power_units": profile.power_units,
            "operating_status": profile.operating_status,
            # Only in-band carriers become demo submissions; larger verified
            # carriers (e.g. the public truckers we index 10-Ks for) are kept
            # for reference but excluded from the submission layer.
            "mid_market": in_band,
        })
        log.info(
            "VERIFIED %s · %s · %d PUs · %s%s",
            dot, profile.legal_name, profile.power_units, profile.operating_status,
            "" if in_band else " (outside mid-market band; reference only)",
        )

    log.info("scoreboard: %d verified / %d rejected", len(verified), len(rejected))
    for dot, why in rejected:
        log.warning("rejected %s: %s", dot, why)

    VERIFIED_PATH.write_text(json.dumps(verified, indent=2))
    log.info("wrote %s", VERIFIED_PATH)
    n_mid = sum(1 for v in verified if v["mid_market"])
    if n_mid < 5:
        log.error(
            "only %d verified MID-MARKET carriers (%d-%d PUs) — the demo needs at least 5. "
            "Add real DOT numbers to seed_dot_numbers.json (see docstring for sources).",
            n_mid, MIN_PU, MAX_PU,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
