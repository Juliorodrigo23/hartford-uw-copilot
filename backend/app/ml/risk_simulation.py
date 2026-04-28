"""Compound-Poisson-LogNormal aggregate-loss simulation.

Used both by the eval pipeline (Monte Carlo summaries per submission) and by
the frontend export script (frozen sample arrays for the animated viz).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class SimResult:
    samples: np.ndarray
    mean: float
    var95: float
    tvar95: float
    var99: float


def aggregate_loss_distribution(
    lambda_claims: float,
    severity_mu_log: float,
    severity_sigma_log: float,
    n_sims: int = 10_000,
    seed: int = 42,
) -> SimResult:
    rng = np.random.default_rng(seed)
    counts = rng.poisson(lambda_claims, size=n_sims)
    out = np.zeros(n_sims, dtype=float)
    for i, n in enumerate(counts):
        if n:
            out[i] = float(rng.lognormal(severity_mu_log, severity_sigma_log, size=n).sum())
    sorted_ = np.sort(out)
    n = len(sorted_)
    var95 = float(sorted_[int(0.95 * (n - 1))])
    var99 = float(sorted_[int(0.99 * (n - 1))])
    tvar95 = float(sorted_[int(0.95 * n) :].mean()) if int(0.95 * n) < n else var95
    return SimResult(samples=out, mean=float(out.mean()), var95=var95, tvar95=tvar95, var99=var99)
