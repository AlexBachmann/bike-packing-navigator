"""
engine/tests/test_osm_corridor.py - Comprehensive unit tests for OSM corridor extraction and Overpass querying.
"""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch
import urllib.error
import pytest

from engine.core.models import RoutePoint, RouteTrack
from engine.osm.corridor import (
    FeatureType,
    OSMError,
    OverpassError,
    OverpassTimeoutError,
    build_overpass_query,
    compute_corridor_bbox,
    extract_osm_corridor_data,
    fetch_overpass_data,
    generate_corridor_polygon,
    partition_track_bboxes,
)
from engine.utils.spatial import BoundingBox


class TestCorridorBoundingBox:
    """Verifies bounding box calculation and buffer margin expansion."""

    def test_compute_corridor_bbox_dimensions(self):
        # Point in Colorado: (40.0, -105.0)
        pts = [(40.0, -105.0), (40.1, -104.9)]
        bbox = compute_corridor_bbox(pts, corridor_m=18000.0)

        # 18 km latitude delta ~ 18000 / 111132 ~ 0.16197 deg
        expected_lat_delta = 18000.0 / 111132.0
        assert bbox.min_lat == pytest.approx(40.0 - expected_lat_delta, abs=0.005)
        assert bbox.max_lat == pytest.approx(40.1 + expected_lat_delta, abs=0.005)

        # Longitude delta scaled by cos(mid_lat)
        assert bbox.min_lon < -105.0
        assert bbox.max_lon > -104.9

    def test_corridor_bbox_polar_and_equator(self):
        # At equator
        eq_pts = [(0.0, 0.0), (0.01, 0.01)]
        eq_bbox = compute_corridor_bbox(eq_pts, corridor_m=11113.2)  # ~0.1 deg
        assert eq_bbox.min_lat == pytest.approx(-0.1, abs=0.01)
        assert eq_bbox.min_lon == pytest.approx(-0.1, abs=0.01)

        # At high latitude (60° N where cos(60°) = 0.5)
        polar_pts = [(60.0, 10.0), (60.01, 10.01)]
        polar_bbox = compute_corridor_bbox(polar_pts, corridor_m=11113.2)
        # Longitude delta should be approximately double the latitude delta
        lat_span = polar_bbox.max_lat - 60.01
        lon_span = polar_bbox.max_lon - 10.01
        assert lon_span == pytest.approx(lat_span * 2.0, rel=0.1)

    def test_corridor_bbox_empty_track_raises(self):
        with pytest.raises(ValueError, match="empty"):
            compute_corridor_bbox([])


class TestTrackPartitioning:
    """Verifies track partitioning for long routes into overlapping bounding boxes."""

    def test_partition_track_short_route_single_bbox(self):
        # Track of ~20 km (0.2 deg lat is ~22 km)
        pts = [[40.0 + i * 0.02, -105.0, 1500.0, i * 2.2, i * 1.3] for i in range(10)]
        bboxes = partition_track_bboxes(pts, max_chunk_km=50.0, corridor_m=18000.0)
        assert len(bboxes) == 1
        assert isinstance(bboxes[0], BoundingBox)

    def test_partition_track_long_route_multi_bbox(self):
        # Track of ~220 km (2.0 degrees lat is ~222 km)
        pts = [[40.0 + i * 0.02, -105.0, 1500.0, i * 2.2, i * 1.3] for i in range(101)]
        bboxes = partition_track_bboxes(pts, max_chunk_km=50.0, overlap_km=5.0, corridor_m=18000.0)
        # Should create ~5 overlapping chunks
        assert len(bboxes) >= 4
        assert len(bboxes) <= 7

    def test_partition_overlap_continuity(self):
        # 120 km route
        pts = [[40.0 + i * 0.01, -105.0, 1500.0, i * 1.1, i * 0.7] for i in range(110)]
        bboxes = partition_track_bboxes(pts, max_chunk_km=40.0, overlap_km=10.0, corridor_m=1000.0)
        assert len(bboxes) >= 3

        # Verify consecutive bounding boxes overlap in latitude
        for i in range(1, len(bboxes)):
            prev_box = bboxes[i - 1]
            curr_box = bboxes[i]
            # Current box min_lat should be lower than previous box max_lat (overlap)
            assert curr_box.min_lat < prev_box.max_lat


class TestCorridorPolygon:
    """Verifies GeoJSON polygon corridor generation."""

    def test_generate_corridor_polygon_structure(self):
        pts = [(40.0, -105.0), (40.05, -105.0), (40.1, -105.05)]
        geojson = generate_corridor_polygon(pts, corridor_m=5000.0, route_name="Test Corridor")

        assert geojson["type"] == "FeatureCollection"
        assert len(geojson["features"]) == 1
        feat = geojson["features"][0]
        assert feat["type"] == "Feature"
        assert feat["properties"]["name"] == "Test Corridor"
        assert feat["geometry"]["type"] in ("Polygon", "MultiPolygon")

    def test_polygon_contains_route_points(self):
        pts = [(40.0, -105.0), (40.05, -105.0), (40.1, -105.05)]
        geojson = generate_corridor_polygon(pts, corridor_m=5000.0)
        geom = geojson["features"][0]["geometry"]

        from shapely.geometry import shape, Point
        poly = shape(geom)
        for lat, lon in pts:
            # Note: GeoJSON coordinates are [lon, lat]
            pt = Point(lon, lat)
            assert poly.contains(pt) or poly.touches(pt)


