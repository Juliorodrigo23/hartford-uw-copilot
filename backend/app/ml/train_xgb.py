"""Train the XGBoost loss-frequency model + isotonic calibration + SHAP explainer.

Targets next-year claim count; trained as a Poisson regressor (objective=count:poisson).

Classification reporting uses the underwriting-relevant binarization
"adverse-frequency account": next-year claims ≥ ADVERSE_FREQ × power units.
(A naive "≥1 claim" target is degenerate for 20-800 unit fleets — nearly every
carrier has at least one claim.) The classifier probability is the exact
Poisson tail P(N ≥ k | rate = model prediction), and an isotonic regressor
fitted on OUT-OF-FOLD probabilities is saved alongside the booster.

Training data: `data/processed/carriers_train.parquet` when present. Public
data has no per-carrier next-year claim outcomes (that's proprietary loss
data), so when the parquet is absent we generate a clearly-labeled synthetic
frame whose feature/target structure follows published FMCSA correlations.
Everything downstream (metadata, exports, the site) discloses which one was
used — `training_data` in model_meta.json is either "parquet" or "synthetic".

Three feature ablations are trained with the same CV split so the frontend's
model-evolution visual shows REAL confusion matrices, not invented ones:
  v1: fleet size only
  v2: + SAFER inspection/crash features
  v3: full feature set + isotonic calibration
"""

from __future__ import annotations

import datetime as _dt
import json
import logging

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import GroupKFold

from app.config import settings
from app.ml.features import FEATURE_NAMES, build_feature_frame

log = logging.getLogger(__name__)

# An account is "adverse" when next-year claim frequency ≥ 5 claims / 100 PUs.
ADVERSE_FREQ = 0.05

V1_FEATURES = ["fleet_size_log"]
V2_FEATURES = [
    "fleet_size_log", "oos_vehicle", "oos_driver",
    "crashes_24mo_total", "crashes_24mo_fatal",
]
V3_FEATURES = FEATURE_NAMES


def _load_training_frame() -> tuple[pd.DataFrame, str]:
    """Returns (frame, provenance) where provenance is "parquet"|"synthetic"."""
    p = settings.data_dir / "processed" / "carriers_train.parquet"
    if p.exists():
        return pd.read_parquet(p), "parquet"
    log.warning(
        "training parquet not present at %s — generating a SYNTHETIC frame "
        "(disclosed as training_data='synthetic' in model_meta.json)", p
    )
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
    return df, "synthetic"


def _fit_one(X: pd.DataFrame, y: pd.Series, features: list[str]):
    import xgboost as xgb

    dtrain = xgb.DMatrix(X[features].values, label=y.values, feature_names=features)
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


def _oof_predictions(X: pd.DataFrame, y: pd.Series, groups: pd.Series, features: list[str]) -> np.ndarray:
    """Out-of-fold Poisson-rate predictions across a 5-fold GroupKFold."""
    import xgboost as xgb

    oof = np.zeros(len(y))
    cv = GroupKFold(n_splits=5)
    for tr, va in cv.split(X, y, groups=groups):
        booster = _fit_one(X.iloc[tr], y.iloc[tr], features)
        dva = xgb.DMatrix(X.iloc[va][features].values, feature_names=features)
        oof[va] = booster.predict(dva)
    return oof


