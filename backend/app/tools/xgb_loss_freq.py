"""XGBoost loss-frequency predictor — exposed as a tool for the agent."""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

import numpy as np

from app.config import settings
from app.schemas import SAFERProfile, Submission, XGBPrediction

log = logging.getLogger(__name__)

ARTIFACTS = settings.artifacts_dir
MODEL_PATH = ARTIFACTS / "xgb_loss_freq.json"
EXPLAINER_PATH = ARTIFACTS / "shap_explainer.pkl"
META_PATH = ARTIFACTS / "model_meta.json"


@lru_cache(maxsize=1)
def _load_model():
    """Load XGBoost booster + SHAP explainer if present.

    Returns (booster, explainer, feature_names) or None tuple if not yet trained.
    The agent must still function before training so the eval harness can
    proceed; in that case we return a fallback predictor (Poisson at λ=0.04 × PUs).
    """
    if not MODEL_PATH.exists():
        log.info("XGBoost artifacts not present at %s — using fallback predictor", MODEL_PATH)
        return (None, None, [])
    try:
        import xgboost as xgb
        import shap

        booster = xgb.Booster()
        booster.load_model(str(MODEL_PATH))
        feat_names = []
        if META_PATH.exists():
            feat_names = json.loads(META_PATH.read_text()).get("feature_names", [])
        explainer = None
        if EXPLAINER_PATH.exists():
            import pickle

            with EXPLAINER_PATH.open("rb") as f:
                explainer = pickle.load(f)
        _ = shap  # quiet linters
        return (booster, explainer, feat_names)
    except Exception as e:
        log.exception("model load failed: %s", e)
        return (None, None, [])


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
        shap_top=[
            {"f": "oos_vehicle", "v": (safer.oos_rate_vehicle - 0.12) * 8 if safer else 0.0},
            {"f": "fleet_size", "v": float(np.log1p(sub.fleet_size) - 4)},
        ],
    )


def xgb_predict(sub: Submission, safer: SAFERProfile | None) -> XGBPrediction:
    booster, explainer, feat_names = _load_model()
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
    pi_low, pi_high = max(0.0, yhat * 0.72), yhat * 1.42  # rough analytic 80% PI
    shap_top: list[dict] = []
    try:
        if explainer is not None:
            sv = explainer(x.reshape(1, -1)).values[0]
            top = sorted(
                ({"f": names[i], "v": float(sv[i])} for i in range(len(names))),
                key=lambda d: -abs(d["v"]),
            )
            shap_top = top[:6]
    except Exception as e:
        log.warning("SHAP explanation failed: %s", e)
    return XGBPrediction(pred_claims_next_yr=yhat, pi_80=(round(pi_low, 1), round(pi_high, 1)), shap_top=shap_top)
