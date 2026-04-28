"""Pure-Python loss-run analytics."""

from __future__ import annotations

from decimal import Decimal

from app.schemas import LossStats, Submission


def loss_stats(sub: Submission) -> LossStats | None:
    if not sub.loss_run:
        return LossStats(
            frequency_per_pu_per_yr=0.0,
            severity_avg_usd=Decimal("0"),
            trend_3yr_pct=0.0,
            loss_ratio_3yr=0.0,
        )
    runs = sorted(sub.loss_run, key=lambda r: r.year)
    n_yr = max(1, len(runs))
    total_claims = sum(r.claims for r in runs)
    total_incurred = sum(r.incurred_usd for r in runs)
    sev_avg = total_incurred / max(1, total_claims) if total_claims else Decimal("0")
    freq = total_claims / (sub.fleet_size * n_yr)
    # 3-year trend on claims
    last3 = runs[-3:] if len(runs) >= 3 else runs
    if len(last3) >= 2:
        first = max(1, last3[0].claims)
        last = last3[-1].claims
        years = max(1, last3[-1].year - last3[0].year)
        cagr = ((last / first) ** (1 / years) - 1) * 100
    else:
        cagr = 0.0
    # Loss ratio assumes premium ≈ $5,500 / power unit / year (industry rough median for mid-fleet auto liability).
    premium_3yr = Decimal(sub.fleet_size * 5500 * min(3, n_yr))
    loss_ratio = float(total_incurred / premium_3yr) if premium_3yr else 0.0
    return LossStats(
        frequency_per_pu_per_yr=freq,
        severity_avg_usd=sev_avg,
        trend_3yr_pct=float(cagr),
        loss_ratio_3yr=loss_ratio,
    )
