"""
engine/tests/test_osm_snapping.py - Comprehensive unit tests for OSM road snapping,
off-road fallback, bikepacking preference, bearing alignment, and Sequence Protocol.

Contains 35 test cases:
- 20 ported from .agents/skills/ingest-gpx-route/scripts/test_snap_route_to_osm.py
- 15 expanded tests for 50m boundary, fallback, bearing alignment, private access,
  and Sequence Protocol integration.
"""

import math
from pathlib import Path
from unittest.mock import patch
import pytest

from engine.core.models import BoundingBox, RoutePoint, RouteTrack
from engine.osm.network import CLASS_PENALTIES, OsmRoadNetwork
from engine.osm.snapping import (
    CandidateProjection,
    SnappedGuidanceTrack,
    SnappingConfig,
    calculate_bearing_deflection,
    compute_transition_cost,
    find_candidates_for_point,
    score_candidate,
    snap_track_to_osm,
)
from engine.utils.geo import dist_point_to_segment_m, haversine_distance_m


# -----------------------------------------------------------------------------
# Group 1: Geometric Projections & Math (Ported 1-3)
# -----------------------------------------------------------------------------

class TestDistPointToSegment:
    """Tests geometric projection and perpendicular distance calculation."""

    def test_perpendicular_projection_on_segment(self):
        # Segment from (0, 0) to (0, 1) in local meters approximation
        # Point at 50m East, 10m North of start
        plat = 10.0 / 111132.0
        plon = 50.0 / 111132.0
        alat, alon = 0.0, 0.0
        blat, blon = 0.0, 100.0 / 111132.0

        d, t, qlat, qlon = dist_point_to_segment_m(plat, plon, alat, alon, blat, blon)
        assert d == pytest.approx(10.0, abs=0.5)
        assert t == pytest.approx(0.5, abs=0.01)
        assert qlat == pytest.approx(0.0, abs=1e-5)
        assert qlon == pytest.approx(plon, abs=1e-5)

    def test_clamp_before_segment_start(self):
        plat = 10.0 / 111132.0
        plon = -20.0 / 111132.0
        alat, alon = 0.0, 0.0
        blat, blon = 0.0, 100.0 / 111132.0

        d, t, qlat, qlon = dist_point_to_segment_m(plat, plon, alat, alon, blat, blon)
        assert t == 0.0
        assert qlat == alat
        assert qlon == alon

    def test_clamp_after_segment_end(self):
        plat = 10.0 / 111132.0
        plon = 120.0 / 111132.0
        alat, alon = 0.0, 0.0
        blat, blon = 0.0, 100.0 / 111132.0

        d, t, qlat, qlon = dist_point_to_segment_m(plat, plon, alat, alon, blat, blon)
        assert t == 1.0
        assert qlat == blat
        assert qlon == blon


# -----------------------------------------------------------------------------
# Group 2: 50m Threshold & Off-Road Fallback (Ported 4-5, Expanded 21-23)
# -----------------------------------------------------------------------------

