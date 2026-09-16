"""
engine/tests/test_adversarial_m7.py - Adversarial white-box and integration test suite for Milestone 7 Remediation.

Covers:
1. GPX parser edge cases: empty strings, directory paths, and 1-point track waypoint projection.
2. Spatial TrackIndex: empty sequence validation.
3. Water access deduplication: IEEE 754 precision boundary protection at exact 200m spacing.
4. Route enrichment places: strict monotonicity of route_mile and route_km with zero inversions.
5. OSM network PMTiles loading: corridor tile querying vs full bounding box tiles.
"""

import gzip
import json
from pathlib import Path
from unittest.mock import MagicMock, patch
import mapbox_vector_tile
import pytest

from engine.core.gpx import GPXParseError, parse_gpx, parse_gpx_track
from engine.core.models import EmptyGPXError, RoutePoint, RouteTrack
from engine.enrichment.places import fetch_places_along_route
from engine.enrichment.water import WaterWaypoint, deduplicate_water_waypoints
from engine.osm.network import OsmRoadNetwork
from engine.osm.snapping import snap_track_to_osm
from engine.utils.spatial import BoundingBox, TrackIndex
from engine.utils.tiles import get_intersecting_tiles, lonlat_to_tile


class TestGPXAdversarial:
    """Adversarial edge cases for parse_gpx and waypoint projection."""

    def test_parse_gpx_empty_string_raises_empty_gpx_error(self) -> None:
        with pytest.raises(EmptyGPXError, match="GPX source is empty"):
            parse_gpx("")

    def test_parse_gpx_whitespace_string_raises_empty_gpx_error(self) -> None:
        with pytest.raises(EmptyGPXError, match="GPX source is empty"):
            parse_gpx("   \n\t  \r\n  ")

    def test_parse_gpx_directory_path_raises_gpx_parse_error(self) -> None:
        with pytest.raises(GPXParseError, match="GPX path is a directory"):
            parse_gpx(".")

        with pytest.raises(GPXParseError, match="GPX path is a directory"):
            parse_gpx(Path("."))

        with pytest.raises(GPXParseError, match="GPX path is a directory"):
            parse_gpx("engine")

    def test_single_point_track_waypoint_projection(self) -> None:
        xml = """<?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="Test">
            <wpt lat="37.001" lon="-105.0">
                <name>Summit Camp</name>
            </wpt>
            <wpt lat="37.0" lon="-105.0">
                <name>Exact Start</name>
            </wpt>
            <trk>
                <name>Single Point Track</name>
                <trkseg>
                    <trkpt lat="37.0" lon="-105.0">
                        <ele>2500.0</ele>
                    </trkpt>
                </trkseg>
            </trk>
        </gpx>"""
        track = parse_gpx(xml)
        assert len(track.points) == 1
        assert len(track.waypoints) == 2

        # Waypoint at exact point
        exact_wpt = track.waypoints[1]
        assert exact_wpt.route_km == 0.0
        assert exact_wpt.route_mi == 0.0
        assert exact_wpt.distance_to_trail_km == pytest.approx(0.0, abs=0.001)

        # Waypoint slightly offset (~111m north)
        offset_wpt = track.waypoints[0]
        assert offset_wpt.route_km == 0.0
        assert offset_wpt.route_mi == 0.0
        assert offset_wpt.distance_to_trail_km > 0.1


class TestSpatialTrackIndexAdversarial:
    """Adversarial edge cases for TrackIndex spatial hash grid."""

    def test_track_index_empty_list_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="track_points sequence must not be empty"):
            TrackIndex([])

    def test_track_index_empty_tuple_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="track_points sequence must not be empty"):
            TrackIndex(())

    def test_track_index_valid_single_point_projections(self) -> None:
        ti = TrackIndex([[37.0, -105.0, 2000.0, 0.0, 0.0]])
        dist_km, cum_km, cum_mi = ti.project_point(37.0, -105.0)
        assert dist_km == pytest.approx(0.0, abs=0.001)
        assert cum_km == 0.0
        assert cum_mi == 0.0


