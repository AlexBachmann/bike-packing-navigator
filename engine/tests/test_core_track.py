"""
engine/tests/test_core_track.py - Comprehensive unit tests for route telemetry and track operations.
"""

import math
import pytest

from engine.core.models import RoutePoint
from engine.core.track import (
    ProjectionResult,
    TrackTelemetry,
    build_track_points,
    calculate_elevation_gain_loss,
    calculate_point_grades,
    calculate_segment_grade,
    compute_track_bounding_box,
    compute_track_telemetry,
    find_nearest_track_point,
    project_point_to_track_segment,
    sample_elevation_profile,
    slice_track_by_km,
    smooth_elevations,
)
from engine.utils.spatial import TrackIndex


class TestBuildTrackPoints:
    def test_build_empty_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="must not be empty"):
            build_track_points([])

    def test_build_single_point_zero_distance(self) -> None:
        pts = build_track_points([(34.0, -111.0, 1000.0)])
        assert len(pts) == 1
        assert pts[0].cum_km == 0.0
        assert pts[0].cum_mi == 0.0
        assert pts[0].ele == 1000.0

    def test_build_two_points_distance_and_miles(self) -> None:
        # ~11.1 km North
        pts = build_track_points([
            (34.0, -111.0, 1000.0),
            (34.1, -111.0, 1050.0)
        ])
        assert len(pts) == 2
        assert pts[0].cum_km == 0.0
        assert 11.0 < pts[1].cum_km < 11.3
        assert 6.8 < pts[1].cum_mi < 7.1

    def test_build_monotonic_cumulative_distance(self) -> None:
        coords = [(34.0 + i * 0.01, -111.0, 1000.0 + i * 10) for i in range(10)]
        pts = build_track_points(coords)
        for i in range(1, len(pts)):
            assert pts[i].cum_km > pts[i - 1].cum_km
            assert pts[i].cum_mi > pts[i - 1].cum_mi

    def test_coordinate_and_elevation_precision_rounding(self) -> None:
        pts = build_track_points([(34.123456789, -111.987654321, 1234.5678)])
        assert pts[0].lat == 34.123457
        assert pts[0].lon == -111.987654
        assert pts[0].ele == 1234.6


class TestSmoothElevations:
    def test_empty_and_single_point_smoothing(self) -> None:
        assert smooth_elevations([]) == []
        assert smooth_elevations([1500.0]) == [1500.0]

    def test_centered_moving_average_constant_signal(self) -> None:
        elevs = [1000.0] * 10
        smoothed = smooth_elevations(elevs, window_size=5, method="centered_moving_average")
        assert len(smoothed) == 10
        for e in smoothed:
            assert abs(e - 1000.0) < 1e-6

    def test_centered_moving_average_noise_reduction(self) -> None:
        # Alternating noise around 1000m
        elevs = [1000.0 + (2.0 if i % 2 == 0 else -2.0) for i in range(20)]
        smoothed = smooth_elevations(elevs, window_size=5, method="centered_moving_average")
        # Middle values should be close to 1000.0
        for e in smoothed[2:-2]:
            assert abs(e - 1000.0) < 1.0

    def test_ema_smoothing_zero_phase(self) -> None:
        elevs = [1000.0 + i * 10.0 for i in range(15)]
        smoothed = smooth_elevations(elevs, window_size=5, method="ema")
        assert len(smoothed) == 15
        # In the middle of the linear ramp, zero phase shift produces virtually zero delay
        mid = len(elevs) // 2
        assert abs(smoothed[mid] - elevs[mid]) < 2.0

    def test_invalid_smoothing_method_or_window_size(self) -> None:
        with pytest.raises(ValueError, match="window_size must be >= 1"):
            smooth_elevations([1000.0], window_size=0)
        with pytest.raises(ValueError, match="Unknown smoothing method"):
            smooth_elevations([1000.0, 1010.0], method="fourier")