class TestSnappingThresholdAndFallback:
    """Verifies the 50m threshold behavior and off-road fallback."""

    @pytest.fixture
    def mock_network(self):
        net = OsmRoadNetwork()
        net.add_way({
            "class": "track",
            "coords": [(42.00000, 72.00000), (42.00000, 72.01000)]
        })
        return net

    def test_point_within_50m_snaps_to_road(self, mock_network):
        # 25 meters north of the road
        lat = 42.00000 + (25.0 / 111132.0)
        lon = 72.00500
        cands = find_candidates_for_point(mock_network, lat, lon, threshold_m=50.0)

        best = cands[0]
        assert not best["is_fallback"]
        assert best["way_idx"] == 0
        assert best["proj_lat"] == pytest.approx(42.00000, abs=1e-4)
        assert best["dist_m"] == pytest.approx(25.0, abs=1.0)

    def test_point_beyond_50m_falls_back_to_raw_coords(self, mock_network):
        # 65 meters north of the road
        lat = 42.00000 + (65.0 / 111132.0)
        lon = 72.00500
        cands = find_candidates_for_point(mock_network, lat, lon, threshold_m=50.0)

        assert len(cands) == 1
        assert cands[0]["is_fallback"] is True
        assert cands[0]["proj_lat"] == pytest.approx(lat, abs=1e-5)
        assert cands[0]["proj_lon"] == pytest.approx(lon, abs=1e-5)
        assert cands[0]["eff_dist"] == 0.0

    def test_exact_50m_boundary_cutoff(self, mock_network):
        # 49.9 meters: within threshold -> road candidate returned
        lat_in = 42.00000 + (49.9 / 111132.0)
        cands_in = find_candidates_for_point(mock_network, lat_in, 72.00500, threshold_m=50.0)
        assert any(not c.is_fallback for c in cands_in)

        # 50.1 meters: beyond threshold -> ONLY fallback returned
        lat_out = 42.00000 + (50.1 / 111132.0)
        cands_out = find_candidates_for_point(mock_network, lat_out, 72.00500, threshold_m=50.0)
        assert len(cands_out) == 1
        assert cands_out[0].is_fallback is True

    def test_pure_backcountry_preserves_elevation_and_coords(self):
        # Route 10 km from nearest road
        net = OsmRoadNetwork()
        net.add_way({"class": "track", "coords": [(40.0, 70.0), (40.0, 70.1)]})

        backcountry_pts = [
            RoutePoint(lat=42.000, lon=72.000, ele=2500.0, cum_km=0.0, cum_mi=0.0),
            RoutePoint(lat=42.005, lon=72.005, ele=2550.0, cum_km=0.7, cum_mi=0.4),
            RoutePoint(lat=42.010, lon=72.010, ele=2600.0, cum_km=1.4, cum_mi=0.8),
        ]
        track = snap_track_to_osm(backcountry_pts, net, threshold_m=50.0)
        assert len(track) >= 3
        assert track.fallback_points_count == len(track)
        assert track.snapped_points_count == 0
        assert track.points[0].lat == pytest.approx(42.000, abs=1e-4)
        assert track.points[0].ele == pytest.approx(2500.0, abs=0.1)

    def test_partial_off_road_transition(self):
        # Road exists only along first 500m of route
        net = OsmRoadNetwork()
        net.add_way({"class": "track", "coords": [(42.000, 72.000), (42.005, 72.000)]})

        pts = [
            (42.000, 72.000, 1000.0),
            (42.003, 72.000, 1000.0),  # on road
            (42.008, 72.010, 1050.0),  # leaves road (> 50m into backcountry)
            (42.012, 72.015, 1100.0),  # backcountry
        ]
        track = snap_track_to_osm(pts, net, threshold_m=50.0)
        assert track.snapped_points_count > 0
        assert track.fallback_points_count > 0


# -----------------------------------------------------------------------------
# Group 3: Bikepacking Preference Weighting (Ported 6-7, Expanded 24-26)
# -----------------------------------------------------------------------------

