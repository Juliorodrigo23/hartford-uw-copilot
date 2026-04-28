"""Train the XGBoost loss-frequency model + SHAP explainer."""

from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ml.train_xgb import train_and_save  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


if __name__ == "__main__":
    meta = train_and_save()
    print(meta)