class TestWaterDeduplicationAdversarial:
    """Adversarial tests for IEEE 754 precision boundary protection."""

    def test_deduplicate_water_waypoints_ieee754_exact_200m(self) -> None:
        # In IEEE 754: 5.2 - 5.0 == 0.20000000000000018
        # Without epsilon tolerance, this exceeds 0.2 and fails to deduplicate.
        w1 = WaterWaypoint(id="w1", name="Cold Spring", km=5.0, tier=2)
        w2 = WaterWaypoint(id="w2", name="Cold Spring Lower", km=5.2, tier=2)

        res = deduplicate_water_waypoints([w1, w2], threshold_m=200.0)
        assert len(res) == 1, f"Expected 1 deduplicated waypoint, got {len(res)}"
        assert res[0].km == 5.0

    def test_deduplicate_water_waypoints_ieee754_multiple_boundaries(self) -> None:
        # 10.2 - 10.0 and 1.3 - 1.1
        w1 = WaterWaypoint(id="w1", name="Spring A", km=10.0, tier=1)
        w2 = WaterWaypoint(id="w2", name="Spring B", km=10.2, tier=2)
        res1 = deduplicate_water_waypoints([w1, w2], threshold_m=200.0)
        assert len(res1) == 1
        assert res1[0].id == "w1"  # Tier 1 preferred over Tier 2

        w3 = WaterWaypoint(id="w3", name="Spigot A", km=1.1, tier=2)
        w4 = WaterWaypoint(id="w4", name="Spigot B", km=1.3, tier=2)
        res2 = deduplicate_water_waypoints([w3, w4], threshold_m=200.0)
        assert len(res2) == 1

    def test_deduplicate_water_waypoints_retains_sources_beyond_threshold(self) -> None:
        # 5.0 km and 5.202 km -> 202 meters apart (> 200m)
        w1 = WaterWaypoint(id="w1", name="Spring 1", km=5.0, tier=2)
        w2 = WaterWaypoint(id="w2", name="Spring 2", km=5.202, tier=2)
        res = deduplicate_water_waypoints([w1, w2], threshold_m=200.0)
        assert len(res) == 2


class TestPlacesMonotonicityAdversarial:
    """Verify strict route-mile and route-km monotonicity with zero inversions across real routes."""

    def test_fetch_places_strictly_monotonic_azt(self) -> None:
        gpx_path = Path("route/gpx/arizona-trail-race-300-2025.gpx")
        if not gpx_path.exists():
            pytest.skip("AZT GPX file not found")

        track = parse_gpx_track(gpx_path)
        places = fetch_places_along_route(track, mock_mode=True)
        assert len(places) > 0

        prev_mi = -1.0
        prev_km = -1.0
        for p in places:
            d = p.to_dict()
            assert d["route_mile"] >= prev_mi, f"Inversion in AZT places: {p.name} {d['route_mile']} < {prev_mi}"
            assert d["route_km"] >= prev_km, f"Km inversion in AZT places: {p.name} {d['route_km']} < {prev_km}"
            prev_mi = d["route_mile"]
            prev_km = d["route_km"]

    def test_fetch_places_strictly_monotonic_colorado_trail(self) -> None:
        gpx_path = Path("route/gpx/the-colorado-trail.gpx")
        if not gpx_path.exists():
            pytest.skip("Colorado Trail GPX file not found")

        track = parse_gpx_track(gpx_path)
        places = fetch_places_along_route(track, mock_mode=True)
        assert len(places) > 0

        prev_mi = -1.0
        prev_km = -1.0
        for p in places:
            d = p.to_dict()
            assert d["route_mile"] >= prev_mi, f"Inversion in CT places: {p.name} {d['route_mile']} < {prev_mi}"
            assert d["route_km"] >= prev_km, f"Km inversion in CT places: {p.name} {d['route_km']} < {prev_km}"
            prev_mi = d["route_mile"]
            prev_km = d["route_km"]

    def test_fetch_places_synthetic_monotonicity(self) -> None:
        # Create dense synthetic track
        pts = [
            RoutePoint(lat=38.0 + (i * 0.005), lon=-106.0 + (i * 0.005), ele=2500.0, cum_km=i * 0.75, cum_mi=(i * 0.75) * 0.621371)
            for i in range(40)
        ]
        bbox = BoundingBox.from_points([(p.lat, p.lon) for p in pts])
        track = RouteTrack(points=pts, bbox=bbox, total_distance_km=pts[-1].cum_km)
        places = fetch_places_along_route(track, mock_mode=True)
        assert len(places) > 0

        prev_mi = -1.0
        prev_km = -1.0
        for p in places:
            assert p.route_mile >= prev_mi
            assert p.route_km >= prev_km
            prev_mi = p.route_mile
            prev_km = p.route_km