class TestCalculateElevationGainLoss:
    def test_flat_constant_elevation_zero_gain_loss(self) -> None:
        elevs = [1500.0] * 50
        gain, loss = calculate_elevation_gain_loss(elevs)
        assert gain == 0.0
        assert loss == 0.0

    def test_pure_monotonic_climb(self) -> None:
        elevs = [1000.0 + i * 10.0 for i in range(51)]  # 1000 -> 1500m
        gain, loss = calculate_elevation_gain_loss(elevs)
        assert gain == 500.0
        assert loss == 0.0

    def test_pure_monotonic_descent(self) -> None:
        elevs = [1500.0 - i * 10.0 for i in range(51)]  # 1500 -> 1000m
        gain, loss = calculate_elevation_gain_loss(elevs)
        assert gain == 0.0
        assert loss == 500.0

    def test_high_frequency_noise_below_threshold_zero_gain(self) -> None:
        # Flutter of +/- 1.2m around 1000m (total amplitude 2.4m < 3.0m threshold)
        elevs = [1000.0 + (1.2 if i % 2 == 0 else -1.2) for i in range(100)]
        gain, loss = calculate_elevation_gain_loss(elevs, threshold_m=3.0)
        assert gain == 0.0
        assert loss == 0.0

    def test_sustained_climb_with_noise_dips(self) -> None:
        # Profile: 1000 -> 1050 -> 1048 -> 1100 -> 1098 -> 1200 -> 1197 -> 1300m
        # Dips are 2m, 2m, 3m (all <= 3.0m threshold)
        elevs = [1000.0, 1050.0, 1048.0, 1100.0, 1098.0, 1200.0, 1197.0, 1300.0]
        gain, loss = calculate_elevation_gain_loss(elevs, threshold_m=3.0)
        assert gain == 300.0
        assert loss == 0.0

    def test_roller_coaster_multiple_hills_and_valleys(self) -> None:
        # 1000 -> 1200 (+200) -> 1100 (-100) -> 1350 (+250) -> 1250 (-100) -> 1400 (+150)
        elevs = [1000.0, 1200.0, 1100.0, 1350.0, 1250.0, 1400.0]
        gain, loss = calculate_elevation_gain_loss(elevs, threshold_m=3.0)
        assert gain == 600.0
        assert loss == 200.0
        assert (gain - loss) == 400.0

    def test_conservation_of_elevation_change_invariant(self) -> None:
        elevs = [500.0, 800.0, 600.0, 1100.0, 900.0, 1300.0]
        gain, loss = calculate_elevation_gain_loss(elevs, threshold_m=3.0)
        net_change = elevs[-1] - elevs[0]
        assert (gain - loss) == net_change

    def test_pre_filtering_window_integration(self) -> None:
        elevs = [1000.0 + (3.5 if i % 2 == 0 else -3.5) for i in range(30)]
        # Without pre-filtering, 3.5m amplitude might cross 3.0m threshold
        gain_raw, _ = calculate_elevation_gain_loss(elevs, threshold_m=3.0, smooth_window=0)
        # With pre-filtering (window=5), the alternating spikes are averaged away
        gain_smoothed, loss_smoothed = calculate_elevation_gain_loss(elevs, threshold_m=3.0, smooth_window=5)
        assert gain_smoothed == 0.0
        assert loss_smoothed == 0.0


class TestComputeTrackTelemetry:
    def test_empty_points_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="points sequence must not be empty"):
            compute_track_telemetry([])

    def test_telemetry_synthetic_sample_track(self, sample_track_points: list) -> None:
        telemetry = compute_track_telemetry(sample_track_points, threshold_m=3.0)
        assert isinstance(telemetry, TrackTelemetry)
        assert telemetry.total_km == 9.0
        assert telemetry.point_count == 10
        assert telemetry.highest_elevation_m == 1350
        assert telemetry.lowest_elevation_m == 1000
        assert telemetry.highest_coords == (42.063, 72.0)
        assert telemetry.lowest_coords == (42.0, 72.0)
        assert telemetry.start_coordinates == (42.0, 72.0)
        assert telemetry.end_coordinates == (42.081, 72.0)
        assert len(telemetry.bounds) == 2

    def test_to_dict_schema_conformity(self, sample_track_points: list) -> None:
        telemetry = compute_track_telemetry(sample_track_points)
        d = telemetry.to_dict()
        required_keys = {
            "total_km", "total_miles", "elevation_gain_m", "elevation_gain_ft",
            "elevation_loss_m", "elevation_loss_ft", "highest_elevation_m",
            "highest_elevation_ft", "lowest_elevation_m", "lowest_elevation_ft",
            "highest_coords", "lowest_coords", "start_coordinates",
            "end_coordinates", "bounds", "point_count"
        }
        for k in required_keys:
            assert k in d, f"Missing key {k} in telemetry dict"