class TestBikepackingPreferenceBias:
    """Verifies bikepacking preference bias when evaluating candidates."""

    @pytest.fixture
    def parallel_roads_network(self):
        net = OsmRoadNetwork()
        net.add_way({
            "class": "primary",
            "coords": [(42.00000, 72.00000), (42.00000, 72.01000)]
        })
        net.add_way({
            "class": "track",
            "coords": [(42.00020, 72.00000), (42.00020, 72.01000)]
        })
        return net

    def test_near_equidistant_prefers_track_over_primary_highway(self, parallel_roads_network):
        # 10m north of highway (eff 10 + 4.5 = 14.5m), 12m south of track (eff 12 + 0.0 = 12.0m)
        lat = 42.00000 + (10.0 / 111132.0)
        lon = 72.00500
        cands = find_candidates_for_point(parallel_roads_network, lat, lon, threshold_m=50.0)

        best = cands[0]
        assert best["way_idx"] == 1
        assert best["class"] == "track"

    def test_distant_trail_never_chosen_over_immediate_road(self, parallel_roads_network):
        # 3m from highway (eff 7.5m), 45m from track (eff 45.0m)
        lat = 42.00000 + (3.0 / 111132.0)
        lon = 72.00500
        cands = find_candidates_for_point(parallel_roads_network, lat, lon, threshold_m=50.0)

        best = cands[0]
        assert best["way_idx"] == 0
        assert best["class"] == "primary"

    def test_access_private_way_heavily_penalized(self):
        score_pub = score_candidate(10.0, "track", access=None)
        score_priv = score_candidate(10.0, "track", access="private")
        assert score_priv - score_pub == pytest.approx(30.0, abs=0.1)

    def test_motorway_penalty_demotes_below_secondary(self):
        # Motorway at 5m vs Secondary at 12m
        score_mw = score_candidate(5.0, "motorway")
        score_sec = score_candidate(12.0, "secondary")
        # Motorway: 5 + 15 = 20m; Secondary: 12 + 3.0 = 15.0m -> Secondary wins
        assert score_sec < score_mw

    def test_non_cyclable_classes_filtered(self):
        net = OsmRoadNetwork()
        net.add_way({"class": "motorway", "coords": [(42.0, 72.0), (42.0, 72.01)]})
        cands = find_candidates_for_point(net, 42.0001, 72.005, threshold_m=50.0)
        # Motorway is filtered out by is_cyclable
        assert len(cands) == 1
        assert cands[0].is_fallback is True


# -----------------------------------------------------------------------------
# Group 4: Bearing Alignment (> 60° Deflection) (New 27-30)
# -----------------------------------------------------------------------------

class TestBearingAlignment:
    """Verifies bearing deflection penalty when route direction disagrees with road orientation."""

    def test_bearing_deflection_parallel_way_zero_penalty(self):
        # Route North (0°), segment North (0°)
        defl = calculate_bearing_deflection(0.0, 0.0)
        assert defl == 0.0

    def test_bearing_deflection_reverse_parallel_way_zero_penalty(self):
        # Route North (0°), segment South (180°) -> bidirectional axis matches perfectly
        defl = calculate_bearing_deflection(0.0, 180.0)
        assert defl == 0.0

    def test_bearing_deflection_perpendicular_cross_road_penalized(self):
        # Route North (0°), cross-road East-West (90°) -> 90° deflection
        defl = calculate_bearing_deflection(0.0, 90.0)
        assert defl == pytest.approx(90.0, abs=0.1)

        score_aligned = score_candidate(10.0, "residential", deflection_deg=0.0)
        score_cross = score_candidate(10.0, "residential", deflection_deg=90.0)
        # Deflection penalty: (90 - 60) * 0.5 = 15.0m
        assert score_cross - score_aligned == pytest.approx(15.0, abs=0.1)

    def test_bearing_prevents_snapping_to_perpendicular_cross_street(self):
        net = OsmRoadNetwork()
        # Way 0: Perpendicular cross-street East-West at 2m distance
        net.add_way({"class": "residential", "coords": [(42.000, 71.99), (42.000, 72.01)]})
        # Way 1: Parallel North-South trail at 8m distance
        net.add_way({"class": "track", "coords": [(41.99, 72.00008), (42.01, 72.00008)]})

        # Rider moving North (0 deg) crossing the intersection
        lat = 42.000 + (2.0 / 111132.0)
        lon = 72.000
        cands = find_candidates_for_point(net, lat, lon, threshold_m=50.0, route_bearing=0.0)

        # Cross street: 2 + 1.5 + 15.0 = 18.5m
        # Parallel trail: 8 + 0.0 + 0.0 = 8.0m -> Parallel trail wins!
        assert cands[0]["way_idx"] == 1
        assert cands[0]["class"] == "track"


