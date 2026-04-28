from datetime import date
from decimal import Decimal

from app.schemas import LossYear, Submission, VehicleMix


def test_submission_round_trip():
    sub = Submission(
        id="SUB-001",
        carrier_name="ABC Transport Inc",
        dot_number="2839412",
        fleet_size=214,
        vehicle_mix=VehicleMix(tractor=0.86, straight_truck=0.10, trailer=0.0, other=0.04),
        states_of_operation=["TX", "OK", "AR", "LA"],
        effective_date=date(2026, 5, 27),
        loss_run=[
            LossYear(year=2021, claims=8, incurred_usd=Decimal("520000")),
            LossYear(year=2022, claims=11, incurred_usd=Decimal("810000")),
        ],
        broker_email="please quote",
        commodity="general_freight",
    )
    j = sub.model_dump_json()
    assert "ABC Transport Inc" in j
    Submission.model_validate_json(j)  # round-trips cleanly


def test_vehicle_mix_normalize():
    # All fractions are bounded [0,1] at construction; normalized() rescales so the
    # totals add to 1.0 even when the inputs sum to less or more than 1.
    m = VehicleMix(tractor=0.6, straight_truck=0.6).normalized()
    assert abs(m.tractor + m.straight_truck + m.trailer + m.other - 1.0) < 1e-9