class TestGradeCalculations:
    def test_calculate_segment_grade_flat(self) -> None:
        assert calculate_segment_grade(1000.0, 1000.0, 100.0) == 0.0

    def test_calculate_segment_grade_climb_and_descent(self) -> None:
        # 10m rise over 100m run = 10.0%
        assert calculate_segment_grade(1000.0, 1010.0, 100.0) == 10.0
        # 10m drop over 100m run = -10.0%
        assert calculate_segment_grade(1010.0, 1000.0, 100.0) == -10.0

    def test_calculate_segment_grade_zero_length(self) -> None:
        assert calculate_segment_grade(1000.0, 1010.0, 0.0) == 0.0

    def test_point_grades_smooth_window(self) -> None:
        # 10 points spaced by 10m, climbing 1m each -> 10% grade
        pts = []
        for i in range(10):
            km = i * 0.01
            pts.append([34.0, -111.0, 1000.0 + i * 1.0, km, km * 0.621371])
        grades = calculate_point_grades(pts, window_m=40.0)
        assert len(grades) == 10
        for g in grades:
            assert 9.0 <= g <= 11.0

    def test_point_grades_clamped_extremes(self) -> None:
        # Extreme vertical step: 100m rise over 10m run = 1000% -> clamped to 50.0%
        pts = [
            [34.0, -111.0, 1000.0, 0.0, 0.0],
            [34.0001, -111.0, 1100.0, 0.01, 0.006]
        ]
        grades = calculate_point_grades(pts, window_m=20.0)
        assert grades[0] == 50.0
        assert grades[1] == 50.0


class TestSliceTrackByKm:
    def test_slice_start_greater_than_end_raises(self, sample_track_points: list) -> None:
        with pytest.raises(ValueError, match="must be strictly less than"):
            slice_track_by_km(sample_track_points, start_km=5.0, end_km=3.0)

    def test_slice_negative_start_raises(self, sample_track_points: list) -> None:
        with pytest.raises(ValueError, match="start_km must be >= 0.0"):
            slice_track_by_km(sample_track_points, start_km=-1.0, end_km=3.0)

    def test_slice_exact_point_boundaries(self, sample_track_points: list) -> None:
        sliced = slice_track_by_km(sample_track_points, start_km=2.0, end_km=5.0)
        assert len(sliced) == 4
        assert sliced[0].cum_km == 2.0
        assert sliced[-1].cum_km == 5.0

    def test_slice_interpolated_boundary_points(self, sample_track_points: list) -> None:
        # sample_track_points has points at km 0, 1, 2, 3, 4, 5, 6, 7, 8, 9
        # Slice from 2.5 to 6.2 km
        sliced = slice_track_by_km(sample_track_points, start_km=2.5, end_km=6.2)
        assert len(sliced) == 6
        assert sliced[0].cum_km == 2.5
        assert sliced[-1].cum_km == 6.2
        # Intermediate points: 3.0, 4.0, 5.0, 6.0
        assert sliced[1].cum_km == 3.0
        assert sliced[4].cum_km == 6.0

    def test_slice_reset_distance_flag(self, sample_track_points: list) -> None:
        sliced = slice_track_by_km(sample_track_points, start_km=2.5, end_km=6.2, reset_distance=True)
        assert sliced[0].cum_km == 0.0
        assert sliced[1].cum_km == 0.5
        assert sliced[-1].cum_km == 3.7