class TestOverpassQueryBuilder:
    """Verifies Overpass QL query construction."""

    def test_build_overpass_query_highways(self):
        bbox = BoundingBox(min_lat=40.0, min_lon=-105.0, max_lat=40.5, max_lon=-104.5)
        query = build_overpass_query(bbox, feature_type=FeatureType.HIGHWAYS, timeout_sec=60)

        assert "[out:json]" in query
        assert "[timeout:60]" in query
        assert "out geom;" in query
        assert 'way["highway"~' in query
        assert "40.00000,-105.00000,40.50000,-104.50000" in query
        assert 'way["waterway"' not in query

    def test_build_overpass_query_water(self):
        bbox = BoundingBox(min_lat=40.0, min_lon=-105.0, max_lat=40.5, max_lon=-104.5)
        query = build_overpass_query(bbox, feature_type=FeatureType.WATER)

        assert 'way["waterway"~' in query
        assert 'way["natural"="water"]' in query
        assert 'node["natural"="spring"]' in query
        assert 'node["amenity"="drinking_water"]' in query
        assert 'way["highway"~' not in query

    def test_build_overpass_query_all(self):
        bbox = BoundingBox(min_lat=40.0, min_lon=-105.0, max_lat=40.5, max_lon=-104.5)
        query = build_overpass_query(bbox, feature_type=FeatureType.ALL)

        assert 'way["highway"~' in query
        assert 'way["waterway"~' in query
        assert 'node["natural"="spring"]' in query


class TestOverpassFetchingAndResilience:
    """Verifies caching, mock mode, and mirror fallback behavior."""

    def test_overpass_fetch_mock_mode(self, tmp_path):
        mock_data = {
            "version": 0.6,
            "generator": "Overpass Mock",
            "elements": [{"type": "way", "id": 12345, "tags": {"highway": "track"}}]
        }
        cache_file = tmp_path / "test_mock_cache.json"
        res = fetch_overpass_data(
            query="test query",
            cache_path=cache_file,
            mock_response=mock_data
        )
        assert res == mock_data
        assert cache_file.exists()

    def test_overpass_fetch_reads_existing_cache(self, tmp_path):
        cached_data = {
            "version": 0.6,
            "generator": "Cached File",
            "elements": [{"type": "way", "id": 9999}]
        }
        cache_file = tmp_path / "existing_cache.json"
        with open(cache_file, "w") as f:
            json.dump(cached_data, f)

        res = fetch_overpass_data(query="any", cache_path=cache_file)
        assert res == cached_data

    @patch("urllib.request.urlopen")
    def test_overpass_mirror_fallback(self, mock_urlopen):
        # First mirror returns HTTP 504, second mirror returns HTTP 200
        fail_response = urllib.error.HTTPError("url1", 504, "Gateway Timeout", {}, None)
        success_response = MagicMock()
        success_response.status = 200
        success_response.__enter__.return_value = success_response
        success_response.read.return_value = json.dumps({
            "version": 0.6,
            "elements": [{"type": "way", "id": 42}]
        }).encode("utf-8")

        mock_urlopen.side_effect = [fail_response, success_response]

        mirrors = [
            "https://mock-mirror-1.org/api/interpreter",
            "https://mock-mirror-2.org/api/interpreter"
        ]

        res = fetch_overpass_data(query="test", mirrors=mirrors, retries=1)
        assert res["elements"][0]["id"] == 42
        assert mock_urlopen.call_count == 2

    @patch("urllib.request.urlopen")
    def test_overpass_all_mirrors_fail(self, mock_urlopen):
        fail_response = urllib.error.HTTPError("url", 502, "Bad Gateway", {}, None)
        mock_urlopen.side_effect = fail_response

        mirrors = ["https://mirror1.org/api", "https://mirror2.org/api"]
        with pytest.raises(OverpassError, match="All Overpass mirrors failed"):
            fetch_overpass_data(query="test", mirrors=mirrors, retries=1)

    def test_extract_osm_corridor_data_orchestrator(self, tmp_path):
        pts = [(40.0, -105.0), (40.05, -105.0)]
        mock_payload = {
            "version": 0.6,
            "elements": [
                {"type": "way", "id": 1, "tags": {"highway": "track"}},
                {"type": "way", "id": 2, "tags": {"highway": "path"}}
            ]
        }
        res = extract_osm_corridor_data(
            points_or_track=pts,
            cache_path=tmp_path / "aggregated.json",
            mock_response=mock_payload
        )
        assert len(res["elements"]) == 2
        assert (tmp_path / "aggregated.json").exists()
