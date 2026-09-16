"""
engine/tests/test_utils_geo.py - Unit tests for geodetic math in engine.utils.geo.
"""

import math
import pytest
from engine.utils.geo import (
    haversine_distance,
    haversine_distance_m,
    initial_bearing,
    deflection_angle,
    bearing_to_compass,
    dist_point_to_segment_2d,
    dist_point_to_segment_m,
    densify_polyline,
    interpolate_track,
)


@pytest.mark.unit
@pytest.mark.geo
class TestHaversineDistance:
    """Tests for spherical Haversine distance calculations."""

    def test_zero_distance_identical_points(self):
        assert haversine_distance(0.0, 0.0, 0.0, 0.0) == 0.0
        assert haversine_distance_m(0.0, 0.0, 0.0, 0.0) == 0.0
        assert haversine_distance_m(45.123, -110.456, 45.123, -110.456) == 0.0

    def test_equator_one_degree_longitude(self):
        # 1 degree of longitude at Equator ~ 111.195 km
        d_km = haversine_distance(0.0, 0.0, 0.0, 1.0)
        assert d_km == pytest.approx(111.195, abs=0.01)

        d_m = haversine_distance_m(0.0, 0.0, 0.0, 1.0)
        assert d_m == pytest.approx(111195.0, abs=10.0)

    def test_paris_london_distance(self, geo_benchmarks):
        paris = geo_benchmarks["paris"]
        london = geo_benchmarks["london"]
        d_km = haversine_distance(paris[0], paris[1], london[0], london[1])
        assert d_km == pytest.approx(343.55, abs=0.5)

    def test_pole_to_pole_distance(self, geo_benchmarks):
        np = geo_benchmarks["north_pole"]
        sp = geo_benchmarks["south_pole"]
        d_km = haversine_distance(np[0], np[1], sp[0], sp[1])
        assert d_km == pytest.approx(20015.087, abs=1.0)

    def test_transpolar_path_over_north_pole(self, geo_benchmarks):
        p1 = geo_benchmarks["near_pole_a"]
        p2 = geo_benchmarks["near_pole_b"]
        d_km = haversine_distance(p1[0], p1[1], p2[0], p2[1])
        assert d_km == pytest.approx(22.239, abs=0.05)

    def test_antipodal_points_numerical_stability(self, geo_benchmarks):
        p1 = geo_benchmarks["null_island"]
        p2 = geo_benchmarks["antipodal_null"]
        # Must not crash from floating point sqrt(1 - a) with a > 1.0
        d_km = haversine_distance(p1[0], p1[1], p2[0], p2[1])
        assert d_km == pytest.approx(20015.087, abs=1.0)

    def test_km_and_m_consistency(self, geo_benchmarks):
        paris = geo_benchmarks["paris"]
        london = geo_benchmarks["london"]
        d_km = haversine_distance(paris[0], paris[1], london[0], london[1])
        d_m = haversine_distance_m(paris[0], paris[1], london[0], london[1])
        assert d_m == pytest.approx(d_km * 1000.0, rel=1e-5)

    def test_nan_coordinate_returns_nan(self):
        nan = float("nan")
        assert math.isnan(haversine_distance(nan, 0.0, 0.0, 0.0))
        assert math.isnan(haversine_distance(0.0, nan, 0.0, 0.0))
        assert math.isnan(haversine_distance(0.0, 0.0, nan, 0.0))
        assert math.isnan(haversine_distance(0.0, 0.0, 0.0, nan))
        assert math.isnan(haversine_distance(nan, nan, nan, nan))
        assert math.isnan(haversine_distance_m(nan, 0.0, 0.0, 0.0))

    def test_antimeridian_distance(self):
        # 0.002 degrees across the antimeridian at the Equator is ~222.39 meters
        d_m = haversine_distance_m(0.0, 179.999, 0.0, -179.999)
        assert d_m == pytest.approx(222.39, abs=0.5)

        # Reverse direction across antimeridian
        d_m_rev = haversine_distance_m(0.0, -179.999, 0.0, 179.999)
        assert d_m_rev == pytest.approx(222.39, abs=0.5)


@pytest.mark.unit
@pytest.mark.geo
class TestInitialBearing:
    """Tests for initial forward azimuth / bearing calculations."""

    def test_cardinal_directions(self):
        # North
        assert initial_bearing(0.0, 0.0, 1.0, 0.0) == pytest.approx(0.0, abs=1e-4)
        # East
        assert initial_bearing(0.0, 0.0, 0.0, 1.0) == pytest.approx(90.0, abs=1e-4)
        # South
        assert initial_bearing(1.0, 0.0, 0.0, 0.0) == pytest.approx(180.0, abs=1e-4)
        # West
        assert initial_bearing(0.0, 1.0, 0.0, 0.0) == pytest.approx(270.0, abs=1e-4)

    def test_intercardinal_directions(self):
        # Northeast
        assert initial_bearing(0.0, 0.0, 1.0, 1.0) == pytest.approx(45.0, abs=0.5)
        # Northwest
        assert initial_bearing(0.0, 0.0, 1.0, -1.0) == pytest.approx(315.0, abs=0.5)

    def test_normalization_and_zero_distance(self):
        # Identical points should return 0.0 cleanly
        assert initial_bearing(45.0, 10.0, 45.0, 10.0) == 0.0
        # Check bearing is always in [0.0, 360.0)
        b = initial_bearing(0.0, 0.0, -1.0, 0.0)
        assert 0.0 <= b < 360.0

    def test_compass_rose_conversion(self):
        assert bearing_to_compass(0.0) == "N"
        assert bearing_to_compass(45.0) == "NE"
        assert bearing_to_compass(90.0) == "E"
        assert bearing_to_compass(180.0) == "S"
        assert bearing_to_compass(270.0) == "W"
        assert bearing_to_compass(22.5, points=16) == "NNE"


