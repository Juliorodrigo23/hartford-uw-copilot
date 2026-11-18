"""Pure-Python loss-run analytics."""

from __future__ import annotations

from decimal import Decimal

from langsmith import traceable

from app.schemas import LossStats, Submission

# Rough industry median premium for mid-fleet commercial auto liability.
# Surfaced on LossStats (assumed_premium_per_pu_usd) so downstream consumers
# and the memo itself can disclose the assumption behind the loss ratio.
ASSUMED_PREMIUM_PER_PU_USD = 5500


@traceable(name="loss_calc", run_type="tool")
def loss_stats(sub: Submission) -> LossStats | None:
    """Frequency / severity / trend / loss ratio from the loss run.

    Returns None when there is no loss run at all: an absent loss history is
    materially different from a clean one, and the memo must say "no loss
    runs provided" rather than reporting zeros as if they were computed.
    """
    if not sub.loss_run:
        return None
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
    premium_3yr = Decimal(sub.fleet_size * ASSUMED_PREMIUM_PER_PU_USD * min(3, n_yr))
    incurred_last3 = sum(r.incurred_usd for r in last3)
    loss_ratio = float(incurred_last3 / premium_3yr) if premium_3yr else 0.0
    return LossStats(
        frequency_per_pu_per_yr=freq,
        severity_avg_usd=sev_avg,
        trend_3yr_pct=float(cagr),
        loss_ratio_3yr=loss_ratio,
        assumed_premium_per_pu_usd=ASSUMED_PREMIUM_PER_PU_USD,
        n_years=n_yr,
    )
