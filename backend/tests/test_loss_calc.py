from datetime import date
from decimal import Decimal

from app.schemas import LossYear, Submission, VehicleMix
from app.tools.loss_calc import loss_stats


def test_loss_stats_basic():
    sub = Submission(
        id="x",
        carrier_name="x",
        dot_number="123",
        fleet_size=100,
        vehicle_mix=VehicleMix(tractor=1.0),
        states_of_operation=["TX"],
        effective_date=date.today(),
        loss_run=[
            LossYear(year=2020, claims=2, incurred_usd=Decimal("80000")),
            LossYear(year=2021, claims=4, incurred_usd=Decimal("280000")),
            LossYear(year=2022, claims=4, incurred_usd=Decimal("310000")),
            LossYear(year=2023, claims=5, incurred_usd=Decimal("420000")),
            LossYear(year=2024, claims=6, incurred_usd=Decimal("510000")),
        ],
        broker_email="",
    )
    s = loss_stats(sub)
    assert s is not None
    assert s.frequency_per_pu_per_yr > 0
    assert s.severity_avg_usd > 0
    assert s.trend_3yr_pct > 0  # increasing
