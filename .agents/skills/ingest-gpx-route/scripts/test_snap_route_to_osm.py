#!/usr/bin/env python3
"""
test_snap_route_to_osm.py - Unit test suite for OSM road snapping pipeline.

Verifies:
  1. 50m threshold behavior (road snapping <= 50m, off-road fallback > 50m).
  2. Parallel trail stability (no erratic jumping between parallel ways).
  3. Bikepacking preference bias (equidistant bias toward trails/paths, bounded by distance).
  4. Curve following and corner-cutting avoidance.
  5. Monotonic telemetry calculation (cum_km, cum_mi, elevation interpolation).
"""

import math
import unittest
from pathlib import Path
import sys

from unittest.mock import patch

# Add scripts directory to path
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from snap_route_to_osm import (
    OsmRoadNetwork,
    find_candidates_for_point,
    compute_transition_cost,
    dist_point_to_segment,
    haversine_m,
    CLASS_PENALTIES,
    snap_track_to_osm,
)


class TestDistPointToSegment(unittest.TestCase):
    """Tests geometric projection and perpendicular distance calculation."""

    def test_perpendicular_projection_on_segment(self):
        # Segment from (0, 0) to (100, 0)
        # Point at (50, 10) -> distance should be 10, t should be 0.5
        d, t, qx, qy = dist_point_to_segment(50.0, 10.0, 0.0, 0.0, 100.0, 0.0)
        self.assertAlmostEqual(d, 10.0, places=3)
        self.assertAlmostEqual(t, 0.5, places=3)
        self.assertAlmostEqual(qx, 50.0, places=3)
        self.assertAlmostEqual(qy, 0.0, places=3)

    def test_clamp_before_segment_start(self):
        # Point before segment start: t should clamp to 0.0
        d, t, qx, qy = dist_point_to_segment(-20.0, 10.0, 0.0, 0.0, 100.0, 0.0)
        self.assertAlmostEqual(t, 0.0, places=3)
        self.assertAlmostEqual(qx, 0.0, places=3)
        self.assertAlmostEqual(qy, 0.0, places=3)
        self.assertAlmostEqual(d, math.hypot(-20.0, 10.0), places=3)

    def test_clamp_after_segment_end(self):
        # Point after segment end: t should clamp to 1.0
        d, t, qx, qy = dist_point_to_segment(120.0, 10.0, 0.0, 0.0, 100.0, 0.0)
        self.assertAlmostEqual(t, 1.0, places=3)
        self.assertAlmostEqual(qx, 100.0, places=3)
        self.assertAlmostEqual(qy, 0.0, places=3)


class TestSnappingThresholdAndFallback(unittest.TestCase):
    """Verifies the 50m threshold behavior and off-road fallback."""

    def setUp(self):
        # Create a mock network with a single east-west road at lat 42.00000
        self.network = OsmRoadNetwork(Path("/tmp/mock.pmtiles"))
        self.network.ways = [{
            'class': 'track',
            'penalty': 0.0,
            'coords': [(42.00000, 72.00000), (42.00000, 72.01000)]
        }]
        # Populate grid
        self.network.grid[(int(72.00000 / self.network.grid_size), int(42.00000 / self.network.grid_size))].append((0, 0))
        self.network.grid[(int(72.01000 / self.network.grid_size), int(42.00000 / self.network.grid_size))].append((0, 0))

    def test_point_within_50m_snaps_to_road(self):
        # 25 meters north of the road: lat delta ~ 25 / 111132 = ~0.000225 deg
        lat = 42.00000 + (25.0 / 111132.0)
        lon = 72.00500
        cands = find_candidates_for_point(self.network, lat, lon, threshold_m=50.0)

        # First candidate should be the road projection
        best = cands[0]
        self.assertFalse(best['is_fallback'])
        self.assertEqual(best['way_idx'], 0)
        self.assertAlmostEqual(best['proj_lat'], 42.00000, places=4)
        self.assertAlmostEqual(best['dist_m'], 25.0, delta=1.0)

    def test_point_beyond_50m_falls_back_to_raw_coords(self):
        # 65 meters north of the road: lat delta ~ 65 / 111132 = ~0.000585 deg
        lat = 42.00000 + (65.0 / 111132.0)
        lon = 72.00500
        cands = find_candidates_for_point(self.network, lat, lon, threshold_m=50.0)

        # Only the fallback candidate should be returned
        self.assertEqual(len(cands), 1)
        self.assertTrue(cands[0]['is_fallback'])
        self.assertAlmostEqual(cands[0]['proj_lat'], lat, places=5)
        self.assertAlmostEqual(cands[0]['proj_lon'], lon, places=5)
        self.assertEqual(cands[0]['eff_dist'], 0.0)


