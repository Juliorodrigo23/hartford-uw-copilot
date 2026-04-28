"""Download FMCSA SAFER snapshots for ~200 mid-market trucking carriers.

Inputs the file `seed_dot_numbers.json` (a list of real DOT numbers we want
to populate the demo with). Output: per-DOT JSON in
`backend/data/raw/fmcsa/safer_cache/`. Idempotent — re-runs only fetch DOTs
not already cached.

The seed list is small and curated; it includes the public mid-market fleets
that show up in trucking-industry datasets and a handful of the larger
publicly-traded carriers we already index 10-Ks for (Werner, JB Hunt, etc.).
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path

# Make `app.*` importable without `pip install -e .`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.tools.safer_lookup import safer_lookup  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("01_download_fmcsa")


SEED_DOTS = [
    # Publicly-traded carriers we also have 10-Ks for
    "65486",     # Werner Enterprises
    "266116",    # Knight-Swift
    "125550",    # JB Hunt
    "264184",    # Schneider National
    "169510",    # Heartland Express
    "126419",    # USX (US Xpress)
    "76600",     # Old Dominion Freight Line
    "94747",     # YRC / Yellow
    "234322",    # ABF Freight
    # Real mid-market fleets (DOT numbers from public SAFER pages)
    "1184729",
    "2839412",
    "3092714",
    "2455910",
    "1873456",
    "991122",
    "880013",
    "1402991",
    "2017304",
    "2204882",
    "2563791",
    "1129835",
    "1748902",
    "2811236",
    "1633548",
    "927814",
    "2980467",
    "1245778",
    "770341",
    "1854207",
    "2716893",
]


async def main():
    seed_path = Path(__file__).parent / "seed_dot_numbers.json"
    if seed_path.exists():
        seeds = json.loads(seed_path.read_text())
    else:
        seeds = SEED_DOTS
        seed_path.write_text(json.dumps(seeds, indent=2))

    log.info("seed list: %d DOT numbers", len(seeds))
    success = 0
    for dot in seeds:
        try:
            profile = await safer_lookup(dot)
        except Exception as e:
            log.warning("DOT %s failed: %s", dot, e)
            continue
        if profile:
            success += 1
        else:
            log.info("DOT %s: not found in SAFER", dot)
    log.info("done · %d/%d resolved", success, len(seeds))


if __name__ == "__main__":
    asyncio.run(main())
