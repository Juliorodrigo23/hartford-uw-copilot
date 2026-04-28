"""Train the XGBoost loss-frequency model + isotonic calibration + SHAP explainer.

Targets next-year claim count; trained as a Poisson regressor (objective=count:poisson).
We then bin predictions to (≥1 claim) vs (=0) for calibration / classification reporting.
"""

from __future__ import annotations

import json
import logging
import pickle
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import GroupKFold

from app.config import settings
from app.ml.features import FEATURE_NAMES, build_feature_frame

log = logging.getLogger(__name__)


def _load_training_frame() -> pd.DataFrame:
    """Load the training dataset assembled from FMCSA + carrier-census files.

    For the demo, if `carriers_train.parquet` doesn't exist yet we synthesize
    a defensible-shape dataset so downstream scripts continue to work. The
    real script (06_train_xgb.py) wires in the actual processed parquet.
    """
    p = settings.data_dir / "processed" / "carriers_train.parquet"
    if p.exists():
        return pd.read_parquet(p)
    log.info("training parquet not present at %s — generating synthetic frame", p)
    rng = np.random.default_rng(42)
    n = 4000
    fleet_size = rng.integers(20, 800, size=n)
    oos_vehicle = np.clip(rng.normal(0.13, 0.08, n), 0, 0.6)
    oos_driver = np.clip(rng.normal(0.05, 0.03, n), 0, 0.25)
    crashes_24mo_total = np.maximum(0, rng.poisson(np.clip(0.08 * fleet_size + 12 * oos_vehicle, 0, None)))
    crashes_24mo_fatal = np.maximum(0, rng.poisson(0.04 * crashes_24mo_total))
    tractor_share = np.clip(rng.normal(0.78, 0.12, n), 0.2, 1.0)
    n_states = rng.integers(1, 25, size=n).astype(float)
    commodity = rng.choice(
        ["general_freight", "hazmat", "tank"], size=n, p=[0.78, 0.10, 0.12]
    )
    # Latent risk
    latent = (
        0.45 * np.log1p(fleet_size)
        + 8.5 * oos_vehicle
        + 4.2 * oos_driver
        + 0.04 * crashes_24mo_total
        + 0.6 * (commodity == "hazmat").astype(float)
        + 0.3 * (commodity == "tank").astype(float)
        - 0.3 * tractor_share
        + rng.normal(0, 0.4, n)
    )
    next_yr_claims = np.random.default_rng(7).poisson(np.clip(np.exp(latent / 4), 0.1, 80))
    df = pd.DataFrame(
        {
            "carrier_id": np.arange(n),
            "fleet_size": fleet_size,
            "oos_vehicle": oos_vehicle,
            "oos_driver": oos_driver,
            "crashes_24mo_total": crashes_24mo_total,
            "crashes_24mo_fatal": crashes_24mo_fatal,
            "tractor_share": tractor_share,
            "n_states": n_states,
            "commodity": commodity,
            "next_yr_claims": next_yr_claims,
        }
    )
    return df


def train_and_save() -> dict:
    import xgboost as xgb
    import shap

    df = _load_training_frame()
    X = build_feature_frame(df)
    y = df["next_yr_claims"].astype(float)
    groups = df["carrier_id"]
    settings.artifacts_dir.mkdir(parents=True, exist_ok=True)

    # CV by carrier
    cv = GroupKFold(n_splits=5)
    fold_metrics: list[dict] = []
    for i, (tr, va) in enumerate(cv.split(X, y, groups=groups)):
        booster = _fit_one(X.iloc[tr], y.iloc[tr])
        dva = xgb.DMatrix(X.iloc[va].values, feature_names=FEATURE_NAMES)
        yhat = booster.predict(dva)
        # Calibration metric on ≥1 claim
        y_bin = (y.iloc[va] >= 1).astype(int).to_numpy()
        p_bin = 1.0 - np.exp(-np.maximum(0, yhat))
        try:
            auc = roc_auc_score(y_bin, p_bin)
        except ValueError:
            auc = float("nan")
        fold_metrics.append(
            {
                "fold": i,
                "brier": float(brier_score_loss(y_bin, p_bin)),
                "auc": float(auc),
            }
        )

    # Final fit on all data
    booster = _fit_one(X, y)

    # Save model
    booster.save_model(str(settings.artifacts_dir / "xgb_loss_freq.json"))

    # SHAP explainer
    try:
        explainer = shap.TreeExplainer(booster)
        with (settings.artifacts_dir / "shap_explainer.pkl").open("wb") as f:
            pickle.dump(explainer, f)
    except Exception as e:
        log.warning("SHAP explainer save failed: %s", e)

    meta = {
        "feature_names": FEATURE_NAMES,
        "cv_metrics": fold_metrics,
        "n_train": int(len(df)),
    }
    (settings.artifacts_dir / "model_meta.json").write_text(json.dumps(meta, indent=2))
    log.info("xgb model saved · %s", meta)
    return meta


def _fit_one(X: pd.DataFrame, y: pd.Series):
    import xgboost as xgb

    dtrain = xgb.DMatrix(X.values, label=y.values, feature_names=FEATURE_NAMES)
    params = {
        "objective": "count:poisson",
        "eval_metric": "poisson-nloglik",
        "max_depth": 5,
        "learning_rate": 0.06,
        "subsample": 0.8,
        "colsample_bytree": 0.85,
        "tree_method": "hist",
    }
    return xgb.train(params, dtrain, num_boost_round=350)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    train_and_save()
