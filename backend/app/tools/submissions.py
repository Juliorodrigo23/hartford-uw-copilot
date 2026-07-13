"""Loader for synthesized submissions and the book of business."""

from __future__ import annotations

import json
import logging
from datetime import date
from decimal import Decimal
from functools import lru_cache

from app.config import settings
from app.schemas import LossYear, Submission, VehicleMix

log = logging.getLogger(__name__)

SUB_PATH = settings.data_dir / "synthesized" / "submissions.json"


@lru_cache(maxsize=1)
def _all() -> dict[str, Submission]:
    if not SUB_PATH.exists():
        log.warning("submissions file not found at %s — run scripts/05_synthesize_subs.py", SUB_PATH)
        return {}
    raw = json.loads(SUB_PATH.read_text())
    items = raw.get("submissions", raw)
    out: dict[str, Submission] = {}
    dropped = 0
    for d in items:
        try:
            out[d["id"]] = Submission(
                id=d["id"],
                carrier_name=d["carrier_name"],
                dot_number=str(d["dot_number"]),
                safer_legal_name=d.get("safer_legal_name"),
                fleet_size=int(d["fleet_size"]),
                vehicle_mix=VehicleMix(**d.get("vehicle_mix", {"tractor": 1.0})),
                states_of_operation=list(d.get("states_of_operation", [])),
                effective_date=date.fromisoformat(d["effective_date"]),
                loss_run=[
                    LossYear(year=l["year"], claims=int(l["claims"]), incurred_usd=Decimal(str(l["incurred_usd"])))
                    for l in d.get("loss_run", [])
                ],
                broker_email=d.get("broker_email", ""),
                commodity=d.get("commodity", "general_freight"),
            )
        except Exception as e:
            dropped += 1
            log.error("dropping malformed submission %s: %s", d.get("id", "<no id>"), e)
    if dropped:
        log.error("%d submission(s) failed validation and were dropped", dropped)
    return out


def load_submission(sub_id: str) -> Submission | None:
    return _all().get(sub_id)


def list_submissions() -> list[Submission]:
    return list(_all().values())