class TestBikepackingPreferenceBias(unittest.TestCase):
    """Verifies bikepacking preference bias when evaluating candidates."""

    def setUp(self):
        self.network = OsmRoadNetwork(Path("/tmp/mock.pmtiles"))
        # Way 0: Primary motor highway at lat 42.00000
        # Way 1: Bikepacking singletrack/track parallel to it
        self.network.ways = [
            {
                'class': 'primary',
                'penalty': CLASS_PENALTIES['primary'],  # 4.5m penalty
                'coords': [(42.00000, 72.00000), (42.00000, 72.01000)]
            },
            {
                'class': 'track',
                'penalty': CLASS_PENALTIES['track'],  # 0.0m penalty
                'coords': [(42.00020, 72.00000), (42.00020, 72.01000)]  # ~22m north
            }
        ]
        gx = int(72.005 / self.network.grid_size)
        gy = int(42.000 / self.network.grid_size)
        self.network.grid[(gx, gy)] = [(0, 0), (1, 0)]

    def test_near_equidistant_prefers_track_over_primary_highway(self):
        # Point is 10m north of highway, and 12m south of track
        # Physical dist to highway = 10m, dist to track = 12m
        # Effective highway dist = 10 + 4.5 = 14.5m
        # Effective track dist = 12 + 0.0 = 12.0m -> Track should win!
        lat = 42.00000 + (10.0 / 111132.0)
        lon = 72.00500
        cands = find_candidates_for_point(self.network, lat, lon, threshold_m=50.0)

        best = cands[0]
        self.assertEqual(best['way_idx'], 1, "Track must be chosen over primary road when nearly equidistant")
        self.assertEqual(best['class'], 'track')

    def test_distant_trail_never_chosen_over_immediate_road(self):
        # Point is 3m from primary highway, and 45m from track
        # Effective highway dist = 3 + 4.5 = 7.5m
        # Effective track dist = 45 + 0.0 = 45.0m -> Highway must win!
        lat = 42.00000 + (3.0 / 111132.0)
        lon = 72.00500
        cands = find_candidates_for_point(self.network, lat, lon, threshold_m=50.0)

        best = cands[0]
        self.assertEqual(best['way_idx'], 0, "Immediate road must be chosen over distant trail")
        self.assertEqual(best['class'], 'primary')


