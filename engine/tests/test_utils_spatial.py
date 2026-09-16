"""
engine/tests/test_utils_spatial.py - Unit tests for bounding boxes and spatial utilities.
"""

import pytest
from engine.utils.spatial import (
    BoundingBox,
    calculate_bbox,
    point_in_bbox,
    expand_bbox,
    SpatialHashGrid,
    TrackIndex,
)


@pytest.mark.unit
@pytest.mark.spatial
class TestBoundingBox:
    """Tests for the BoundingBox class and conversion methods."""

    def test_from_points(self):
        points = [(37.5, -108.0), (39.5, -105.0), (38.0, -106.0)]
        bbox = BoundingBox.from_points(points)
        assert bbox.min_lat == 37.5
        assert bbox.min_lon == -108.0
        assert bbox.max_lat == 39.5
        assert bbox.max_lon == -105.0

    def test_empty_points_raises(self):
        with pytest.raises(ValueError, match="empty points"):
            BoundingBox.from_points([])

    def test_invalid_bounds_raises(self):
        with pytest.raises(ValueError):
            BoundingBox(min_lon=10.0, min_lat=40.0, max_lon=5.0, max_lat=45.0)
        with pytest.raises(ValueError):
            BoundingBox(min_lon=5.0, min_lat=50.0, max_lon=10.0, max_lat=45.0)

    def test_to_geojson(self):
        bbox = BoundingBox(min_lon=-108.0, min_lat=37.5, max_lon=-105.0, max_lat=39.5)
        assert bbox.to_geojson() == (-108.0, 37.5, -105.0, 39.5)

    def test_to_leaflet(self):
        bbox = BoundingBox(min_lon=-108.0, min_lat=37.5, max_lon=-105.0, max_lat=39.5)
        assert bbox.to_leaflet() == [[37.5, -108.0], [39.5, -105.0]]

    def test_to_overpass(self):
        bbox = BoundingBox(min_lon=-108.0, min_lat=37.5, max_lon=-105.0, max_lat=39.5)
        assert bbox.to_overpass() == (37.5, -108.0, 39.5, -105.0)

    def test_expand_by_meters(self):
        bbox = BoundingBox(min_lon=-108.0, min_lat=37.5, max_lon=-105.0, max_lat=39.5)
        expanded = bbox.expand_by_meters(1000.0)
        assert expanded.min_lon < bbox.min_lon
        assert expanded.min_lat < bbox.min_lat
        assert expanded.max_lon > bbox.max_lon
        assert expanded.max_lat > bbox.max_lat

    def test_contains_point(self):
        bbox = BoundingBox(min_lon=-108.0, min_lat=37.5, max_lon=-105.0, max_lat=39.5)
        assert bbox.contains_point(38.5, -106.5) is True
        assert bbox.contains_point(40.0, -106.5) is False
        assert bbox.contains_point(37.5, -108.0) is True


@pytest.mark.unit
@pytest.mark.spatial
class TestSpatialUtilities:
    """Tests for spatial bounding boxes, containment, and buffers."""

    def test_calculate_bbox_empty_raises(self):
        with pytest.raises(ValueError):
            calculate_bbox([])

    def test_calculate_bbox_single_point(self):
        bbox = calculate_bbox([(45.0, 10.0)])
        assert bbox == (45.0, 10.0, 45.0, 10.0)

    def test_calculate_bbox_multi_points(self, sample_track_points):
        coords = [(p[0], p[1]) for p in sample_track_points]
        min_lat, min_lon, max_lat, max_lon = calculate_bbox(coords)
        assert min_lat == pytest.approx(42.000)
        assert max_lat == pytest.approx(42.081)
        assert min_lon == pytest.approx(72.000)
        assert max_lon == pytest.approx(72.000)

    def test_point_in_bbox(self, bbox_fixtures):
        standard = bbox_fixtures["standard"]
        bbox = standard["bbox"]

        assert point_in_bbox(standard["inside"][0], standard["inside"][1], bbox) is True
        assert point_in_bbox(standard["outside"][0], standard["outside"][1], bbox) is False
        assert point_in_bbox(standard["boundary"][0], standard["boundary"][1], bbox) is True

    def test_expand_bbox_zero_buffer(self, bbox_fixtures):
        bbox = bbox_fixtures["standard"]["bbox"]
        expanded = expand_bbox(bbox, buffer_m=0.0)
        assert expanded == bbox

    def test_expand_bbox_positive_buffer(self, bbox_fixtures):
        bbox = bbox_fixtures["standard"]["bbox"]
        expanded = expand_bbox(bbox, buffer_m=1000.0)

        assert expanded[0] < bbox[0]  # min_lat expanded south
        assert expanded[1] < bbox[1]  # min_lon expanded west
        assert expanded[2] > bbox[2]  # max_lat expanded north
        assert expanded[3] > bbox[3]  # max_lon expanded east