class TestNearestPointAndProjection:
    def test_find_nearest_track_point_exact_vertex(self, sample_track_points: list) -> None:
        # Point 3 in sample_track_points is at (42.027, 72.0)
        idx, dist_m, cum_km = find_nearest_track_point(sample_track_points, 42.027, 72.0)
        assert idx == 3
        assert dist_m < 1.0
        assert cum_km == 3.0

    def test_find_nearest_track_point_with_track_index(self, sample_track_points: list) -> None:
        t_index = TrackIndex(sample_track_points)
        idx, dist_m, cum_km = find_nearest_track_point(sample_track_points, 42.027, 72.0, track_index=t_index)
        assert idx == 3
        assert dist_m < 1.0
        assert cum_km == 3.0

    def test_project_point_to_track_segment_perpendicular(self) -> None:
        # Track running North: (42.000, 72.000) to (42.010, 72.000)
        pts = [
            [42.000, 72.000, 1000.0, 0.0, 0.0],
            [42.010, 72.000, 1000.0, 1.11, 0.69]
        ]
        # Query point perpendicular to midpoint (42.005, 72.002) ~16.5m East
        proj = project_point_to_track_segment(pts, 42.005, 72.0002)
        assert isinstance(proj, ProjectionResult)
        assert 15.0 < proj.distance_m < 18.0
        assert abs(proj.projected_lat - 42.005) < 1e-4
        assert abs(proj.projected_lon - 72.000) < 1e-4
        assert 0.5 < proj.cumulative_km < 0.6

    def test_project_point_to_track_segment_with_track_index_within_radius(self) -> None:
        pts = [
            [42.000, 72.000, 1000.0, 0.0, 0.0],
            [42.010, 72.000, 1000.0, 1.11, 0.69]
        ]
        t_index = TrackIndex(pts)
        proj_indexed = project_point_to_track_segment(
            pts, 42.005, 72.0002, search_radius_m=1000.0, track_index=t_index
        )
        proj_unindexed = project_point_to_track_segment(pts, 42.005, 72.0002)

        assert isinstance(proj_indexed, ProjectionResult)
        assert 15.0 < proj_indexed.distance_m < 18.0
        assert abs(proj_indexed.projected_lat - 42.005) < 1e-4
        assert abs(proj_indexed.projected_lon - 72.000) < 1e-4
        assert 0.5 < proj_indexed.cumulative_km < 0.6
        assert proj_indexed.segment_index == 0
        assert abs(proj_indexed.distance_m - proj_unindexed.distance_m) < 1e-3
        assert abs(proj_indexed.cumulative_km - proj_unindexed.cumulative_km) < 1e-3

    def test_project_point_to_track_segment_with_track_index_beyond_radius(self) -> None:
        pts = [
            [42.000, 72.000, 1000.0, 0.0, 0.0],
            [42.010, 72.000, 1000.0, 1.11, 0.69]
        ]
        t_index = TrackIndex(pts)
        proj_indexed = project_point_to_track_segment(
            pts, 42.005, 72.0002, search_radius_m=100.0, track_index=t_index
        )
        proj_unindexed = project_point_to_track_segment(pts, 42.005, 72.0002)

        assert isinstance(proj_indexed, ProjectionResult)
        assert 15.0 < proj_indexed.distance_m < 18.0
        assert abs(proj_indexed.projected_lat - 42.005) < 1e-4
        assert abs(proj_indexed.projected_lon - 72.000) < 1e-4
        assert 0.5 < proj_indexed.cumulative_km < 0.6
        assert proj_indexed.segment_index == 0
        assert abs(proj_indexed.distance_m - proj_unindexed.distance_m) < 1e-3
        assert abs(proj_indexed.cumulative_km - proj_unindexed.cumulative_km) < 1e-3

    def test_project_point_to_track_segment_far_off_track_with_index(self) -> None:
        pts = [
            [42.000, 72.000, 1000.0, 0.0, 0.0],
            [42.010, 72.000, 1000.0, 1.11, 0.69]
        ]
        t_index = TrackIndex(pts)
        proj_indexed = project_point_to_track_segment(
            pts, 42.005, 72.0600, search_radius_m=1000.0, track_index=t_index
        )
        proj_unindexed = project_point_to_track_segment(pts, 42.005, 72.0600)

        assert 4900.0 < proj_indexed.distance_m < 5050.0
        assert abs(proj_indexed.projected_lat - 42.005) < 1e-4
        assert abs(proj_indexed.projected_lon - 72.000) < 1e-4
        assert 0.5 < proj_indexed.cumulative_km < 0.6
        assert proj_indexed.segment_index == 0
        # Verify continuous projection: must NOT snap to vertex 0 (42.000) or vertex 1 (42.010)
        assert abs(proj_indexed.projected_lat - pts[0][0]) > 0.004
        assert abs(proj_indexed.projected_lat - pts[1][0]) > 0.004
        assert abs(proj_indexed.distance_m - proj_unindexed.distance_m) < 1e-3

    def test_project_point_to_track_segment_multi_point_dense_track(self, sample_track_points: list) -> None:
        t_index = TrackIndex(sample_track_points)
        proj_indexed = project_point_to_track_segment(
            sample_track_points, 42.0405, 72.0003, search_radius_m=1000.0, track_index=t_index
        )
        proj_unindexed = project_point_to_track_segment(sample_track_points, 42.0405, 72.0003)

        assert proj_indexed.segment_index == 4
        assert abs(proj_indexed.distance_m - proj_unindexed.distance_m) < 1e-3
        assert abs(proj_indexed.cumulative_km - 4.5) < 1e-3
        assert abs(proj_indexed.projected_lat - 42.0405) < 1e-4
        assert abs(proj_indexed.projected_lon - 72.000) < 1e-4


class TestSampleElevationProfile:
    def test_sample_profile_endpoint_values(self, sample_track_points: list) -> None:
        profile = sample_elevation_profile(sample_track_points, num_samples=10)
        assert len(profile) == 10
        assert profile[0][0] == 0.0
        assert profile[0][1] == 1000.0
        assert profile[-1][0] == 9.0
        assert profile[-1][1] == 1300.0

    def test_sample_profile_monotonic_distance_steps(self, sample_track_points: list) -> None:
        profile = sample_elevation_profile(sample_track_points, num_samples=20)
        assert len(profile) == 20
        for i in range(1, len(profile)):
            assert profile[i][0] > profile[i - 1][0]

    def test_sample_profile_invalid_samples_raises(self, sample_track_points: list) -> None:
        with pytest.raises(ValueError, match="num_samples must be at least 2"):
            sample_elevation_profile(sample_track_points, num_samples=1)
