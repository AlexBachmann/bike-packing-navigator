"""
engine.utils.units - Physical constants, geodesy standards, and unit conversions.

Provides high-precision constants and pure conversion functions between
metric and imperial units for elevation, distance, and slope grade.
"""

from typing import Optional

# Physical and Geodetic Constants
EARTH_RADIUS_KM: float = 6371.0088       # IUGG mean Earth radius
EARTH_RADIUS_M: float = 6371008.8        # IUGG mean Earth radius in meters
METERS_PER_DEGREE_LAT: float = 111132.0  # WGS84 meridian meter equivalent

# Conversion Factors (Exact International Standards)
KM_TO_MILES: float = 0.621371192237334
MILES_TO_KM: float = 1.609344
METERS_TO_FEET: float = 3.280839895013123
FEET_TO_METERS: float = 0.3048


def km_to_miles(km: float, precision: Optional[int] = None) -> float:
    """
    Convert kilometers to statute miles.

    Args:
        km: Distance in kilometers.
        precision: Optional decimal places to round to.

    Returns:
        Distance in statute miles.
    """
    val = km * KM_TO_MILES
    return round(val, precision) if precision is not None else val


def miles_to_km(miles: float, precision: Optional[int] = None) -> float:
    """
    Convert statute miles to kilometers.

    Args:
        miles: Distance in statute miles.
        precision: Optional decimal places to round to.

    Returns:
        Distance in kilometers.
    """
    val = miles * MILES_TO_KM
    return round(val, precision) if precision is not None else val


def meters_to_feet(meters: float, precision: Optional[int] = None) -> float:
    """
    Convert meters to international feet.

    Args:
        meters: Elevation/length in meters.
        precision: Optional decimal places to round to.

    Returns:
        Elevation/length in feet.
    """
    val = meters * METERS_TO_FEET
    return round(val, precision) if precision is not None else val


def feet_to_meters(feet: float, precision: Optional[int] = None) -> float:
    """
    Convert international feet to meters.

    Args:
        feet: Elevation/length in feet.
        precision: Optional decimal places to round to.

    Returns:
        Elevation/length in meters.
    """
    val = feet * FEET_TO_METERS
    return round(val, precision) if precision is not None else val


def calculate_grade(rise_m: float, run_m: float) -> float:
    """
    Calculate elevation slope grade percentage.

    Args:
        rise_m: Vertical elevation change (rise) in meters.
        run_m: Horizontal distance traveled (run) in meters.

    Returns:
        Grade percentage (e.g. 10.0 for 10%). Returns 0.0 if run <= 1e-6.
    """
    if abs(run_m) <= 1e-6:
        return 0.0
    return (rise_m / run_m) * 100.0


calculate_grade_percent = calculate_grade
grade_percentage = calculate_grade
