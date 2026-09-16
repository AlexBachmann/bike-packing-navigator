"""
engine/tests/test_osm_network.py - Comprehensive unit tests for OSM road network graph and spatial indexing.
"""

import math
from pathlib import Path
import pytest

from engine.osm.network import (
    CLASS_PENALTIES,
    OsmNode,
    OsmRoadNetwork,
    OsmWay,
    OsmWaySegment,
    WayCandidate,
)


class TestNetworkModels:
    """Verifies dataclass instantiation, property calculation, and dictionary access."""

    def test_osm_way_properties(self):
        way = OsmWay(
            id=101,
            nodes=[1, 2, 3],
            coords=[(42.0, 72.0), (42.01, 72.01), (42.02, 72.02)],
            tags={"highway": "track", "surface": "gravel", "tracktype": "grade2", "name": "Mountain Trail"}
        )
        assert way.highway == "track"
        assert way.surface == "gravel"
        assert way.tracktype == "grade2"
        assert way.name == "Mountain Trail"
        assert way.penalty_m == 0.0
        assert way.is_cyclable is True

        # Dictionary access
        assert way["class"] == "track"
        assert way["coords"] == [(42.0, 72.0), (42.01, 72.01), (42.02, 72.02)]
        assert way.get("surface") == "gravel"

    def test_non_cyclable_and_private_ways(self):
        # Motorway is not cyclable
        motorway = OsmWay(id=1, nodes=[], coords=[(0, 0), (1, 1)], tags={"highway": "motorway"})
        assert motorway.is_cyclable is False
        assert motorway.penalty_m == 15.0

        # Private road without bicycle exemption
        private_road = OsmWay(
            id=2, nodes=[], coords=[(0, 0), (1, 1)],
            tags={"highway": "residential", "access": "private"}
        )
        assert private_road.is_cyclable is False
        assert private_road.penalty_m == CLASS_PENALTIES["residential"] + 30.0

        # Private road WITH bicycle=yes
        permissive_road = OsmWay(
            id=3, nodes=[], coords=[(0, 0), (1, 1)],
            tags={"highway": "service", "access": "private", "bicycle": "permissive"}
        )
        assert permissive_road.is_cyclable is True
        assert permissive_road.penalty_m == CLASS_PENALTIES["service"]

    def test_way_candidate_dictionary_compatibility(self):
        cand = WayCandidate(
            way_id=4,
            seg_idx=1,
            dist_m=12.5,
            eff_dist_m=17.0,
            proj_lat=42.001,
            proj_lon=72.002,
            t=0.45,
            highway="primary",
            is_fallback=False
        )
        assert cand.way_idx == 4
        assert cand.eff_dist == 17.0
        assert cand["way_idx"] == 4
        assert cand["seg_idx"] == 1
        assert cand["dist_m"] == 12.5
        assert cand["eff_dist"] == 17.0
        assert cand["proj_lat"] == 42.001
        assert cand["class"] == "primary"
        assert cand["is_fallback"] is False


class TestNetworkLoaders:
    """Verifies loading from Overpass JSON (out geom and node refs) and GeoJSON."""

    def test_load_from_overpass_out_geom(self):
        net = OsmRoadNetwork()
        overpass_data = {
            "version": 0.6,
            "elements": [
                {
                    "type": "way",
                    "id": 1001,
                    "tags": {"highway": "track", "name": "Singletrack"},
                    "geometry": [
                        {"lat": 40.0, "lon": -105.0},
                        {"lat": 40.005, "lon": -105.005}
                    ]
                }
            ]
        }
        count = net.load_from_overpass_json(overpass_data)
        assert count == 1
        assert len(net.ways) == 1
        assert net.ways[0].name == "Singletrack"
        assert len(net.segments) == 1

    def test_load_from_overpass_node_references(self):
        net = OsmRoadNetwork()
        overpass_data = {
            "version": 0.6,
            "elements": [
                {"type": "node", "id": 10, "lat": 40.0, "lon": -105.0},
                {"type": "node", "id": 11, "lat": 40.005, "lon": -105.005},
                {
                    "type": "way",
                    "id": 2001,
                    "nodes": [10, 11],
                    "tags": {"highway": "secondary", "name": "County Rd 4"}
                }
            ]
        }
        count = net.load_from_overpass_json(overpass_data)
        assert count == 1
        assert net.ways[0].coords == [(40.0, -105.0), (40.005, -105.005)]
        assert net.ways[0].name == "County Rd 4"

    def test_load_from_geojson(self):
        net = OsmRoadNetwork()
        geojson_data = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "id": 501,
                    "properties": {"highway": "cycleway", "name": "Bikeway"},
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[-105.0, 40.0], [-105.01, 40.01]]
                    }
                }
            ]
        }
        count = net.load_from_geojson(geojson_data)
        assert count == 1
        assert net.ways[0].coords == [(40.0, -105.0), (40.01, -105.01)]


