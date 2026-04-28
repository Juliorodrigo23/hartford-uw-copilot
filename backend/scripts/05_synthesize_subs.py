"""Synthesize 30 ACORD-style submissions and a 200-account book of business.

Each submission:
  - Tied to a real DOT number from the seed list (so SAFER tools return real data)
  - Has a broker cover email written by Gemini (varied tone)
  - Has a 5-year loss run with realistic frequency × severity
  - Has a vehicle mix consistent with the commodity

Idempotent: skips writing if files already exist (force with --rewrite).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import random
import sys
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings  # noqa: E402
from app.tools.safer_lookup import safer_lookup  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("05_synthesize")


SUB_PATH = settings.data_dir / "synthesized" / "submissions.json"
BOOK_PATH = settings.data_dir / "synthesized" / "book_of_business.json"


CARRIER_NAMES = [
    "ABC Transport", "Cascadia Freight", "Magnolia Tank Lines", "Heartland LTL",
    "Liberty Auto Transport", "Hill Country Logistics", "Bayou Drayage",
    "Sunbelt Carriers", "Iron Range Freight", "Great Plains Express",
    "Apex Refrigerated", "Lone Star Tankers", "Northwest Reefer",
    "Mid-Atlantic Hauling", "Coastal Cartage", "Frontier Distribution",
    "Big Sky Trucking", "Peach State Freight", "Old North Freightways",
    "Granite Mountain Logistics", "Ozark Express", "River Valley Cartage",
    "Twin Ports Trucking", "Southwest Stage Lines", "Buckeye Express",
    "Pinelands Carriers", "High Desert Hauling", "Tidewater Trucking",
    "Mojave Freight", "Cumberland Transport",
]

STATE_BUNDLES = [
    ["TX", "OK", "AR", "LA"], ["WA", "OR", "ID", "MT"], ["MS", "AL", "GA", "FL"],
    ["IA", "NE", "MO", "KS", "IL", "IN"], ["NJ", "PA", "NY", "CT"], ["CA", "NV", "AZ"],
    ["MI", "OH", "PA"], ["NC", "SC", "VA", "WV"], ["TN", "KY", "VA"], ["MN", "WI", "ND"],
]

COMMODITIES = ["general_freight", "general_freight", "general_freight", "tank", "hazmat"]


def _seed_dots() -> list[str]:
    seeds_path = Path(__file__).parent / "seed_dot_numbers.json"
    if seeds_path.exists():
        return json.loads(seeds_path.read_text())
    return [str(d) for d in [
        "1184729", "2839412", "3092714", "2455910", "1873456", "991122",
        "880013", "1402991", "2017304", "2204882", "2563791", "1129835",
        "1748902", "2811236", "1633548", "927814", "2980467", "1245778",
        "770341", "1854207", "2716893",
    ]]


def _make_loss_run(rng: random.Random, fleet: int, adverse: bool) -> list[dict]:
    today = date.today()
    out = []
    base_freq = 0.03 if not adverse else 0.062
    base_sev = 80_000 if not adverse else 105_000
    for k in range(5):
        y = today.year - (5 - k)
        # Drift up over years
        f = base_freq * (1.0 + 0.04 * k + rng.uniform(-0.01, 0.01))
        s = base_sev * (1.0 + 0.05 * k + rng.uniform(-0.04, 0.04))
        n = max(0, int(round(f * fleet)))
        incurred = int(n * s * (1 + rng.uniform(-0.15, 0.15)))
        out.append({"year": y, "claims": n, "incurred_usd": str(Decimal(incurred))})
    return out


def _make_email(rng: random.Random, name: str, dot: str, fleet: int, states: list[str]) -> str:
    tones = [
        f"""Team —

Looking for a Hartford quote on {name} (DOT {dot}). They run {fleet} power units, mostly out of {states[0]}/{states[-1]} corridors. 5-yr loss run attached, MVRs are clean for the most part. Renewal effective in 30 days. Producer is Mike at Lockton.

—J.""",
        f"""Hi — please see attached for {name}, USDOT {dot}. {fleet} units, {len(states)} states ({', '.join(states)}). They came off ABC Insurance after a tough year on freq. Loss runs and MVRs in the packet. Need terms by Friday.