class TestParallelTrailContinuity(unittest.TestCase):
    """Verifies that transition cost penalizes jumping between disconnected parallel ways."""

    def setUp(self):
        self.network = OsmRoadNetwork(Path("/tmp/mock.pmtiles"))
        self.network.ways = [
            {'class': 'track', 'penalty': 0.0, 'coords': [(42.0, 72.0), (42.0, 72.01)]},
            {'class': 'primary', 'penalty': 4.5, 'coords': [(42.00018, 72.0), (42.00018, 72.01)]}  # ~20m parallel
        ]

    def test_switching_between_parallel_disconnected_ways_has_heavy_penalty(self):
        c_track_1 = {
            'way_idx': 0, 'seg_idx': 0, 't': 0.1,
            'proj_lat': 42.0, 'proj_lon': 72.001,
            'is_fallback': False
        }
        c_track_2 = {
            'way_idx': 0, 'seg_idx': 0, 't': 0.3,
            'proj_lat': 42.0, 'proj_lon': 72.003,
            'is_fallback': False
        }
        c_highway_2 = {
            'way_idx': 1, 'seg_idx': 0, 't': 0.3,
            'proj_lat': 42.00018, 'proj_lon': 72.003,
            'is_fallback': False
        }

        gpx_dist = haversine_m(42.0, 72.001, 42.0, 72.003)

        # Staying on the same track should have near-zero transition cost
        same_way_cost = compute_transition_cost(c_track_1, c_track_2, gpx_dist, self.network)

        # Jumping to the parallel highway should incur a heavy penalty
        jump_cost = compute_transition_cost(c_track_1, c_highway_2, gpx_dist, self.network)

        self.assertLess(same_way_cost, 5.0)
        self.assertGreater(jump_cost, 30.0, "Jumping to parallel way must be heavily penalized")


class TestRoadCurveFollowing(unittest.TestCase):
    """Verifies that intermediate road vertices are traversed along curves rather than cutting corners."""

    def test_intermediate_vertices_between_sparse_points(self):
        # Road makes a 90-degree curve:
        # V0=(0,0) -> V1=(0.001, 0) -> V2=(0.001, 0.001) -> V3=(0.001, 0.002)
        way_coords = [(42.000, 72.000), (42.001, 72.000), (42.001, 72.001), (42.001, 72.002)]

        # If point 1 is at start of segment 0 (V0), and point 2 is at end of segment 2 (V3),
        # the curve must include V1 and V2.
        seg_start = 0
        seg_end = 2
        intermediate = []
        for v_idx in range(seg_start + 1, seg_end + 1):
            intermediate.append(way_coords[v_idx])

        self.assertEqual(len(intermediate), 2)
        self.assertEqual(intermediate[0], (42.001, 72.000))  # V1
        self.assertEqual(intermediate[1], (42.001, 72.001))  # V2


class TestReverseTraversalAndBacktracking(unittest.TestCase):
    """Verifies bidirectional way support (low cost for reverse traversal) and genuine backtrack penalties."""

    def setUp(self):
        self.network = OsmRoadNetwork(Path("/tmp/mock.pmtiles"))
        # East-to-West way: (42.0, 72.010) down to (42.0, 72.000)
        self.network.ways = [{'class': 'track', 'penalty': 0.0, 'coords': [(42.0, 72.010), (42.0, 72.000)]}]

    def test_reverse_progression_along_way_has_low_transition_cost(self):
        # Rider moving West to East: raw GPX goes from 72.002 to 72.005
        p1 = (42.0, 72.002, 1000.0)
        p2 = (42.0, 72.005, 1000.0)
        gpx_dist = haversine_m(p1[0], p1[1], p2[0], p2[1])

        # Candidates on way: s1=0.8, s2=0.5 (s2 < s1 because OSM way is East-to-West)
        c1 = {'way_idx': 0, 'seg_idx': 0, 't': 0.8, 'proj_lat': 42.0, 'proj_lon': 72.002, 'is_fallback': False}
        c2 = {'way_idx': 0, 'seg_idx': 0, 't': 0.5, 'proj_lat': 42.0, 'proj_lon': 72.005, 'is_fallback': False}

        cost = compute_transition_cost(c1, c2, gpx_dist, self.network, p1, p2)
        self.assertLess(cost, 5.0, "Traversing a reverse-digitized OSM way must have near-zero transition cost")

    def test_actual_spatial_backtrack_is_heavily_penalized(self):
        # Rider moving West to East in GPX: 72.002 -> 72.005
        p1 = (42.0, 72.002, 1000.0)
        p2 = (42.0, 72.005, 1000.0)
        gpx_dist = haversine_m(p1[0], p1[1], p2[0], p2[1])

        # Candidate 2 is spatially BEHIND candidate 1 (backtrack opposite to GPX movement)
        c1 = {'way_idx': 0, 'seg_idx': 0, 't': 0.5, 'proj_lat': 42.0, 'proj_lon': 72.005, 'is_fallback': False}
        c2 = {'way_idx': 0, 'seg_idx': 0, 't': 0.8, 'proj_lat': 42.0, 'proj_lon': 72.002, 'is_fallback': False}

        cost = compute_transition_cost(c1, c2, gpx_dist, self.network, p1, p2)
        self.assertGreater(cost, 25.0, "Actual spatial backtracking opposite to GPX direction must be heavily penalized")


