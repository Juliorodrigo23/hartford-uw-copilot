"""XGBoost loss-frequency predictor — exposed as a tool for the agent.

Provenance is explicit: predictions carry `source="xgboost"` only when the
trained booster produced them. When artifacts are missing we return a
clearly-labeled `source="heuristic_fallback"` estimate so the memo and the
trace UI never present a heuristic as a model output.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache

import numpy as np
from langsmith import traceable

from app.config import settings
from app.schemas import SAFERProfile, Submission, XGBPrediction

log = logging.getLogger(__name__)

ARTIFACTS = settings.artifacts_dir
MODEL_PATH = ARTIFACTS / "xgb_loss_freq.json"
META_PATH = ARTIFACTS / "model_meta.json"


@lru_cache(maxsize=1)
def _load_model():
    """Load the XGBoost booster (+ metadata). No shap import at inference.

    Attributions come from XGBoost's NATIVE exact TreeSHAP
    (`booster.predict(..., pred_contribs=True)`), which returns the same
    Shapley values as shap.TreeExplainer without importing shap/numba.
    That matters twice over: a pickled explainer broke across Python
    versions (audit finding), and initializing numba/llvmlite in a process
    where torch is already loaded segfaults on macOS arm64 (observed as
    exit 139 the moment the agent called this tool after retrieval had
    loaded torch). shap is used only at training time, in its own process.

    Returns (booster, feature_names, version, pi_multipliers).
    """
    if not MODEL_PATH.exists():
        log.warning(
            "XGBoost artifacts not present at %s — predictions will be labeled "
            "heuristic_fallback until scripts/06_train_xgb.py is run",
            MODEL_PATH,
        )
        return (None, [], None, None)
    try:
        import xgboost as xgb

        booster = xgb.Booster()
        booster.load_model(str(MODEL_PATH))
        feat_names: list[str] = []
        version: str | None = None
        pi_mult: tuple[float, float] | None = None
        if META_PATH.exists():
            meta = json.loads(META_PATH.read_text())
            feat_names = meta.get("feature_names", [])
            version = meta.get("version")
            pm = meta.get("pi80_multipliers")
            if isinstance(pm, list) and len(pm) == 2:
                pi_mult = (float(pm[0]), float(pm[1]))
        return (booster, feat_names, version, pi_mult)
    except Exception as e:
        log.exception("model load failed: %s", e)
        return (None, [], None, None)


def _features(sub: Submission, safer: SAFERProfile | None) -> tuple[np.ndarray, list[str]]:
    f = {
        "fleet_size_log": np.log1p(sub.fleet_size),
        "oos_vehicle": safer.oos_rate_vehicle if safer else 0.12,
        "oos_driver": safer.oos_rate_driver if safer else 0.05,
        "crashes_24mo_total": float(safer.crashes_24mo_total) if safer else 0.0,
        "crashes_24mo_fatal": float(safer.crashes_24mo_fatal) if safer else 0.0,
        "tractor_share": sub.vehicle_mix.tractor,
        "n_states": float(len(sub.states_of_operation)),
        "is_general_freight": 1.0 if sub.commodity == "general_freight" else 0.0,
        "is_hazmat": 1.0 if sub.commodity == "hazmat" else 0.0,
        "is_tank": 1.0 if sub.commodity == "tank" else 0.0,
    }
    return np.array(list(f.values()), dtype=float), list(f.keys())


def _fallback(sub: Submission, safer: SAFERProfile | None) -> XGBPrediction:
    """Deterministic actuarial-style heuristic used ONLY when the model is
    absent. Labeled as such; produces no SHAP values because there is no
    model to explain."""
    base_rate = 0.04
    bump = 1.0
    if safer and safer.oos_rate_vehicle > 0.20:
        bump *= 1.6
    if safer and safer.oos_rate_driver > 0.06:
        bump *= 1.3
    pred = base_rate * sub.fleet_size * bump
    pi = (pred * 0.7, pred * 1.4)
    return XGBPrediction(
        pred_claims_next_yr=float(pred),
        pi_80=(round(pi[0], 1), round(pi[1], 1)),
        shap_top=[],
        source="heuristic_fallback",
        model_version=None,
    )


@traceable(name="xgb_loss_freq", run_type="tool")
def xgb_predict(sub: Submission, safer: SAFERProfile | None) -> XGBPrediction:
    booster, feat_names, version, pi_mult = _load_model()
    if booster is None:
        return _fallback(sub, safer)

    import xgboost as xgb

    x, names = _features(sub, safer)
    # Reorder columns to model's training order if metadata is present.
    if feat_names:
        idx = [names.index(n) for n in feat_names if n in names]
        x = x[idx]
        names = [names[i] for i in idx]
    dmat = xgb.DMatrix(x.reshape(1, -1), feature_names=names)
    yhat = float(booster.predict(dmat)[0])
    # 80% PI from EMPIRICAL out-of-fold residual quantiles (stored in
    # model_meta.json by training); analytic fallback only for old metadata.
    lo_m, hi_m = pi_mult if pi_mult else (0.72, 1.42)
    pi_low, pi_high = max(0.0, yhat * lo_m), yhat * hi_m
    # Exact TreeSHAP via XGBoost's native predictor; last column is the bias.
    shap_top: list[dict] = []
    try:
        contribs = booster.predict(dmat, pred_contribs=True)[0]
        shap_vals = contribs[:-1]
        top = sorted(
            ({"f": names[i], "v": float(shap_vals[i])} for i in range(len(names))),
            key=lambda d: -abs(d["v"]),
        )
        shap_top = top[:6]
    except Exception as e:
        log.warning("native TreeSHAP failed: %s", e)
    return XGBPrediction(
        pred_claims_next_yr=yhat,
        pi_80=(round(pi_low, 1), round(pi_high, 1)),
        shap_top=shap_top,
        source="xgboost",
        model_version=version,
    )