# -----------------------------------------------------------------------------
# Group 5: Topological Continuity & Viterbi (Ported 8, 10, 11)
# -----------------------------------------------------------------------------

class TestParallelTrailContinuity:
    """Verifies that transition cost penalizes jumping between disconnected parallel ways."""

    @pytest.fixture
    def parallel_disconnected_network(self):
        net = OsmRoadNetwork()
        net.add_way({"class": "track", "penalty": 0.0, "coords": [(42.0, 72.0), (42.0, 72.01)]})
        net.add_way({"class": "primary", "penalty": 4.5, "coords": [(42.00018, 72.0), (42.00018, 72.01)]})
        return net

    def test_switching_between_parallel_disconnected_ways_has_heavy_penalty(self, parallel_disconnected_network):
        c_track_1 = CandidateProjection(
            way_idx=0, seg_idx=0, t=0.1, proj_lat=42.0, proj_lon=72.001,
            dist_m=0.0, eff_dist=0.0, highway_class="track", is_fallback=False
        )
        c_track_2 = CandidateProjection(
            way_idx=0, seg_idx=0, t=0.3, proj_lat=42.0, proj_lon=72.003,
            dist_m=0.0, eff_dist=0.0, highway_class="track", is_fallback=False
        )
        c_highway_2 = CandidateProjection(
            way_idx=1, seg_idx=0, t=0.3, proj_lat=42.00018, proj_lon=72.003,
            dist_m=0.0, eff_dist=4.5, highway_class="primary", is_fallback=False
        )

        gpx_dist = haversine_distance_m(42.0, 72.001, 42.0, 72.003)
        same_way_cost = compute_transition_cost(c_track_1, c_track_2, gpx_dist, parallel_disconnected_network)
        jump_cost = compute_transition_cost(c_track_1, c_highway_2, gpx_dist, parallel_disconnected_network)

        assert same_way_cost < 5.0
        assert jump_cost > 30.0

    def test_reverse_progression_along_way_has_low_transition_cost(self):
        net = OsmRoadNetwork()
        net.add_way({"class": "track", "coords": [(42.0, 72.010), (42.0, 72.000)]})

        p1 = (42.0, 72.002, 1000.0)
        p2 = (42.0, 72.005, 1000.0)
        gpx_dist = haversine_distance_m(p1[0], p1[1], p2[0], p2[1])

        c1 = CandidateProjection(0, 0, 0.8, 42.0, 72.002, 0.0, 0.0, "track", False)
        c2 = CandidateProjection(0, 0, 0.5, 42.0, 72.005, 0.0, 0.0, "track", False)

        cost = compute_transition_cost(c1, c2, gpx_dist, net, p1, p2)
        assert cost < 5.0

    def test_actual_spatial_backtrack_is_heavily_penalized(self):
        net = OsmRoadNetwork()
        net.add_way({"class": "track", "coords": [(42.0, 72.010), (42.0, 72.000)]})

        p1 = (42.0, 72.002, 1000.0)
        p2 = (42.0, 72.005, 1000.0)
        gpx_dist = haversine_distance_m(p1[0], p1[1], p2[0], p2[1])

        c1 = CandidateProjection(0, 0, 0.5, 42.0, 72.005, 0.0, 0.0, "track", False)
        c2 = CandidateProjection(0, 0, 0.8, 42.0, 72.002, 0.0, 0.0, "track", False)

        cost = compute_transition_cost(c1, c2, gpx_dist, net, p1, p2)
        assert cost > 25.0


# -----------------------------------------------------------------------------
# Group 6: Curve Following & T-Junctions (Ported 9, 12, 14, 15, 20)
# -----------------------------------------------------------------------------