def _binary_metrics(y_bin: np.ndarray, p_bin: np.ndarray) -> dict:
    pred_pos = p_bin >= 0.5
    tp = int(np.sum(pred_pos & (y_bin == 1)))
    fp = int(np.sum(pred_pos & (y_bin == 0)))
    fn = int(np.sum(~pred_pos & (y_bin == 1)))
    tn = int(np.sum(~pred_pos & (y_bin == 0)))
    precision = tp / max(1, tp + fp)
    recall = tp / max(1, tp + fn)
    f1 = 2 * precision * recall / max(1e-9, precision + recall)
    try:
        auc = float(roc_auc_score(y_bin, p_bin))
    except ValueError:
        auc = float("nan")
    return {
        "confusion": {"tp": tp, "fp": fp, "fn": fn, "tn": tn},
        "auc": round(auc, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "brier": round(float(brier_score_loss(y_bin, p_bin)), 4),
    }


def _calibration_bins(y_bin: np.ndarray, p_bin: np.ndarray, n_bins: int = 10) -> list[dict]:
    """Decile reliability points: mean predicted vs empirical rate per bin."""
    order = np.argsort(p_bin)
    bins = np.array_split(order, n_bins)
    out = []
    for b in bins:
        if len(b) == 0:
            continue
        out.append(
            {
                "p": round(float(p_bin[b].mean()), 4),
                "e": round(float(y_bin[b].mean()), 4),
                "n": int(len(b)),
            }
        )
    return out


def train_and_save() -> dict:
    import shap
    import xgboost as xgb
    from scipy.stats import poisson

    df, provenance = _load_training_frame()
    X = build_feature_frame(df)
    y = df["next_yr_claims"].astype(float)
    groups = df["carrier_id"]
    # Adverse-frequency binarization: k claims where k = ceil(ADVERSE_FREQ × PUs)
    k_thresh = np.ceil(ADVERSE_FREQ * df["fleet_size"].to_numpy()).astype(int)
    y_bin = (y.to_numpy() >= k_thresh).astype(int)
    settings.artifacts_dir.mkdir(parents=True, exist_ok=True)

    def tail_prob(rate: np.ndarray) -> np.ndarray:
        """Exact Poisson tail P(N ≥ k | rate)."""
        return poisson.sf(k_thresh - 1, mu=np.maximum(1e-9, rate))

    # --- Version ablations with real out-of-fold metrics ------------------
    versions = []
    p_raw: np.ndarray | None = None
    for name, feats, label in (
        ("v1", V1_FEATURES, "v1 · baseline · fleet size only"),
        ("v2", V2_FEATURES, "v2 · + SAFER inspection/crash features"),
        ("v3", V3_FEATURES, "v3 · full features + isotonic calibration"),
    ):
        oof = _oof_predictions(X, y, groups, feats)
        p_bin = tail_prob(oof)
        if name == "v3":
            p_raw = p_bin.copy()
            iso = IsotonicRegression(out_of_bounds="clip")
            p_bin = iso.fit_transform(p_bin, y_bin)
        versions.append({"name": label, **_binary_metrics(y_bin, p_bin)})
        log.info("version %s: %s", name, versions[-1])

    # --- Isotonic calibrator for the production model (from OOF preds) ----
    assert p_raw is not None
    calibrator = IsotonicRegression(out_of_bounds="clip").fit(p_raw, y_bin)
    p_cal = calibrator.predict(p_raw)
    calibration = {
        "raw": _calibration_bins(y_bin, p_raw),
        "calibrated": _calibration_bins(y_bin, p_cal),
        "brier_raw": round(float(brier_score_loss(y_bin, p_raw)), 4),
        "brier_calibrated": round(float(brier_score_loss(y_bin, p_cal)), 4),
    }

    # --- Fold-level CV metrics for the full model --------------------------
    cv = GroupKFold(n_splits=5)
    fold_metrics: list[dict] = []
    for i, (tr, va) in enumerate(cv.split(X, y, groups=groups)):
        booster = _fit_one(X.iloc[tr], y.iloc[tr], V3_FEATURES)
        dva = xgb.DMatrix(X.iloc[va][V3_FEATURES].values, feature_names=V3_FEATURES)
        yhat = booster.predict(dva)
        yb = y_bin[va]
        pb = poisson.sf(k_thresh[va] - 1, mu=np.maximum(1e-9, yhat))
        try:
            auc = float(roc_auc_score(yb, pb))
        except ValueError:
            auc = float("nan")
        fold_metrics.append(
            {"fold": i, "brier": float(brier_score_loss(yb, pb)), "auc": auc}
        )

    # --- Empirical 80% PI multipliers from OOF count residuals -------------
    # ratio = actual / predicted on out-of-fold rate predictions; the 10th
    # and 90th percentile ratios become the interval multipliers used at
    # inference (replacing a previously hardcoded 0.72/1.42 pair).
    oof_rate = _oof_predictions(X, y, groups, V3_FEATURES)
    mask = oof_rate > 0.5
    ratios = (y.to_numpy()[mask] + 0.5) / (oof_rate[mask] + 0.5)  # +0.5: count smoothing
    pi80 = [round(float(np.quantile(ratios, 0.10)), 3), round(float(np.quantile(ratios, 0.90)), 3)]

    # --- Final fit on all data + artifacts ---------------------------------
    booster = _fit_one(X, y, V3_FEATURES)
    booster.save_model(str(settings.artifacts_dir / "xgb_loss_freq.json"))

    # Calibrator persisted as plain JSON breakpoints (np.interp reconstructs
    # it), and NO pickled SHAP explainer: pickles of numba-backed objects
    # break across Python versions; the inference path builds TreeExplainer
    # from the booster at load time instead.
    (settings.artifacts_dir / "isotonic_calibrator.json").write_text(json.dumps({
        "x": [float(v) for v in calibrator.X_thresholds_],
        "y": [float(v) for v in calibrator.y_thresholds_],
    }))
    for stale in ("isotonic_calibrator.pkl", "shap_explainer.pkl"):
        (settings.artifacts_dir / stale).unlink(missing_ok=True)

    explainer = shap.TreeExplainer(booster)

    # Global importance: mean |SHAP| over a training sample
    sample = X[V3_FEATURES].sample(n=min(500, len(X)), random_state=0)
    sv = explainer(sample.values)
    global_importance = sorted(
        (
            {"name": V3_FEATURES[i], "v": round(float(np.abs(sv.values[:, i]).mean()), 4)}
            for i in range(len(V3_FEATURES))
        ),
        key=lambda d: -d["v"],
    )

    version = f"v3-isotonic-{_dt.date.today().isoformat()}"
    meta = {
        "version": version,
        "training_data": provenance,
        "feature_names": V3_FEATURES,
        "cv_metrics": fold_metrics,
        "n_train": int(len(df)),
        "model_versions": versions,
        "calibration": calibration,
        "global_importance": global_importance,
        "base_value": round(float(np.asarray(sv.base_values).mean()), 4),
        "pi80_multipliers": pi80,
    }
    (settings.artifacts_dir / "model_meta.json").write_text(json.dumps(meta, indent=2))
    log.info("xgb model saved · version=%s data=%s", version, provenance)
    return meta


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    train_and_save()