@pytest.mark.unit
@pytest.mark.geo
class TestDeflectionAngle:
    """Tests for signed deflection angle in degrees [-180, +180]."""

    def test_straight_line(self):
        assert deflection_angle(0.0, 0.0) == 0.0
        assert deflection_angle(90.0, 90.0) == 0.0

    def test_right_turns(self):
        assert deflection_angle(0.0, 90.0) == pytest.approx(90.0)
        assert deflection_angle(90.0, 180.0) == pytest.approx(90.0)

    def test_left_turns(self):
        assert deflection_angle(0.0, 270.0) == pytest.approx(-90.0)
        assert deflection_angle(180.0, 90.0) == pytest.approx(-90.0)

    def test_wrapping_across_north(self):
        # Turn right from 350 to 20 -> +30
        assert deflection_angle(350.0, 20.0) == pytest.approx(30.0)
        # Turn left from 10 to 340 -> -30
        assert deflection_angle(10.0, 340.0) == pytest.approx(-30.0)

    def test_u_turns(self):
        assert abs(deflection_angle(0.0, 180.0)) == pytest.approx(180.0)


@pytest.mark.unit
@pytest.mark.geo
class TestDistPointToSegment:
    """Tests for perpendicular distance, projection factor, and projected coordinates."""

    def test_interior_perpendicular_projection(self, segment_fixtures):
        seg = segment_fixtures["horizontal"]
        a, b, p = seg["a"], seg["b"], seg["p_perp"]
        d, t, qlat, qlon = dist_point_to_segment_m(p[0], p[1], a[0], a[1], b[0], b[1])

        assert 0.0 < t < 1.0
        assert t == pytest.approx(0.5, abs=0.01)
        assert qlat == pytest.approx(42.00000, abs=1e-5)
        assert qlon == pytest.approx(72.00500, abs=1e-5)
        assert d == pytest.approx(22.2, abs=0.5)

    def test_clamping_before_segment_start(self, segment_fixtures):
        seg = segment_fixtures["horizontal"]
        a, b, p = seg["a"], seg["b"], seg["p_before"]
        d, t, qlat, qlon = dist_point_to_segment_m(p[0], p[1], a[0], a[1], b[0], b[1])

        assert t == 0.0
        assert qlat == pytest.approx(a[0], abs=1e-6)
        assert qlon == pytest.approx(a[1], abs=1e-6)
        expected_d = haversine_distance_m(p[0], p[1], a[0], a[1])
        assert d == pytest.approx(expected_d, abs=1.0)

    def test_clamping_after_segment_end(self, segment_fixtures):
        seg = segment_fixtures["horizontal"]
        a, b, p = seg["a"], seg["b"], seg["p_after"]
        d, t, qlat, qlon = dist_point_to_segment_m(p[0], p[1], a[0], a[1], b[0], b[1])

        assert t == 1.0
        assert qlat == pytest.approx(b[0], abs=1e-6)
        assert qlon == pytest.approx(b[1], abs=1e-6)
        expected_d = haversine_distance_m(p[0], p[1], b[0], b[1])
        assert d == pytest.approx(expected_d, abs=1.0)

    def test_degenerate_zero_length_segment(self, segment_fixtures):
        seg = segment_fixtures["degenerate"]
        a, b, p = seg["a"], seg["b"], seg["p"]
        d, t, qlat, qlon = dist_point_to_segment_m(p[0], p[1], a[0], a[1], b[0], b[1])

        assert t == 0.0
        assert qlat == pytest.approx(a[0], abs=1e-6)
        assert qlon == pytest.approx(a[1], abs=1e-6)
        assert d == pytest.approx(haversine_distance_m(p[0], p[1], a[0], a[1]), abs=0.5)

    def test_cartesian_2d_projection(self):
        # Point (50, 10) against segment (0, 0) -> (100, 0)
        d, t, qx, qy = dist_point_to_segment_2d(50.0, 10.0, 0.0, 0.0, 100.0, 0.0)
        assert d == pytest.approx(10.0)
        assert t == pytest.approx(0.5)
        assert qx == pytest.approx(50.0)
        assert qy == pytest.approx(0.0)

    def test_antimeridian_distant_point_clamped_to_segment_start(self):
        # Segment across 180° meridian: ~222m long in Fiji/Taveuni
        alat, alon = 0.0, 179.999
        blat, blon = 0.0, -179.999
        # Greenwich Observatory at (0, 0) is ~20,000 km away, NOT on the segment!
        plat, plon = 0.0, 0.0

        d, t, qlat, qlon = dist_point_to_segment_m(plat, plon, alat, alon, blat, blon)
        assert t == 0.0
        assert qlat == pytest.approx(alat, abs=1e-6)
        assert qlon == pytest.approx(alon, abs=1e-6)
        # Distance should be antipodal (~20,015 km), never 0.0m
        assert d == pytest.approx(20015000.0, abs=1000.0)

    def test_antimeridian_point_directly_on_segment(self):
        alat, alon = 0.0, 179.999
        blat, blon = 0.0, -179.999

        # Midpoint of segment is on the 180° meridian
        # Querying with plon = 180.0
        d1, t1, qlat1, qlon1 = dist_point_to_segment_m(0.0, 180.0, alat, alon, blat, blon)
        assert t1 == pytest.approx(0.5, abs=1e-3)
        assert d1 == pytest.approx(0.0, abs=0.01)
        assert qlat1 == pytest.approx(0.0, abs=1e-5)
        assert qlon1 == pytest.approx(-180.0, abs=1e-4) or qlon1 == pytest.approx(180.0, abs=1e-4)

        # Querying with plon = -180.0
        d2, t2, qlat2, qlon2 = dist_point_to_segment_m(0.0, -180.0, alat, alon, blat, blon)
        assert t2 == pytest.approx(0.5, abs=1e-3)
        assert d2 == pytest.approx(0.0, abs=0.01)
        assert qlat2 == pytest.approx(0.0, abs=1e-5)

    def test_antimeridian_perpendicular_offset(self):
        alat, alon = 0.0, 179.999
        blat, blon = 0.0, -179.999
        # Point 0.0001 deg North of antimeridian midpoint (~11.12m)
        plat, plon = 0.0001, 180.0

        d, t, qlat, qlon = dist_point_to_segment_m(plat, plon, alat, alon, blat, blon)
        assert t == pytest.approx(0.5, abs=1e-3)
        assert d == pytest.approx(11.12, abs=0.1)
        assert qlat == pytest.approx(0.0, abs=1e-5)