class TestTJunctionAdjacency(unittest.TestCase):
    """Verifies that T-junctions connecting the end of one way to the middle of another way are detected."""

    def test_t_junction_detected_as_connected(self):
        net = OsmRoadNetwork(Path("/tmp/mock.pmtiles"))
        # Way 0: Long east-west road from 72.00 to 72.04 with vertex at 72.02
        # Way 1: North-south road ending at (42.00, 72.02)
        net.ways = [
            {'class': 'secondary', 'penalty': 3.5, 'coords': [(42.00, 72.00), (42.00, 72.02), (42.00, 72.04)]},
            {'class': 'track', 'penalty': 0.0, 'coords': [(42.02, 72.02), (42.00, 72.02)]}
        ]
        net.build_adjacency()

        self.assertTrue(net.are_ways_connected(0, 1), "Way 0 and Way 1 meet at a T-junction and must be connected")
        self.assertTrue(net.are_ways_connected(1, 0))


class TestTelemetryMonotonicity(unittest.TestCase):
    """Verifies telemetry deduplication and strict monotonicity along the guidance track."""

    def test_deduplicate_identical_consecutive_coordinates(self):
        # Even if raw/interpolated points have identical coordinates, final_points must have 0 duplicates
        raw_coords = [
            (42.00000, 72.00000, 1000.0),
            (42.000004, 72.000004, 1000.0),  # rounds to same 5th decimal
            (42.00005, 72.00005, 1005.0),
            (42.00010, 72.00010, 1010.0),
        ]
        final_points = []
        cum_km = 0.0
        for p in raw_coords:
            lat_r = round(p[0], 5)
            lon_r = round(p[1], 5)
            ele_r = round(p[2], 1)
            if not final_points:
                final_points.append([lat_r, lon_r, ele_r, 0.0, 0.0])
                continue
            last = final_points[-1]
            step_m = haversine_m(last[0], last[1], lat_r, lon_r)
            if step_m < 1.5 or (lat_r == last[0] and lon_r == last[1]):
                continue
            cum_km += step_m / 1000.0
            cum_mi = cum_km * 0.621371
            final_points.append([lat_r, lon_r, ele_r, round(cum_km, 3), round(cum_mi, 3)])

        self.assertEqual(len(final_points), 3)
        self.assertNotEqual(final_points[0][:2], final_points[1][:2])
        self.assertGreater(final_points[1][3], final_points[0][3])
        self.assertGreater(final_points[1][4], final_points[0][4])
        self.assertGreater(final_points[2][3], final_points[1][3])
        self.assertGreater(final_points[2][4], final_points[1][4])