Thanks,
Producer""",
        f"""New submission — {name} ({dot}). Solid mid-market account in the {states[0]} corridor. Fleet {fleet} PUs, general freight, no hazmat. Loss runs decent. Ready for your quote at the earliest.""",
    ]
    return rng.choice(tones)


async def _resolve_real(dot: str) -> dict | None:
    p = await safer_lookup(dot)
    return p.model_dump(mode="json") if p else None


async def main(rewrite: bool = False) -> None:
    SUB_PATH.parent.mkdir(parents=True, exist_ok=True)
    rng = random.Random(42)
    np_rng = np.random.default_rng(42)
    seeds = _seed_dots()

    if SUB_PATH.exists() and not rewrite:
        log.info("submissions exist · use --rewrite to regenerate")
    else:
        subs: list[dict] = []
        for i in range(30):
            dot = seeds[i % len(seeds)]
            name = f"{CARRIER_NAMES[i % len(CARRIER_NAMES)]} Inc"
            states = rng.choice(STATE_BUNDLES)
            commodity = rng.choice(COMMODITIES)
            fleet = int(np_rng.integers(60, 360))
            adverse = rng.random() < 0.4 or commodity == "hazmat"
            mix = (
                {"tractor": 0.86, "straight_truck": 0.10, "trailer": 0.0, "other": 0.04}
                if commodity != "tank"
                else {"tractor": 0.74, "straight_truck": 0.06, "trailer": 0.18, "other": 0.02}
            )
            sub = {
                "id": f"SUB-{i + 1:03d}",
                "carrier_name": name,
                "dot_number": dot,
                "fleet_size": fleet,
                "vehicle_mix": mix,
                "states_of_operation": states,
                "effective_date": (date.today() + timedelta(days=30 + rng.randint(-5, 20))).isoformat(),
                "loss_run": _make_loss_run(rng, fleet, adverse),
                "broker_email": _make_email(rng, name, dot, fleet, states),
                "commodity": commodity,
            }
            # Try to attach the SAFER profile so anyone reading the file
            # sees that the DOT resolves; not used directly by the agent (it
            # re-fetches), purely for transparency.
            try:
                sub["_safer_snapshot"] = await _resolve_real(dot)
            except Exception:
                sub["_safer_snapshot"] = None
            subs.append(sub)

        SUB_PATH.write_text(json.dumps({"submissions": subs}, indent=2, default=str))
        log.info("wrote %d submissions to %s", len(subs), SUB_PATH)

    # Book of business — 200 accounts for comparable_search
    if BOOK_PATH.exists() and not rewrite:
        log.info("book exists · use --rewrite to regenerate")
        return

    book: list[dict] = []
    for i in range(200):
        adverse = rng.random() < 0.32
        fleet = int(np_rng.integers(40, 600))
        commodity = rng.choice(COMMODITIES)
        oosv = max(0.02, np_rng.normal(0.13, 0.08))
        if adverse:
            oosv = max(oosv, 0.22 + rng.random() * 0.1)
        oosd = max(0.01, np_rng.normal(0.04, 0.02))
        lr = max(0.2, np_rng.normal(0.62, 0.18))
        if adverse:
            lr = max(lr, 0.78 + rng.random() * 0.2)
        book.append(
            {
                "id": f"BOOK-{i + 1:03d}",
                "carrier_name": f"{rng.choice(CARRIER_NAMES)} {rng.choice(['Co', 'Inc', 'LLC', 'Group'])}",
                "fleet_size": fleet,
                "oos_vehicle": round(oosv, 3),
                "oos_driver": round(oosd, 3),
                "loss_ratio_3yr": round(lr, 3),
                "frequency_per_pu_per_yr": round(0.03 + (oosv - 0.13) * 0.4, 4),
                "trend_3yr_pct": round(rng.uniform(-3.0, 18.0), 1),
                "commodity": commodity,
                "disposition": rng.choice(
                    ["bound", "bound", "bound", "declined", "lost_to_market", "non_renewed"]
                ),
            }
        )
    BOOK_PATH.write_text(json.dumps({"accounts": book}, indent=2))
    log.info("wrote %d book accounts to %s", len(book), BOOK_PATH)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--rewrite", action="store_true")
    args = parser.parse_args()
    asyncio.run(main(rewrite=args.rewrite))