@pytest.mark.unit
@pytest.mark.geo
class TestTrackDensification:
    """Tests for densifying route polyline tracks."""

    def test_densify_short_segment_no_change(self):
        # Points ~50m apart with max_step_m=100m -> no new points added
        coords = [(42.0000, 72.0000), (42.0004, 72.0000)]
        densified = densify_polyline(coords, max_step_m=100.0)
        assert len(densified) == 2

    def test_densify_long_segment_subdivided(self):
        # Points ~1000m apart with max_step_m=100m -> ~10 segments created
        coords = [(42.0000, 72.0000), (42.0090, 72.0000)]
        densified = densify_polyline(coords, max_step_m=100.0)
        assert len(densified) >= 10
        # Verify no consecutive segment exceeds 100m
        for i in range(len(densified) - 1):
            seg_len = haversine_distance_m(
                densified[i][0], densified[i][1],
                densified[i + 1][0], densified[i + 1][1]
            )
            assert seg_len <= 100.5

    def test_densify_antimeridian_crossing(self):
        # 222.4m segment spanning 180° meridian with max_step_m = 100.0m
        coords = [(0.0, 179.999), (0.0, -179.999)]
        densified = densify_polyline(coords, max_step_m=100.0)

        # dist ~222.4m / 100m -> ceil = 3 steps -> 4 points
        assert len(densified) == 4
        assert densified[0] == (0.0, 179.999)
        assert densified[-1] == (0.0, -179.999)

        # Intermediate points must stay near 180° meridian, never near 0° or 60°
        for lat, lon in densified:
            assert lat == pytest.approx(0.0, abs=1e-6)
            assert abs(lon) >= 179.0

        # Verify no consecutive segment exceeds max_step_m
        for i in range(len(densified) - 1):
            seg_len = haversine_distance_m(
                densified[i][0], densified[i][1],
                densified[i + 1][0], densified[i + 1][1]
            )
            assert seg_len <= 100.5

    def test_densify_antimeridian_reverse_crossing(self):
        # Reverse direction: Westbound crossing 180° meridian
        coords = [(0.0, -179.999), (0.0, 179.999)]
        densified = densify_polyline(coords, max_step_m=100.0)

        assert len(densified) == 4
        for lat, lon in densified:
            assert abs(lon) >= 179.0
        for i in range(len(densified) - 1):
            seg_len = haversine_distance_m(
                densified[i][0], densified[i][1],
                densified[i + 1][0], densified[i + 1][1]
            )
            assert seg_len <= 100.5

    def test_densify_invalid_step_raises_value_error(self):
        coords = [(42.0, 72.0), (42.1, 72.1)]
        with pytest.raises(ValueError, match="strictly positive"):
            densify_polyline(coords, max_step_m=0.0)

        with pytest.raises(ValueError, match="strictly positive"):
            densify_polyline(coords, max_step_m=-10.0)
