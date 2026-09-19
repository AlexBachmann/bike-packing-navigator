"""
engine/tests/test_guidance_mapping.py - Unit tests for dual-track canonical/guidance mapping.
"""

import pytest
from engine.core.models import RoutePoint
from engine.enrichment.places import Place, PlaceLocation
from engine.osm.snapping import SnappedGuidanceTrack, map_guidance_to_canonical


def test_route_point_to_list_7d():
    pt = RoutePoint(
        lat=34.03328,
        lon=-108.35054,
        ele=2450.5,
        cum_km=3933.213,
        cum_mi=2443.985,
        canonical_km=3855.123,
        canonical_mi=2395.456,
    )
    res = pt.to_list_7d()
    assert len(res) == 7
    assert res[0] == 34.03328
    assert res[1] == -108.35054
    assert res[2] == 2450.5
    assert res[3] == 3933.213
    assert res[4] == 2443.985
    assert res[5] == 3855.123
    assert res[6] == 2395.456


def test_route_point_to_list_7d_fallback():
    # If canonical fields are None, falls back to cum_km and cum_mi
    pt = RoutePoint(
        lat=34.0,
        lon=-108.0,
        ele=2000.0,
        cum_km=10.0,
        cum_mi=6.214,
    )
    res = pt.to_list_7d()
    assert len(res) == 7
    assert res[5] == 10.0
    assert res[6] == 6.214


def test_map_guidance_to_canonical_monotonic():
    # Canonical track: straight line going north
    # [lat, lon, ele, km, mi]
    canonical = [
        [34.00, -108.00, 1000.0, 0.0, 0.0],
        [34.01, -108.00, 1010.0, 1.11, 0.69],
        [34.02, -108.00, 1020.0, 2.22, 1.38],
        [34.03, -108.00, 1030.0, 3.33, 2.07],
        [34.04, -108.00, 1040.0, 4.45, 2.76],
    ]

    # Guidance track has extra winding points
    guidance = [
        RoutePoint(lat=34.000, lon=-108.000, ele=1000.0, cum_km=0.0, cum_mi=0.0),
        RoutePoint(lat=34.005, lon=-108.001, ele=1005.0, cum_km=0.6, cum_mi=0.37),
        RoutePoint(lat=34.010, lon=-108.000, ele=1010.0, cum_km=1.2, cum_mi=0.75),
        RoutePoint(lat=34.020, lon=-108.002, ele=1020.0, cum_km=2.4, cum_mi=1.49),
        RoutePoint(lat=34.040, lon=-108.000, ele=1040.0, cum_km=4.8, cum_mi=2.98),
    ]

    map_guidance_to_canonical(guidance, canonical)

    # All points must have canonical_km and canonical_mi set
    assert all(g.canonical_km is not None and g.canonical_mi is not None for g in guidance)

    # Monotonicity check: non-decreasing
    for i in range(len(guidance) - 1):
        assert guidance[i].canonical_mi <= guidance[i + 1].canonical_mi
        assert guidance[i].canonical_km <= guidance[i + 1].canonical_km

    # Boundary check: first is 0.0, last reaches terminus
    assert guidance[0].canonical_mi == pytest.approx(0.0, abs=0.01)
    assert guidance[-1].canonical_mi == pytest.approx(2.76, abs=0.01)


def test_snapped_guidance_track_to_dict_7d():
    pts = [
        RoutePoint(lat=34.0, lon=-108.0, ele=1000.0, cum_km=0.0, cum_mi=0.0, canonical_km=0.0, canonical_mi=0.0),
        RoutePoint(lat=34.1, lon=-108.0, ele=1100.0, cum_km=11.1, cum_mi=6.9, canonical_km=10.0, canonical_mi=6.2),
    ]
    track = SnappedGuidanceTrack(
        points=pts,
        total_km=11.1,
        total_miles=6.9,
        snapped_points_count=2,
        fallback_points_count=0
    )
    d = track.to_dict()
    assert d["total_km"] == 11.1
    assert d["total_miles"] == 6.9
    assert len(d["points"]) == 2
    assert len(d["points"][0]) == 7
    assert d["points"][1][5] == 10.0
    assert d["points"][1][6] == 6.2


def test_place_guidance_serialization():
    place = Place(
        id="test_camp",
        name="Test Campground",
        category="campground",
        type="campground",
        location=PlaceLocation(lat=34.033, lon=-108.350),
        distance_to_trail_km=0.31,
        route_km=3855.1,
        route_mile=2395.4,
        guidance_km=3933.2,
        guidance_mile=2444.0,
        guidance_distance_to_trail_km=0.09,
    )

    d = place.to_dict()
    assert d["guidance_km"] == 3933.2
    assert d["guidance_mile"] == 2444.0
    assert d["guidance_distance_to_trail_km"] == 0.09
    assert d["route_km"] == 3855.1
    assert d["route_mile"] == 2395.4

    # Deserialize back
    restored = Place.from_dict(d)
    assert restored.guidance_km == 3933.2
    assert restored.guidance_mile == 2444.0
    assert restored.guidance_distance_to_trail_km == 0.09
    assert restored.route_km == 3855.1
    assert restored.route_mile == 2395.4