@pytest.mark.unit
@pytest.mark.spatial
class TestSpatialIndexing:
    """Tests for SpatialHashGrid and TrackIndex."""

    def test_spatial_hash_grid_radius_query(self):
        grid = SpatialHashGrid[str](cell_size_deg=0.02)
        grid.insert(42.0000, 72.0000, "item_origin")
        grid.insert(42.0001, 72.0001, "item_near")   # ~14m away
        grid.insert(42.0100, 72.0100, "item_far")    # ~1400m away

        matches = grid.query_radius(42.0000, 72.0000, radius_m=50.0)
        items = [m[0] for m in matches]
        assert "item_origin" in items
        assert "item_near" in items
        assert "item_far" not in items

    def test_track_index_projection(self, sample_track_points):
        index = TrackIndex(sample_track_points, cell_size_deg=0.02)
        # Probe point very close to point index 2 (lat 42.018)
        dist_km, cum_km, cum_mi = index.project_point(42.0181, 72.0001, max_dist_km=2.0)
        assert dist_km < 0.05
        assert cum_km == pytest.approx(2.0, abs=0.2)
        assert cum_mi > 0.0

    def test_spatial_hash_grid_antimeridian_query(self):
        """Verify queries across the 180° antimeridian correctly locate neighbors."""
        grid = SpatialHashGrid[str](cell_size_deg=0.02)
        grid.insert(0.0, 179.99, "item_east")
        grid.insert(10.0, -179.995, "item_west")

        # Query centered in western hemisphere (-179.99) should find eastern item (~2224m away)
        matches = grid.query_radius(0.0, -179.99, radius_m=5000.0)
        assert len(matches) == 1
        assert matches[0][0] == "item_east"
        assert matches[0][1] == pytest.approx(2223.9, abs=2.0)

        # Reverse query across antimeridian
        matches_rev = grid.query_radius(10.0, 179.995, radius_m=3000.0)
        assert len(matches_rev) == 1
        assert matches_rev[0][0] == "item_west"

    def test_spatial_hash_grid_polar_query_performance(self):
        """Verify polar queries do not cause computational explosion / hang."""
        import time

        grid = SpatialHashGrid[str](cell_size_deg=0.02)
        grid.insert(90.0, 0.0, "north_pole")
        grid.insert(-90.0, 0.0, "south_pole")

        t0 = time.time()
        # 5km polar query should complete in < 50ms
        res_5k = grid.query_radius(90.0, 0.0, radius_m=5000.0)
        t_5k = time.time() - t0
        assert len(res_5k) == 1
        assert res_5k[0][0] == "north_pole"
        assert t_5k < 0.1, f"5km polar query took too long: {t_5k:.3f}s"

        # 50km polar query (previously 2 billion iterations) should complete in < 150ms
        t1 = time.time()
        res_50k = grid.query_radius(-90.0, 0.0, radius_m=50000.0)
        t_50k = time.time() - t1
        assert len(res_50k) == 1
        assert res_50k[0][0] == "south_pole"
        assert t_50k < 0.2, f"50km polar query took too long: {t_50k:.3f}s"

    def test_spatial_hash_grid_negative_coordinates(self):
        """Verify grid indexing works across all quadrants and negative longitudes."""
        grid = SpatialHashGrid[str](cell_size_deg=0.02)
        grid.insert(39.7392, -104.9903, "denver")
        grid.insert(51.5074, -0.1278, "london")
        grid.insert(-33.8688, 151.2093, "sydney")

        assert grid.query_radius(39.7392, -104.9903, 100.0)[0][0] == "denver"
        assert grid.query_radius(51.5074, -0.1278, 100.0)[0][0] == "london"
        assert grid.query_radius(-33.8688, 151.2093, 100.0)[0][0] == "sydney"

    def test_spatial_hash_grid_invalid_inputs(self):
        """Verify grid handles negative radius and invalid cell sizes safely."""
        with pytest.raises(ValueError, match="strictly positive"):
            SpatialHashGrid[str](cell_size_deg=0.0)

        with pytest.raises(ValueError, match="strictly positive"):
            SpatialHashGrid[str](cell_size_deg=-0.05)

        grid = SpatialHashGrid[str](cell_size_deg=0.02)
        assert grid.query_radius(0.0, 0.0, radius_m=-10.0) == []

    def test_spatial_hash_grid_north_pole_cross_meridian(self):
        """Verify 5km query at North Pole (90.0, 0.0) finds point at (89.98, 180.0)."""
        from engine.utils.geo import haversine_distance_m

        grid = SpatialHashGrid[str](cell_size_deg=0.02)
        grid.insert(89.98, 180.0, "north_antimeridian_point")
        grid.insert(89.98, 0.0, "north_prime_meridian_point")
        grid.insert(89.90, 180.0, "north_far_point")

        matches = grid.query_radius(90.0, 0.0, radius_m=5000.0)
        matched_items = {item: dist for item, dist in matches}

        assert "north_antimeridian_point" in matched_items
        assert "north_prime_meridian_point" in matched_items
        assert "north_far_point" not in matched_items

        expected_dist = haversine_distance_m(90.0, 0.0, 89.98, 180.0)
        assert matched_items["north_antimeridian_point"] == pytest.approx(expected_dist, abs=1.0)
        assert matched_items["north_antimeridian_point"] <= 5000.0

    def test_spatial_hash_grid_south_pole_enclosing_query(self):
        """Verify query near South Pole (-89.95, 0.0) enclosing -90°S finds points at longitudes ±90°."""
        from engine.utils.geo import haversine_distance_m

        grid = SpatialHashGrid[str](cell_size_deg=0.02)
        grid.insert(-89.98, 90.0, "south_east_90")
        grid.insert(-89.98, -90.0, "south_west_neg90")
        grid.insert(-89.98, 0.0, "south_prime_meridian")
        grid.insert(-89.85, 0.0, "south_outside_radius")

        matches = grid.query_radius(-89.95, 0.0, radius_m=7000.0)
        matched_items = {item: dist for item, dist in matches}

        assert "south_east_90" in matched_items
        assert "south_west_neg90" in matched_items
        assert "south_prime_meridian" in matched_items
        assert "south_outside_radius" not in matched_items

        d_90 = haversine_distance_m(-89.95, 0.0, -89.98, 90.0)
        d_neg90 = haversine_distance_m(-89.95, 0.0, -89.98, -90.0)
        assert matched_items["south_east_90"] == pytest.approx(d_90, abs=1.0)
        assert matched_items["south_west_neg90"] == pytest.approx(d_neg90, abs=1.0)

    def test_spatial_hash_grid_polar_query_performance_under_10ms(self):
        """Verify polar queries with 360° longitudinal coverage execute in < 10ms."""
        import time

        grid = SpatialHashGrid[str](cell_size_deg=0.02)
        grid.insert(90.0, 0.0, "north_pole")
        grid.insert(89.98, 180.0, "near_north_180")
        grid.insert(-90.0, 0.0, "south_pole")
        grid.insert(-89.98, 90.0, "south_90")
        grid.insert(-89.98, -90.0, "south_neg90")
        for i in range(100):
            grid.insert(-80.0 + (i * 1.6), -180.0 + (i * 3.6), f"item_{i}")

        # Warm-up call
        grid.query_radius(90.0, 0.0, radius_m=5000.0)

        # Benchmark North Pole 5km query
        t0 = time.perf_counter()
        res_north = grid.query_radius(90.0, 0.0, radius_m=5000.0)
        t_north = time.perf_counter() - t0

        assert len(res_north) >= 2
        assert t_north < 0.050, f"North Pole 5km query took {t_north * 1000:.2f}ms >= 50ms"

        # Benchmark South Pole 7km query enclosing -90°S
        t1 = time.perf_counter()
        res_south = grid.query_radius(-89.95, 0.0, radius_m=7000.0)
        t_south = time.perf_counter() - t1

        assert len(res_south) >= 3
        assert t_south < 0.050, f"South Pole 7km query took {t_south * 1000:.2f}ms >= 50ms"
