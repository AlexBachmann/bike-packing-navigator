"""
engine/tests/conftest.py - Shared pytest fixtures and benchmarks for Bikepack Engine.
"""

from typing import Any, Dict, List, Tuple
import pytest


@pytest.fixture(scope="session")
def geo_benchmarks() -> Dict[str, Tuple[float, float]]:
    """Verified reference coordinates for geodetic testing."""
    return {
        "null_island": (0.0, 0.0),
        "equator_1deg_e": (0.0, 1.0),
        "meridian_1deg_n": (1.0, 0.0),
        "paris": (48.8566, 2.3522),
        "london": (51.5074, -0.1278),
        "tokyo": (35.6762, 139.6503),
        "sydney": (-33.8688, 151.2093),
        "north_pole": (90.0, 0.0),
        "south_pole": (-90.0, 0.0),
        "near_pole_a": (89.9, 0.0),
        "near_pole_b": (89.9, 180.0),
        "antipodal_null": (0.0, 180.0),
    }


@pytest.fixture(scope="session")
def segment_fixtures() -> Dict[str, Any]:
    """Pre-calculated segment pairs and probe points for projection testing."""
    return {
        "horizontal": {
            "a": (42.00000, 72.00000),
            "b": (42.00000, 72.01000),
            "mid": (42.00000, 72.00500),
            "p_perp": (42.00020, 72.00500),       # ~22.2m North of mid
            "p_before": (42.00000, 71.99000),     # Before start (t < 0)
            "p_after": (42.00000, 72.02000),      # After end (t > 1)
            "p_on_segment": (42.00000, 72.00500), # Directly on segment
        },
        "vertical": {
            "a": (42.00000, 72.00000),
            "b": (42.01000, 72.00000),
            "mid": (42.00500, 72.00000),
            "p_perp": (42.00500, 72.00020),       # ~16.5m East of mid
        },
        "degenerate": {
            "a": (42.00000, 72.00000),
            "b": (42.00000, 72.00000),
            "p": (42.00100, 72.00100),
        },
    }


@pytest.fixture(scope="session")
def bbox_fixtures() -> Dict[str, Any]:
    """Test bounding boxes and probe points."""
    return {
        "standard": {
            "bbox": (37.5, -108.0, 39.5, -105.0),  # min_lat, min_lon, max_lat, max_lon
            "inside": (38.5, -106.5),
            "outside": (40.0, -106.5),
            "boundary": (37.5, -107.0),
        },
        "prime_meridian": {
            "bbox": (50.0, -1.5, 52.0, 1.5),
            "inside": (51.0, 0.0),
            "outside": (51.0, 2.0),
        },
        "equator": {
            "bbox": (-2.0, 20.0, 2.0, 24.0),
            "inside": (0.0, 22.0),
            "outside": (3.0, 22.0),
        },
        "single_point": {
            "bbox": (45.0, 10.0, 45.0, 10.0),
            "inside": (45.0, 10.0),
            "outside": (45.0001, 10.0),
        },
    }


@pytest.fixture(scope="session")
def tile_benchmarks() -> Dict[str, Any]:
    """Known coordinates and their expected slippy tile indices."""
    return {
        "zoom0": {
            "z": 0,
            "lat": 0.0,
            "lon": 0.0,
            "expected_tile": (0, 0),
            "expected_bounds": (-180.0, -85.0511287798, 180.0, 85.0511287798),
        },
        "zoom10_london": {
            "z": 10,
            "lat": 51.5074,
            "lon": -0.1278,
            "expected_tile": (511, 340),
        },
        "zoom10_paris": {
            "z": 10,
            "lat": 48.8566,
            "lon": 2.3522,
            "expected_tile": (518, 352),
        },
        "zoom14_london": {
            "z": 14,
            "lat": 51.5074,
            "lon": -0.1278,
            "expected_tile": (8186, 5448),
        },
    }


@pytest.fixture
def sample_track_points() -> List[List[float]]:
    """Synthetic 10-point route track [lat, lon, ele, cum_km, cum_mi]."""
    coords = [
        (42.000, 72.000, 1000.0),
        (42.009, 72.000, 1050.0),
        (42.018, 72.000, 1100.0),
        (42.027, 72.000, 1150.0),
        (42.036, 72.000, 1200.0),
        (42.045, 72.000, 1250.0),
        (42.054, 72.000, 1300.0),
        (42.063, 72.000, 1350.0),
        (42.072, 72.000, 1320.0),
        (42.081, 72.000, 1300.0),
    ]
    points = []
    cum_km = 0.0
    for i, (lat, lon, ele) in enumerate(coords):
        if i > 0:
            cum_km += 1.0
        cum_mi = cum_km * 0.621371
        points.append([lat, lon, ele, round(cum_km, 3), round(cum_mi, 3)])
    return points