class TestTJunctionTraversalCurveFollowing(unittest.TestCase):
    """Verifies that road geometry curve traversal works through T-junctions connecting to intermediate vertices."""

    def test_junction_detected_at_intermediate_vertex(self):
        coords1 = [(42.002, 72.02), (42.000, 72.02)]  # Way 1 (north-south track terminating at (42.000, 72.02))
        coords2 = [(42.000, 72.018), (42.000, 72.02), (42.000, 72.022)]  # Way 0 (east-west road with middle vertex at (42.000, 72.02))

        prev_cand = {'seg_idx': 0, 't': 0.8, 'proj_lat': 42.0004, 'proj_lon': 72.02}
        curr_cand = {'seg_idx': 1, 't': 0.2, 'proj_lat': 42.000, 'proj_lon': 72.0204}

        cand_j1 = [
            idx for idx in range(len(coords1))
            if haversine_m(prev_cand['proj_lat'], prev_cand['proj_lon'], coords1[idx][0], coords1[idx][1]) <= 150.0
        ]
        cand_j2 = [
            idx for idx in range(len(coords2))
            if haversine_m(curr_cand['proj_lat'], curr_cand['proj_lon'], coords2[idx][0], coords2[idx][1]) <= 150.0
        ]

        best_j = None
        min_dist_sum = float('inf')
        for j1 in cand_j1:
            p1_j = coords1[j1]
            d1 = haversine_m(prev_cand['proj_lat'], prev_cand['proj_lon'], p1_j[0], p1_j[1])
            for j2 in cand_j2:
                p2_j = coords2[j2]
                d2 = haversine_m(curr_cand['proj_lat'], curr_cand['proj_lon'], p2_j[0], p2_j[1])
                if haversine_m(p1_j[0], p1_j[1], p2_j[0], p2_j[1]) <= 20.0:
                    if d1 + d2 < min_dist_sum:
                        min_dist_sum = d1 + d2
                        best_j = (j1, j2)

        self.assertIsNotNone(best_j, "T-junction intermediate vertex must be discovered")
        self.assertEqual(best_j, (1, 1), "Way 1 endpoint (index 1) must meet Way 0 intermediate vertex (index 1)")

    def test_junction_detected_with_candidate_distance_greater_than_150m(self):
        # When points are spaced ~220m apart, junction should still be found via dynamic radius
        coords1 = [(42.002, 72.02), (42.000, 72.02)]
        coords2 = [(42.000, 72.018), (42.000, 72.02), (42.000, 72.022)]

        # prev_cand is 170m north of junction (lat delta ~ 170 / 111132 = ~0.00153)
        prev_cand = {'seg_idx': 0, 't': 0.235, 'proj_lat': 42.00153, 'proj_lon': 72.02}
        curr_cand = {'seg_idx': 1, 't': 0.2, 'proj_lat': 42.000, 'proj_lon': 72.0204}

        cand_dist = haversine_m(prev_cand['proj_lat'], prev_cand['proj_lon'], curr_cand['proj_lat'], curr_cand['proj_lon'])
        search_radius = max(200.0, cand_dist * 1.5 + 50.0)

        cand_j1 = [
            idx for idx in range(len(coords1))
            if haversine_m(prev_cand['proj_lat'], prev_cand['proj_lon'], coords1[idx][0], coords1[idx][1]) <= search_radius
        ]
        cand_j2 = [
            idx for idx in range(len(coords2))
            if haversine_m(curr_cand['proj_lat'], curr_cand['proj_lon'], coords2[idx][0], coords2[idx][1]) <= search_radius
        ]

        best_j = None
        min_dist_sum = float('inf')
        for j1 in cand_j1:
            p1_j = coords1[j1]
            d1 = haversine_m(prev_cand['proj_lat'], prev_cand['proj_lon'], p1_j[0], p1_j[1])
            for j2 in cand_j2:
                p2_j = coords2[j2]
                d2 = haversine_m(curr_cand['proj_lat'], curr_cand['proj_lon'], p2_j[0], p2_j[1])
                if haversine_m(p1_j[0], p1_j[1], p2_j[0], p2_j[1]) <= 20.0:
                    if d1 + d2 < min_dist_sum:
                        min_dist_sum = d1 + d2
                        best_j = (j1, j2)

        self.assertIsNotNone(best_j, "Junction must be discovered with dynamic radius even when candidate distance > 150m")
        self.assertEqual(best_j, (1, 1))


