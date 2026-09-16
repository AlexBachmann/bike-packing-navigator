"""
engine/tests/test_terrain_passes.py - Unit tests for mountain pass extraction,
OSM saddle node matching, topographic prominence, high-point flagging, and climb linking.
"""

import pytest

from engine.terrain.climbs import Climb
from engine.terrain.passes import (
    MountainPass,
    detect_saddles_and_high_points,
    extract_mountain_passes,
    extract_osm_pass_nodes,
    match_pass_nodes_to_track,
)


@pytest.mark.unit
class TestMountainPassDataclass:
    """Tests for MountainPass data model and serialization."""

    def test_pass_initialization_and_properties(self):
        p = MountainPass(
            name="Kenosha Pass",
            km=100.0,
            elevation_m=3048.0,
            elevation_ft=10000.0,
            coordinates=(39.413, -105.757),
            state="CO",
            is_iconic=True,
        )
        assert p.id == "kenosha-pass"
        assert p.mile == pytest.approx(62.14, abs=0.1)

        d = p.to_dict()
        # Domain keys
        assert d["id"] == "kenosha-pass"
        assert d["name"] == "Kenosha Pass"
        assert d["km"] == 100.0
        assert d["elevation_m"] == 3048.0

        # Frontend keys (camelCase)
        assert d["routeMile"] == 62.1
        assert d["routeKm"] == 100.0
        assert d["elevationMeters"] == 3048
        assert d["elevationFeet"] == 10000
        assert d["lat"] == 39.413
        assert d["lon"] == -105.757
        assert d["state"] == "CO"


@pytest.mark.unit
class TestOSMPassNodeExtractionAndMatching:
    """Tests for extracting and projecting OSM saddle and mountain pass nodes."""

    def test_extract_from_overpass_json(self):
        overpass_data = {
            "elements": [
                {
                    "type": "node",
                    "id": 123456,
                    "lat": 39.413,
                    "lon": -105.757,
                    "tags": {
                        "natural": "saddle",
                        "name": "Kenosha Pass",
                        "ele": "3048"
                    }
                },
                {
                    "type": "node",
                    "id": 999999,
                    "lat": 39.5,
                    "lon": -105.8,
                    "tags": {
                        "highway": "crossing"  # not a pass
                    }
                }
            ]
        }
        nodes = extract_osm_pass_nodes(overpass_data)
        assert len(nodes) == 1
        assert nodes[0]["name"] == "Kenosha Pass"
        assert nodes[0]["ele"] == 3048.0

    def test_match_nodes_within_threshold(self):
        # Route track passing right by Kenosha Pass
        track_points = [
            (39.400, -105.757, 2800.0, 0.0, 0.0),
            (39.413, -105.757, 3048.0, 5.0, 3.1),
            (39.430, -105.757, 2700.0, 10.0, 6.2),
        ]
        # Candidate 1: 50m away (should match)
        # Candidate 2: 800m away (> 500m threshold, should be rejected)
        pass_nodes = [
            {"name": "Immediate Pass", "lat": 39.4135, "lon": -105.757, "ele": 3050.0},
            {"name": "Distant Saddle", "lat": 39.413, "lon": -105.770, "ele": 3200.0},
        ]
        matched = match_pass_nodes_to_track(pass_nodes, track_points, max_distance_m=500.0)
        assert len(matched) == 1
        assert matched[0].name == "Immediate Pass"
        assert matched[0].km == pytest.approx(5.0, abs=0.5)


@pytest.mark.unit
class TestTopographicSaddleAndHighPoint:
    """Tests for elevation profile prominence and high-point identification."""

    def test_topographic_saddle_prominence(self):
        # 10 km profile with a prominent summit in the middle
        # Valley: 0..3km at 2000m
        # Summit: 5km at 2200m (+200m gain)
        # Valley: 7..10km at 2000m (-200m loss)
        pts = [
            (38.0, -106.0, 2000.0, 0.0, 0.0),
            (38.0, -106.0, 2000.0, 2.0, 1.2),
            (38.0, -106.0, 2100.0, 4.0, 2.5),
            (38.0, -106.0, 2200.0, 5.0, 3.1),  # summit
            (38.0, -106.0, 2100.0, 6.0, 3.7),
            (38.0, -106.0, 2000.0, 8.0, 5.0),
            (38.0, -106.0, 2000.0, 10.0, 6.2),
        ]
        saddles = detect_saddles_and_high_points(pts, min_prominence_m=50.0)
        assert len(saddles) >= 1
        summit = saddles[0]
        assert summit.km == 5.0
        assert summit.elevation_m == 2200.0
        assert summit.is_high_point is True

    def test_shallow_bump_rejected(self):
        # 20m bump (< 50m prominence)
        pts = [
            (38.0, -106.0, 2000.0, 0.0, 0.0),
            (38.0, -106.0, 2020.0, 2.0, 1.2),
            (38.0, -106.0, 2000.0, 4.0, 2.5),
        ]
        saddles = detect_saddles_and_high_points(pts, min_prominence_m=50.0)
        # The global high point is recorded, but no prominent topographic saddle
        assert all(s.is_high_point for s in saddles)


@pytest.mark.unit
class TestUnifiedPassPipelineAndClimbLinking:
    """Tests for end-to-end extraction and climb summit linking."""

    def test_climb_linking(self):
        # A track with a climb that peaks at 10.0 km
        track_points = [
            (38.00, -106.0, 2000.0, 0.0, 0.0),
            (38.05, -106.0, 2400.0, 5.0, 3.1),
            (38.10, -106.0, 2800.0, 10.0, 6.2),
            (38.15, -106.0, 2200.0, 15.0, 9.3),
        ]

        climb = Climb(
            id="test-climb-1",
            name="Pass Approach Climb",
            start_km=0.0,
            end_km=10.0,
            length_km=10.0,
            elevation_gain_m=800.0,
            avg_grade=8.0,
            max_grade=14.0,
        )

        geojson = {
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [-106.0, 38.10]},
                    "properties": {
                        "natural": "saddle",
                        "name": "Target Pass",
                        "ele": "2800"
                    }
                }
            ]
        }

        passes = extract_mountain_passes(
            track_points,
            corridor_geojson=geojson,
            climbs=[climb],
            prominence_m=50.0,
            max_distance_m=500.0
        )

        assert len(passes) >= 1
        p = passes[0]
        assert p.climb_id == "test-climb-1"
        assert climb.pass_id == p.id
