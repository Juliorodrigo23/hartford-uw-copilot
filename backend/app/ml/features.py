"""Feature engineering for the loss-frequency model."""

from __future__ import annotations

import numpy as np
import pandas as pd


FEATURE_NAMES = [
    "fleet_size_log",
    "oos_vehicle",
    "oos_driver",
    "crashes_24mo_total",
    "crashes_24mo_fatal",
    "tractor_share",
    "n_states",
    "is_general_freight",
    "is_hazmat",
    "is_tank",
]


def build_feature_frame(carriers: pd.DataFrame) -> pd.DataFrame:
    """`carriers` columns: fleet_size, oos_vehicle, oos_driver,
    crashes_24mo_total, crashes_24mo_fatal, tractor_share, n_states, commodity.
    Returns df with the canonical feature columns above.
    """
    out = pd.DataFrame()
    out["fleet_size_log"] = np.log1p(carriers["fleet_size"].astype(float))
    out["oos_vehicle"] = carriers["oos_vehicle"].astype(float).fillna(0.0)
    out["oos_driver"] = carriers["oos_driver"].astype(float).fillna(0.0)
    out["crashes_24mo_total"] = carriers.get("crashes_24mo_total", 0).astype(float).fillna(0.0)
    out["crashes_24mo_fatal"] = carriers.get("crashes_24mo_fatal", 0).astype(float).fillna(0.0)
    out["tractor_share"] = carriers.get("tractor_share", 0.8).astype(float).fillna(0.8)
    out["n_states"] = carriers.get("n_states", 1).astype(float).fillna(1.0)
    out["is_general_freight"] = (carriers["commodity"] == "general_freight").astype(float)
    out["is_hazmat"] = (carriers["commodity"] == "hazmat").astype(float)
    out["is_tank"] = (carriers["commodity"] == "tank").astype(float)
    return out[FEATURE_NAMES]