class TestSpatialCandidateQueries:
    """Verifies spatial hash grid indexing, 50m threshold, fallback, and bias."""

    def test_query_nearby_segments(self):
        net = OsmRoadNetwork()
        net.add_way({
            "class": "track",
            "coords": [(42.000, 72.000), (42.000, 72.010)]
        })
        # Query 20m north of segment
        lat = 42.000 + (20.0 / 111132.0)
        lon = 72.005
        segs = net.query_nearby_segments(lat, lon, radius_m=50.0)
        assert len(segs) == 1
        assert segs[0].way_id == 0

    def test_find_candidates_within_50m(self):
        net = OsmRoadNetwork()
        net.add_way({
            "class": "path",
            "coords": [(42.000, 72.000), (42.000, 72.010)]
        })
        lat = 42.000 + (30.0 / 111132.0)
        lon = 72.005
        cands = net.find_candidates_for_point(lat, lon, threshold_m=50.0)

        assert len(cands) == 2  # Road candidate + fallback
        best = cands[0]
        assert best.is_fallback is False
        assert best.dist_m == pytest.approx(30.0, abs=1.0)
        assert cands[-1].is_fallback is True

    def test_find_candidates_beyond_50m_returns_fallback_only(self):
        net = OsmRoadNetwork()
        net.add_way({
            "class": "track",
            "coords": [(42.000, 72.000), (42.000, 72.010)]
        })
        # 75m north of road
        lat = 42.000 + (75.0 / 111132.0)
        lon = 72.005
        cands = net.find_candidates_for_point(lat, lon, threshold_m=50.0)

        assert len(cands) == 1
        assert cands[0].is_fallback is True
        assert cands[0].eff_dist_m == 0.0
        assert cands[0].proj_lat == lat

    def test_bikepacking_preference_bias(self):
        net = OsmRoadNetwork()
        # Way 0: Primary road (penalty 4.5m)
        net.add_way({
            "class": "primary",
            "coords": [(42.000, 72.000), (42.000, 72.010)]
        })
        # Way 1: Track (penalty 0.0m) parallel ~22m north
        net.add_way({
            "class": "track",
            "coords": [(42.00020, 72.000), (42.00020, 72.010)]
        })

        # Point is 10m north of highway, and 12m south of track
        lat = 42.000 + (10.0 / 111132.0)
        lon = 72.005
        cands = net.find_candidates_for_point(lat, lon, threshold_m=50.0)

        # Track: 12 + 0.0 = 12.0m vs Highway: 10 + 4.5 = 14.5m -> Track wins!
        assert cands[0].way_id == 1
        assert cands[0].highway == "track"

    def test_bounded_bias_does_not_choose_distant_trail(self):
        net = OsmRoadNetwork()
        net.add_way({
            "class": "primary",
            "coords": [(42.000, 72.000), (42.000, 72.010)]
        })
        net.add_way({
            "class": "track",
            "coords": [(42.00045, 72.000), (42.00045, 72.010)]  # ~50m north
        })

        # Point is 3m from primary highway, and 45m from track
        lat = 42.000 + (3.0 / 111132.0)
        lon = 72.005
        cands = net.find_candidates_for_point(lat, lon, threshold_m=50.0)

        # Highway: 3 + 4.5 = 7.5m vs Track: 45 + 0.0 = 45.0m -> Highway wins!
        assert cands[0].way_id == 0
        assert cands[0].highway == "primary"

    def test_bearing_deflection_penalty(self):
        net = OsmRoadNetwork()
        # East-West road (heading 90 deg)
        net.add_way({
            "class": "residential",
            "coords": [(42.000, 72.000), (42.000, 72.010)]
        })
        # Route heading North (0 deg): perpendicular to East-West road -> 90 deg deflection
        lat = 42.000
        lon = 72.005
        cands = net.find_candidates_for_point(lat, lon, threshold_m=50.0, route_bearing=0.0)

        best = cands[0]
        assert best.bearing_deflection_deg == pytest.approx(90.0, abs=1.0)
        # Deflection penalty: (90 - 60) * 0.5 = 15.0m
        # eff_dist = dist_m (0) + class (1.5) + bearing (15) = 16.5m
        assert best.eff_dist_m == pytest.approx(16.5, abs=0.5)


class TestGraphTopologyAndPathfinding:
    """Verifies adjacency discovery, connectivity testing, and Dijkstra path extraction."""

    def test_build_adjacency_and_connected_ways(self):
        net = OsmRoadNetwork()
        # Way 0: (42.0, 72.0) -> (42.0, 72.01)
        net.add_way({"class": "track", "coords": [(42.0, 72.0), (42.0, 72.01)]})
        # Way 1: (42.0, 72.01) -> (42.0, 72.02)
        net.add_way({"class": "track", "coords": [(42.0, 72.01), (42.0, 72.02)]})
        # Way 2: (42.05, 72.05) -> (42.05, 72.06) (disconnected)
        net.add_way({"class": "track", "coords": [(42.05, 72.05), (42.05, 72.06)]})

        net.build_adjacency()

        assert net.are_ways_connected(0, 1) is True
        assert net.are_ways_connected(1, 0) is True
        assert net.are_ways_connected(0, 2) is False

    def test_find_way_path_dijkstra(self):
        net = OsmRoadNetwork()
        # 3 connected ways: 0 -> 1 -> 2
        net.add_way({"class": "track", "coords": [(42.0, 72.00), (42.0, 72.01)]})
        net.add_way({"class": "track", "coords": [(42.0, 72.01), (42.0, 72.02)]})
        net.add_way({"class": "track", "coords": [(42.0, 72.02), (42.0, 72.03)]})
        net.build_adjacency()

        path = net.find_way_path(0, 2)
        assert path == [0, 1, 2]

    def test_extract_path_geometry(self):
        net = OsmRoadNetwork()
        net.add_way({"class": "track", "coords": [(42.0, 72.00), (42.0, 72.01)]})
        net.add_way({"class": "track", "coords": [(42.0, 72.01), (42.0, 72.02)]})
        net.build_adjacency()

        geom = net.extract_path_geometry([0, 1], (42.0, 72.00), (42.0, 72.02))
        assert len(geom) >= 3
        assert geom[0] == (42.0, 72.00)
        assert geom[-1] == (42.0, 72.02)
