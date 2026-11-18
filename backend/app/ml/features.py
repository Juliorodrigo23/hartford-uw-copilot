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
    out = pd.DataFrame(index=carriers.index)
    def optional(name: str, default: float) -> pd.Series:
        column = carriers[name] if name in carriers else pd.Series(default, index=carriers.index)
        return column.astype(float).fillna(default)
    out["fleet_size_log"] = np.log1p(carriers["fleet_size"].astype(float))
    out["oos_vehicle"] = carriers["oos_vehicle"].astype(float).fillna(0.0)
    out["oos_driver"] = carriers["oos_driver"].astype(float).fillna(0.0)
    out["crashes_24mo_total"] = optional("crashes_24mo_total", 0.0)
    out["crashes_24mo_fatal"] = optional("crashes_24mo_fatal", 0.0)
    out["tractor_share"] = optional("tractor_share", 0.8)
    out["n_states"] = optional("n_states", 1.0)
    out["is_general_freight"] = (carriers["commodity"] == "general_freight").astype(float)
    out["is_hazmat"] = (carriers["commodity"] == "hazmat").astype(float)
    out["is_tank"] = (carriers["commodity"] == "tank").astype(float)
    return out[FEATURE_NAMES]
