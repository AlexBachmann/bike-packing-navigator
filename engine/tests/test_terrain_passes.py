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

    def test_summit_spacing_and_deduplication(self):
        # 3 local peaks close together (e.g. within 2 km of each other on a high ridge)
        # Peak 1 at 10km (2200m, prom 200m)
        # Peak 2 at 11km (2250m, prom 250m) - dominant peak!
        # Peak 3 at 12km (2190m, prom 190m)
        pts = [
            (38.0, -106.0, 2000.0, 0.0, 0.0),
            (38.0, -106.0, 2200.0, 10.0, 6.2), # Peak 1
            (38.0, -106.0, 2180.0, 10.5, 6.5),
            (38.0, -106.0, 2250.0, 11.0, 6.8), # Peak 2 (dominant)
            (38.0, -106.0, 2170.0, 11.5, 7.1),
            (38.0, -106.0, 2190.0, 12.0, 7.5), # Peak 3
            (38.0, -106.0, 2000.0, 25.0, 15.5),
        ]
        passes = detect_saddles_and_high_points(
            pts,
            min_prominence_m=150.0,
            min_spacing_km=15.0
        )
        # The 3 peaks should be coalesced into 1 pass (the dominant peak at 11km, 2250m)
        assert len(passes) == 1
        assert passes[0].km == 11.0
        assert passes[0].elevation_m == 2250.0

    def test_curated_passes_preservation(self, tmp_path):
        from engine.terrain.passes import is_curated_pass_list, load_curated_passes
        curated_file = tmp_path / "passes.json"
        sample_data = [
            {
                "id": "indiana-pass",
                "name": "Indiana Pass (Course High Point)",
                "routeMile": 1947.9,
                "routeKm": 3134.8,
                "elevationMeters": 3537,
                "elevationFeet": 11604,
                "lat": 37.47,
                "lon": -106.50,
                "difficulty": "extreme",
                "notes": "The highest elevation on the entire 2,679-mile route."
            }
        ]
        import json
        curated_file.write_text(json.dumps(sample_data), encoding="utf-8")

        loaded = load_curated_passes(curated_file)
        assert len(loaded) == 1
        assert loaded[0].name == "Indiana Pass (Course High Point)"
        assert loaded[0].km == 3134.8
        assert is_curated_pass_list(loaded) is True

        # Pipeline with curated passes returns them directly
        pts = [(37.47, -106.50, 3537.0, 3134.8, 1947.9), (37.48, -106.51, 3500.0, 3140.0, 1951.1)]
        passes = extract_mountain_passes(pts, curated_passes=loaded)
        assert len(passes) == 1
        assert passes[0].id == "indiana-pass"

    def test_evocative_climb_naming_enrichment(self):
        # Generic summit should inherit climb name if climb has an authentic name
        track_points = [
            (38.00, -106.0, 2000.0, 0.0, 0.0),
            (38.05, -106.0, 2400.0, 5.0, 3.1),
            (38.10, -106.0, 2800.0, 10.0, 6.2), # summit of climb
            (38.15, -106.0, 2200.0, 20.0, 12.4),
            (38.20, -106.0, 3200.0, 40.0, 24.8), # separate higher peak
            (38.25, -106.0, 2000.0, 60.0, 37.2),
        ]
        climb = Climb(
            id="marshall-pass-climb",
            name="Marshall Pass Ascent",
            start_km=0.0,
            end_km=10.0,
            length_km=10.0,
            elevation_gain_m=800.0,
            avg_grade=8.0,
            max_grade=12.0,
        )
        passes = extract_mountain_passes(
            track_points,
            climbs=[climb],
            prominence_m=150.0,
            min_spacing_km=15.0
        )
        assert len(passes) >= 1
        pass_at_summit = next(p for p in passes if abs(p.km - 10.0) < 1.0)
        assert pass_at_summit.name == "Marshall Pass Ascent Summit"