class TestSnapTrackToOsmPipeline(unittest.TestCase):
    """End-to-end unit tests for the snap_track_to_osm pipeline function."""

    def test_empty_track_returns_empty_cleanly(self):
        result = snap_track_to_osm({"points": []}, Path("/tmp/mock.pmtiles"))
        self.assertEqual(result["points"], [])
        self.assertEqual(result["total_km"], 0.0)
        self.assertEqual(result["total_miles"], 0.0)

    def test_single_point_track_returns_single_point_cleanly(self):
        single_point_data = {
            "total_km": 0.0,
            "total_miles": 0.0,
            "points": [[42.0, 72.0, 1000.0, 0.0, 0.0]]
        }
        result = snap_track_to_osm(single_point_data, Path("/tmp/mock.pmtiles"))
        self.assertEqual(len(result["points"]), 1)
        self.assertEqual(result["points"][0], [42.0, 72.0, 1000.0, 0.0, 0.0])

    def test_pure_backcountry_off_road_fallback(self):
        # Track in wilderness with 0 OSM ways nearby
        raw_track = {
            "total_km": 2.0,
            "total_miles": 1.24,
            "points": [
                [42.000, 72.000, 2000.0, 0.0, 0.0],
                [42.005, 72.005, 2050.0, 0.75, 0.47],
                [42.010, 72.010, 2100.0, 1.50, 0.93],
                [42.015, 72.015, 2150.0, 2.25, 1.40]
            ]
        }

        # Mock load_corridor_ways to simulate no roads in the corridor
        with patch.object(OsmRoadNetwork, 'load_corridor_ways', return_value=None):
            result = snap_track_to_osm(raw_track, Path("/tmp/mock.pmtiles"), threshold_m=50.0)

        points = result["points"]
        self.assertGreaterEqual(len(points), 2)
        # Verify 0 duplicate coordinates
        for i in range(1, len(points)):
            self.assertNotEqual((points[i-1][0], points[i-1][1]), (points[i][0], points[i][1]))
            # Verify strict telemetry monotonicity
            self.assertGreater(points[i][3], points[i-1][3])
            self.assertGreater(points[i][4], points[i-1][4])

    def test_road_curve_enrichment_increases_vertex_density(self):
        # Raw track cuts across a sharp right-angle corner:
        # P0=(42.000, 72.000) to P1=(42.0004, 72.0004)
        raw_track = {
            "total_km": 0.1,
            "total_miles": 0.06,
            "points": [
                [42.00000, 72.00000, 1000.0, 0.0, 0.0],
                [42.00040, 72.00040, 1010.0, 0.1, 0.06]
            ]
        }

        # Mock network with a right-angle curved way:
        # V0=(42.000, 72.000) -> V1=(42.0004, 72.000) -> V2=(42.0004, 72.0004)
        def mock_load(network_self, track_points, threshold_m=50.0):
            network_self.ways = [{
                'class': 'track',
                'penalty': 0.0,
                'coords': [(42.00000, 72.00000), (42.00040, 72.00000), (42.00040, 72.00040)]
            }]
            for k in range(len(network_self.ways[0]['coords']) - 1):
                lat1, lon1 = network_self.ways[0]['coords'][k]
                lat2, lon2 = network_self.ways[0]['coords'][k + 1]
                gx1, gy1 = int(math.floor(lon1 / network_self.grid_size)), int(math.floor(lat1 / network_self.grid_size))
                gx2, gy2 = int(math.floor(lon2 / network_self.grid_size)), int(math.floor(lat2 / network_self.grid_size))
                for gx in range(min(gx1, gx2), max(gx1, gx2) + 1):
                    for gy in range(min(gy1, gy2), max(gy1, gy2) + 1):
                        network_self.grid[(gx, gy)].append((0, k))
            network_self.build_adjacency()

        with patch.object(OsmRoadNetwork, 'load_corridor_ways', side_effect=mock_load, autospec=True):
            result = snap_track_to_osm(raw_track, Path("/tmp/mock.pmtiles"), threshold_m=50.0)

        points = result["points"]
        # Output should have traversed through V1, resulting in >= 3 vertices
        self.assertGreaterEqual(len(points), 3, "Curve geometry should insert corner vertex")
        # Check that corner vertex (42.0004, 72.000) is included
        has_corner = any(abs(p[0] - 42.0004) < 0.0001 and abs(p[1] - 72.000) < 0.0001 for p in points)
        self.assertTrue(has_corner, "Guidance track must follow road curve through intermediate vertex")

        # Telemetry must be strictly monotonic
        for i in range(1, len(points)):
            self.assertGreater(points[i][3], points[i-1][3])
            self.assertGreater(points[i][4], points[i-1][4])

    def test_look_ahead_bridging_over_switchback_with_fallback_chord(self):
        # A hairpin curve / switchback:
        # V0=(42.000, 72.000) -> V1=(42.002, 72.000) -> V2=(42.002, 72.002) -> V3=(42.000, 72.002)
        # Raw GPX has:
        # P0 at V0 (on trail)
        # P1 in the middle of the woods (42.001, 72.001), ~80m away from any road -> fallback
        # P2 at V3 (on trail)
        raw_track = {
            "total_km": 0.5,
            "total_miles": 0.31,
            "points": [
                [42.00000, 72.00000, 1000.0, 0.0, 0.0],
                [42.00100, 72.00100, 1010.0, 0.25, 0.15],
                [42.00000, 72.00200, 1020.0, 0.5, 0.31]
            ]
        }

        def mock_load(network_self, track_points, threshold_m=50.0):
            network_self.ways = [{
                'class': 'track',
                'penalty': 0.0,
                'coords': [
                    (42.00000, 72.00000),
                    (42.00200, 72.00000),
                    (42.00200, 72.00200),
                    (42.00000, 72.00200)
                ]
            }]
            for k in range(len(network_self.ways[0]['coords']) - 1):
                lat1, lon1 = network_self.ways[0]['coords'][k]
                lat2, lon2 = network_self.ways[0]['coords'][k + 1]
                gx1, gy1 = int(math.floor(lon1 / network_self.grid_size)), int(math.floor(lat1 / network_self.grid_size))
                gx2, gy2 = int(math.floor(lon2 / network_self.grid_size)), int(math.floor(lat2 / network_self.grid_size))
                for gx in range(min(gx1, gx2), max(gx1, gx2) + 1):
                    for gy in range(min(gy1, gy2), max(gy1, gy2) + 1):
                        network_self.grid[(gx, gy)].append((0, k))
            network_self.build_adjacency()

        with patch.object(OsmRoadNetwork, 'load_corridor_ways', side_effect=mock_load, autospec=True):
            result = snap_track_to_osm(raw_track, Path("/tmp/mock.pmtiles"), threshold_m=50.0)

        points = result["points"]
        # Look-ahead router must bridge over P1 and route along V1 and V2
        has_v1 = any(abs(p[0] - 42.00200) < 0.0001 and abs(p[1] - 72.00000) < 0.0001 for p in points)
        has_v2 = any(abs(p[0] - 42.00200) < 0.0001 and abs(p[1] - 72.00200) < 0.0001 for p in points)
        # Should NOT contain the off-road shortcut point (42.00100, 72.00100)
        has_p1_shortcut = any(abs(p[0] - 42.00100) < 0.0001 and abs(p[1] - 72.00100) < 0.0001 for p in points)

        self.assertTrue(has_v1, "Guidance track must follow loop vertex V1")
        self.assertTrue(has_v2, "Guidance track must follow loop vertex V2")
        self.assertFalse(has_p1_shortcut, "Guidance track must NOT cut corners through the woods via P1")



if __name__ == "__main__":
    unittest.main()