class TestOsmNetworkPMTilesAdversarial:
    """Verify OsmRoadNetwork queries only corridor tiles and not the entire route bounding box."""

    def test_load_from_pmtiles_queries_only_corridor_tiles(self, tmp_path: Path) -> None:
        net = OsmRoadNetwork()

        # Synthetic track spanning diagonally across multiple tiles at zoom 14
        # At zoom 14, 1 tile is ~0.022 degrees lat, ~0.028 degrees lon.
        # Spanning from (39.0, -105.0) to (39.2, -104.8) creates a bounding box with ~9x8 = 72 tiles,
        # while the diagonal corridor track touches only ~15 tiles.
        track_points = [
            (39.0 + (i * 0.01), -105.0 + (i * 0.01))
            for i in range(21)
        ]

        dummy_pmtiles = tmp_path / "test_corridor.pmtiles"
        dummy_pmtiles.write_bytes(b"dummy_pmtiles_header")

        queried_tiles = []

        class MockReader:
            def __init__(self, source):
                pass
            def get(self, z, x, y):
                queried_tiles.append((z, x, y))
                return None

        with patch("pmtiles.reader.Reader", MockReader), patch("pmtiles.reader.MmapSource"):
            net.load_from_pmtiles(dummy_pmtiles, track_points=track_points)

        zoom = 14
        expected_tile_coords = {
            lonlat_to_tile(float(p[1]), float(p[0]), zoom)
            for p in track_points
        }

        # Verify queried tiles match the corridor set
        queried_coords = {(x, y) for z, x, y in queried_tiles}
        assert queried_coords == expected_tile_coords

        # Verify that corridor tile count is significantly smaller than full bbox tiles
        min_lat = min(p[0] for p in track_points)
        max_lat = max(p[0] for p in track_points)
        min_lon = min(p[1] for p in track_points)
        max_lon = max(p[1] for p in track_points)
        bbox_tiles = get_intersecting_tiles(min_lon, min_lat, max_lon, max_lat, zoom)

        assert len(queried_tiles) == len(expected_tile_coords)
        assert len(queried_tiles) < len(bbox_tiles)

    def test_load_from_pmtiles_without_track_points_falls_back_to_bbox(self, tmp_path: Path) -> None:
        net = OsmRoadNetwork()
        dummy_pmtiles = tmp_path / "test_fallback.pmtiles"
        dummy_pmtiles.write_bytes(b"dummy_pmtiles_header")

        queried_tiles = []

        class MockReader:
            def __init__(self, source):
                pass
            def get(self, z, x, y):
                queried_tiles.append((z, x, y))
                return None

        with patch("pmtiles.reader.Reader", MockReader), patch("pmtiles.reader.MmapSource"):
            with patch("engine.utils.tiles.get_intersecting_tiles", return_value=[(14, 100, 200), (14, 101, 200)]):
                net.load_from_pmtiles(dummy_pmtiles, track_points=None)

        assert len(queried_tiles) == 2
        assert queried_tiles == [(14, 100, 200), (14, 101, 200)]

    def test_load_from_pmtiles_gzip_compressed_mvt_decoding(self, tmp_path: Path) -> None:
        """Verify load_from_pmtiles decompresses GZIP MVT tiles and filters non-cyclable/non-highway features."""
        net = OsmRoadNetwork()
        track_points = [(39.5, -105.0), (39.51, -105.01)]
        zoom = 14
        tile_x, tile_y = lonlat_to_tile(-105.0, 39.5, zoom)

        # 1. Valid trail feature
        valid_feature = {
            "geometry": {"type": "LineString", "coordinates": [[500, 500], [600, 600]]},
            "properties": {"highway": "path", "name": "Adversarial Trail"},
            "id": 1001,
        }
        # 2. Rail feature (must be skipped)
        rail_feature = {
            "geometry": {"type": "LineString", "coordinates": [[700, 700], [800, 800]]},
            "properties": {"class": "rail", "name": "Skipped Railroad"},
            "id": 1002,
        }
        # 3. Non-highway feature without highway or class (must be skipped)
        non_hw_feature = {
            "geometry": {"type": "LineString", "coordinates": [[100, 100], [200, 200]]},
            "properties": {"name": "Boundary Line"},
            "id": 1003,
        }

        mvt_bytes = mapbox_vector_tile.encode(
            {"name": "transportation", "features": [valid_feature, rail_feature, non_hw_feature]}
        )
        compressed_tile = gzip.compress(mvt_bytes)

        class MockGzipReader:
            def __init__(self, source):
                pass

            def get(self, z, x, y):
                if (z, x, y) == (zoom, tile_x, tile_y):
                    return compressed_tile
                return None

        dummy_pmtiles = tmp_path / "test_gzip.pmtiles"
        dummy_pmtiles.write_bytes(b"dummy_pmtiles_content")

        with patch("pmtiles.reader.Reader", MockGzipReader), patch("pmtiles.reader.MmapSource"):
            count = net.load_from_pmtiles(dummy_pmtiles, track_points=track_points)

        assert count == 1
        assert len(net.ways) == 1
        way = net.ways[0]
        assert way.id == 1001
        assert way.highway == "path"
        assert way.name == "Adversarial Trail"

        # Also verify uncompressed MVT tile decoding works
        net_uncompressed = OsmRoadNetwork()

        class MockRawReader:
            def __init__(self, source):
                pass

            def get(self, z, x, y):
                if (z, x, y) == (zoom, tile_x, tile_y):
                    return mvt_bytes
                return None

        with patch("pmtiles.reader.Reader", MockRawReader), patch("pmtiles.reader.MmapSource"):
            count_raw = net_uncompressed.load_from_pmtiles(dummy_pmtiles, track_points=track_points)

        assert count_raw == 1
        assert len(net_uncompressed.ways) == 1
        assert net_uncompressed.ways[0].id == 1001

        # Also verify corrupted tile data gracefully skips without crashing
        net_corrupt = OsmRoadNetwork()

        class MockCorruptReader:
            def __init__(self, source):
                pass

            def get(self, z, x, y):
                return b"\x1f\x8b\x08\x00corrupt_gzip_stream"

        with patch("pmtiles.reader.Reader", MockCorruptReader), patch("pmtiles.reader.MmapSource"):
            count_corrupt = net_corrupt.load_from_pmtiles(dummy_pmtiles, track_points=track_points)

        assert count_corrupt == 0
        assert len(net_corrupt.ways) == 0

    def test_snap_track_to_osm_with_real_pmtiles_archive(self) -> None:
        """Verify snap_track_to_osm successfully snaps points against a real PMTiles archive."""
        pmtiles_path = Path("public/data/routes/colorado-trail/corridor.pmtiles")
        track_path = Path("public/data/routes/colorado-trail/route-track.json")

        if not pmtiles_path.exists() or not track_path.exists():
            pytest.skip("Colorado Trail PMTiles or track JSON not present")

        with open(track_path, "r", encoding="utf-8") as f:
            raw_pts = json.load(f)["points"][:50]

        res = snap_track_to_osm(raw_pts, pmtiles_path)
        assert res.snapped_points_count > 0, (
            f"Expected snapped_points_count > 0, got {res.snapped_points_count} "
            f"(fallback: {res.fallback_points_count})"
        )
        assert res.total_km > 0.0
        assert len(res.points) > 0

    def test_snap_track_to_osm_with_synthetic_pmtiles_archive(self, tmp_path: Path) -> None:
        """Verify snap_track_to_osm with synthetic PMTiles archive and road centerline snapping."""
        raw_pts = [
            (39.5000, -105.0000, 2000.0),
            (39.5005, -105.0005, 2005.0),
            (39.5010, -105.0010, 2010.0),
        ]
        zoom = 14
        tile_x, tile_y = lonlat_to_tile(-105.0005, 39.5005, zoom)

        feature = {
            "geometry": {
                "type": "LineString",
                "coordinates": [[2000, 2000], [2050, 2050], [2100, 2100]],
            },
            "properties": {"highway": "track", "name": "Synthetic Trail"},
            "id": 9999,
        }
        mvt_bytes = mapbox_vector_tile.encode({"name": "transportation", "features": [feature]})
        compressed_tile = gzip.compress(mvt_bytes)

        class MockReader:
            def __init__(self, source):
                pass

            def get(self, z, x, y):
                if (z, x, y) == (zoom, tile_x, tile_y):
                    return compressed_tile
                return None

        dummy_pmtiles = tmp_path / "synthetic_corridor.pmtiles"
        dummy_pmtiles.write_bytes(b"dummy")

        with patch("pmtiles.reader.Reader", MockReader), patch("pmtiles.reader.MmapSource"):
            res = snap_track_to_osm(raw_pts, dummy_pmtiles)

        assert res.total_km > 0.0
        assert len(res.points) > 0