class TestRoadCurveFollowing:
    """Verifies curve following and T-junction traversal."""

    def test_intermediate_vertices_between_sparse_points(self):
        way_coords = [(42.000, 72.000), (42.001, 72.000), (42.001, 72.001), (42.001, 72.002)]
        seg_start, seg_end = 0, 2
        intermediate = [way_coords[v] for v in range(seg_start + 1, seg_end + 1)]
        assert len(intermediate) == 2
        assert intermediate[0] == (42.001, 72.000)
        assert intermediate[1] == (42.001, 72.001)

    def test_t_junction_detected_as_connected(self):
        net = OsmRoadNetwork()
        net.add_way({"class": "secondary", "coords": [(42.00, 72.00), (42.00, 72.02), (42.00, 72.04)]})
        net.add_way({"class": "track", "coords": [(42.02, 72.02), (42.00, 72.02)]})
        net.build_adjacency()

        assert net.are_ways_connected(0, 1) is True
        assert net.are_ways_connected(1, 0) is True

    def test_junction_detected_at_intermediate_vertex(self):
        coords1 = [(42.002, 72.02), (42.000, 72.02)]
        coords2 = [(42.000, 72.018), (42.000, 72.02), (42.000, 72.022)]

        prev_cand = {"proj_lat": 42.0004, "proj_lon": 72.02}
        curr_cand = {"proj_lat": 42.000, "proj_lon": 72.0204}

        best_j = None
        min_dist_sum = float("inf")
        for j1, p1 in enumerate(coords1):
            d1 = haversine_distance_m(prev_cand["proj_lat"], prev_cand["proj_lon"], p1[0], p1[1])
            for j2, p2 in enumerate(coords2):
                d2 = haversine_distance_m(curr_cand["proj_lat"], curr_cand["proj_lon"], p2[0], p2[1])
                if haversine_distance_m(p1[0], p1[1], p2[0], p2[1]) <= 20.0:
                    if d1 + d2 < min_dist_sum:
                        min_dist_sum = d1 + d2
                        best_j = (j1, j2)

        assert best_j == (1, 1)

    def test_junction_detected_with_candidate_distance_greater_than_150m(self):
        coords1 = [(42.002, 72.02), (42.000, 72.02)]
        coords2 = [(42.000, 72.018), (42.000, 72.02), (42.000, 72.022)]

        prev_cand = {"proj_lat": 42.00153, "proj_lon": 72.02}
        curr_cand = {"proj_lat": 42.000, "proj_lon": 72.0204}

        cand_dist = haversine_distance_m(prev_cand["proj_lat"], prev_cand["proj_lon"], curr_cand["proj_lat"], curr_cand["proj_lon"])
        search_radius = max(200.0, cand_dist * 1.5 + 50.0)

        cand_j1 = [idx for idx, p in enumerate(coords1) if haversine_distance_m(prev_cand["proj_lat"], prev_cand["proj_lon"], p[0], p[1]) <= search_radius]
        cand_j2 = [idx for idx, p in enumerate(coords2) if haversine_distance_m(curr_cand["proj_lat"], curr_cand["proj_lon"], p[0], p[1]) <= search_radius]

        best_j = None
        min_dist_sum = float("inf")
        for j1 in cand_j1:
            d1 = haversine_distance_m(prev_cand["proj_lat"], prev_cand["proj_lon"], coords1[j1][0], coords1[j1][1])
            for j2 in cand_j2:
                d2 = haversine_distance_m(curr_cand["proj_lat"], curr_cand["proj_lon"], coords2[j2][0], coords2[j2][1])
                if haversine_distance_m(coords1[j1][0], coords1[j1][1], coords2[j2][0], coords2[j2][1]) <= 20.0:
                    if d1 + d2 < min_dist_sum:
                        min_dist_sum = d1 + d2
                        best_j = (j1, j2)

        assert best_j == (1, 1)

    def test_look_ahead_bridging_over_switchback_with_fallback_chord(self):
        net = OsmRoadNetwork()
        net.add_way({
            "class": "track",
            "coords": [
                (42.00000, 72.00000),
                (42.00200, 72.00000),
                (42.00200, 72.00200),
                (42.00000, 72.00200)
            ]
        })
        net.build_adjacency()

        raw_track = {
            "points": [
                [42.00000, 72.00000, 1000.0, 0.0, 0.0],
                [42.00100, 72.00100, 1010.0, 0.25, 0.15],
                [42.00000, 72.00200, 1020.0, 0.5, 0.31]
            ]
        }

        result = snap_track_to_osm(raw_track, net, threshold_m=50.0)
        points = result.points

        # Follows road loop
        has_v1 = any(abs(p.lat - 42.00200) < 0.0002 and abs(p.lon - 72.00000) < 0.0002 for p in points)
        has_v2 = any(abs(p.lat - 42.00200) < 0.0002 and abs(p.lon - 72.00200) < 0.0002 for p in points)
        has_shortcut = any(abs(p.lat - 42.00100) < 0.0001 and abs(p.lon - 72.00100) < 0.0001 for p in points)

        assert has_v1 is True
        assert has_v2 is True
        assert has_shortcut is False


