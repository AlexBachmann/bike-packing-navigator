"""
engine/tests/test_utils_units.py - Unit tests for unit conversion and telemetry calculations.
"""

import pytest
from engine.utils.units import (
    km_to_miles,
    miles_to_km,
    meters_to_feet,
    feet_to_meters,
    calculate_grade,
    calculate_grade_percent,
    grade_percentage,
    EARTH_RADIUS_KM,
    EARTH_RADIUS_M,
)


@pytest.mark.unit
@pytest.mark.units
class TestUnitConversions:
    """Tests for metric/imperial distance, elevation, and grade conversions."""

    def test_geodetic_constants(self):
        assert EARTH_RADIUS_KM == 6371.0088
        assert EARTH_RADIUS_M == 6371008.8

    def test_km_miles_conversion(self):
        assert km_to_miles(0.0) == 0.0
        assert km_to_miles(100.0) == pytest.approx(62.1371, abs=0.001)
        assert miles_to_km(0.0) == 0.0
        assert miles_to_km(62.1371) == pytest.approx(100.0, abs=0.001)

    def test_km_miles_roundtrip(self):
        for val in [0.5, 12.0, 100.0, 4321.0]:
            assert miles_to_km(km_to_miles(val)) == pytest.approx(val, rel=1e-5)

    def test_meters_feet_conversion(self):
        assert meters_to_feet(0.0) == 0.0
        assert meters_to_feet(1000.0) == pytest.approx(3280.84, abs=0.01)
        assert feet_to_meters(3280.84) == pytest.approx(1000.0, abs=0.01)

    def test_calculate_grade_climb_and_descent(self):
        # 10m rise over 100m run = 10%
        assert calculate_grade(10.0, 100.0) == pytest.approx(10.0)
        # Descent
        assert calculate_grade(-15.0, 100.0) == pytest.approx(-15.0)
        # Flat
        assert calculate_grade(0.0, 100.0) == 0.0

    def test_calculate_grade_division_by_zero_protected(self):
        # Zero run must not raise ZeroDivisionError
        assert calculate_grade(10.0, 0.0) == 0.0
        assert calculate_grade(10.0, 1e-8) == 0.0

    def test_grade_aliases(self):
        assert calculate_grade_percent(10.0, 100.0) == pytest.approx(10.0)
        assert grade_percentage(10.0, 100.0) == pytest.approx(10.0)