# -----------------------------------------------------------------------------
# Group 7: Telemetry & Monotonicity (Ported 13)
# -----------------------------------------------------------------------------

class TestTelemetryMonotonicity:
    """Verifies telemetry deduplication and strict monotonicity along guidance track."""

    def test_deduplicate_identical_consecutive_coordinates(self):
        raw_coords = [
            (42.00000, 72.00000, 1000.0),
            (42.000004, 72.000004, 1000.0),
            (42.00005, 72.00005, 1005.0),
            (42.00010, 72.00010, 1010.0),
        ]
        net = OsmRoadNetwork()
        result = snap_track_to_osm(raw_coords, net, threshold_m=50.0)
        pts = result.points

        for i in range(1, len(pts)):
            assert (pts[i-1].lat, pts[i-1].lon) != (pts[i].lat, pts[i].lon)
            assert pts[i].cum_km > pts[i-1].cum_km
            assert pts[i].cum_mi > pts[i-1].cum_mi


# -----------------------------------------------------------------------------
# Group 8: End-to-End Pipeline & Sequence Protocol (Ported 16-19, Expanded 31-35)
# -----------------------------------------------------------------------------

class TestSnapTrackToOsmPipeline:
    """End-to-end pipeline and Sequence Protocol tests."""

    def test_empty_track_returns_empty_cleanly(self):
        net = OsmRoadNetwork()
        result = snap_track_to_osm({"points": []}, net)
        assert len(result) == 0
        assert result["total_km"] == 0.0

    def test_single_point_track_returns_single_point_cleanly(self):
        net = OsmRoadNetwork()
        res = snap_track_to_osm({"points": [[42.0, 72.0, 1000.0, 0.0, 0.0]]}, net)
        assert len(res) == 1
        assert res.points[0].lat == 42.0

    def test_pure_backcountry_off_road_fallback(self):
        net = OsmRoadNetwork()
        raw_track = {
            "points": [
                [42.000, 72.000, 2000.0, 0.0, 0.0],
                [42.005, 72.005, 2050.0, 0.75, 0.47],
                [42.010, 72.010, 2100.0, 1.50, 0.93],
            ]
        }
        res = snap_track_to_osm(raw_track, net, threshold_m=50.0)
        assert len(res) >= 3
        for i in range(1, len(res)):
            assert res[i].cum_km > res[i-1].cum_km

    def test_road_curve_enrichment_increases_vertex_density(self):
        net = OsmRoadNetwork()
        net.add_way({
            "class": "track",
            "coords": [(42.00000, 72.00000), (42.00040, 72.00000), (42.00040, 72.00040)]
        })
        net.build_adjacency()

        raw_track = {
            "points": [
                [42.00000, 72.00000, 1000.0, 0.0, 0.0],
                [42.00040, 72.00040, 1010.0, 0.1, 0.06]
            ]
        }
        res = snap_track_to_osm(raw_track, net, threshold_m=50.0)
        assert len(res.points) >= 3
        has_corner = any(abs(p.lat - 42.0004) < 0.0001 and abs(p.lon - 72.000) < 0.0001 for p in res.points)
        assert has_corner is True

    def test_snap_accepts_route_track_object(self):
        net = OsmRoadNetwork()
        r_points = [
            RoutePoint(42.000, 72.000, 1000.0),
            RoutePoint(42.005, 72.005, 1050.0),
        ]
        track = RouteTrack(
            points=r_points,
            bbox=BoundingBox.from_points([(p.lat, p.lon) for p in r_points]),
            total_distance_km=0.75
        )
        res = snap_track_to_osm(track, net)
        assert isinstance(res, SnappedGuidanceTrack)
        assert len(res) >= 2

    def test_snap_accepts_list_of_route_point_objects(self):
        net = OsmRoadNetwork()
        r_points = [RoutePoint(42.0, 72.0), RoutePoint(42.01, 72.01)]
        res = snap_track_to_osm(r_points, net)
        assert len(res) >= 2

    def test_snap_accepts_raw_5d_lists(self):
        net = OsmRoadNetwork()
        raw = [[42.0, 72.0, 100.0, 0.0, 0.0], [42.01, 72.01, 100.0, 1.0, 0.6]]
        res = snap_track_to_osm(raw, net)
        assert len(res) >= 2

    def test_snapped_guidance_track_sequence_protocol(self):
        pts = [RoutePoint(42.0, 72.0, 100.0, 0.0, 0.0), RoutePoint(42.01, 72.01, 105.0, 1.0, 0.6)]
        track = SnappedGuidanceTrack(
            points=pts, total_km=1.0, total_miles=0.6,
            snapped_points_count=2, fallback_points_count=0
        )
        # Sequence protocol: len(), getitem, slice, iter
        assert len(track) == 2
        assert track[0].lat == 42.0
        assert len(track[:1]) == 1
        # RoutePoint 5D sequence indexing
        p0 = track[0]
        assert p0[0] == 42.0  # lat
        assert p0[1] == 72.0  # lon
        assert p0[2] == 100.0 # ele
        lat, lon, ele, km, mi = p0
        assert lat == 42.0

    def test_snapped_guidance_track_to_dict_matches_legacy_schema(self):
        pts = [RoutePoint(42.123456, 72.654321, 100.4, 0.0, 0.0)]
        track = SnappedGuidanceTrack(
            points=pts, total_km=10.5, total_miles=6.5,
            snapped_points_count=1, fallback_points_count=0
        )
        d = track.to_dict()
        assert d["total_km"] == 10.5
        assert d["total_miles"] == 6.5
        assert isinstance(d["points"], list)
        assert d["points"][0] == [42.123456, 72.654321, 100.4, 0.0, 0.0]

        # Domain model conversion
        rt = track.to_route_track("Test Track")
        assert isinstance(rt, RouteTrack)
        assert rt.total_distance_km == 10.5

    def test_snapped_guidance_track_matched_candidates_retention(self):
        net = OsmRoadNetwork()
        raw = [[42.0, 72.0, 100.0, 0.0, 0.0], [42.01, 72.01, 100.0, 1.0, 0.6]]
        res = snap_track_to_osm(raw, net)
        assert hasattr(res, "matched_candidates")
        assert hasattr(res, "track_points_with_km")
        assert len(res.matched_candidates) == len(res.track_points_with_km)
        assert len(res.matched_candidates) >= 2
        # Dictionary and sequence protocol access
        assert "matched_candidates" in res
        assert "track_points_with_km" in res
        assert res["matched_candidates"] is res.matched_candidates
        assert res.track_points_with_km[0][3] == 0.0
        assert res.track_points_with_km[-1][3] == 1.0

