"""
engine/tests/test_tiles_math.py - Unit tests for Web Mercator tile math, conversions, and corridor logic.
"""

import math
import pytest

from engine.tiles.math import (
    TileCoord,
    TileRange,
    xyz_to_tms,
    tms_to_xyz,
    tile_to_quadkey,
    quadkey_to_tile,
    tile_to_tileid,
    tileid_to_tile,
    ground_resolution,
    map_scale,
    meters_to_tile_pixels,
    parent_tile,
    children_tiles,
    tile_neighbors,
    tiles_for_bbox_pyramid,
    tiles_for_corridor,
    tile_range_for_bbox,
    get_intersecting_tiles,
)
from engine.utils.spatial import BoundingBox


@pytest.mark.unit
@pytest.mark.tiles
class TestTileCoord:
    """Tests for TileCoord dataclass."""

    def test_tile_coord_creation_and_unpacking(self):
        tc = TileCoord(10, 511, 340)
        assert tc.z == 10
        assert tc.x == 511
        assert tc.y == 340

        # Sequence protocol unpacking
        z, x, y = tc
        assert (z, x, y) == (10, 511, 340)
        assert len(tc) == 3
        assert tc[0] == 10
        assert tc[1] == 511
        assert tc[2] == 340

    def test_tile_coord_invalid_raises(self):
        with pytest.raises(ValueError, match="Invalid tile coordinate"):
            TileCoord(2, 5, 1)  # x=5 exceeds max 3 at zoom 2

    def test_tile_coord_properties(self):
        tc = TileCoord(10, 511, 340)
        w, s, e, n = tc.bounds
        assert w < e
        assert s < n
        assert tc.bbox.min_lon == w

        cx, cy = tc.center
        assert w < cx < e
        assert s < cy < n

        # Parent and children
        parent = tc.parent
        assert parent is not None
        assert parent.z == 9
        assert parent.x == 255
        assert parent.y == 170

        children = tc.children
        assert len(children) == 4
        for c in children:
            assert c.z == 11

        # Root tile has no parent
        root = TileCoord(0, 0, 0)
        assert root.parent is None

    def test_tile_coord_neighbors(self):
        tc = TileCoord(5, 10, 10)
        nbrs = tc.neighbors(buffer_radius=1)
        assert len(nbrs) == 9
        assert tc in nbrs

    def test_tile_coord_to_tms(self):
        tc = TileCoord(10, 511, 340)
        z, tx, ty = tc.to_tms()
        assert z == 10
        assert tx == 511
        assert ty == (1024 - 1 - 340)


@pytest.mark.unit
@pytest.mark.tiles
class TestTileRange:
    """Tests for TileRange dataclass."""

    def test_tile_range_iteration_and_count(self):
        tr = TileRange(zoom=4, min_x=2, min_y=3, max_x=4, max_y=5)
        assert tr.count == 3 * 3  # (4-2+1) * (5-3+1) = 9
        tiles = list(tr)
        assert len(tiles) == 9
        for tc in tiles:
            assert tc.z == 4
            assert 2 <= tc.x <= 4
            assert 3 <= tc.y <= 5

    def test_tile_range_invalid_raises(self):
        with pytest.raises(ValueError):
            TileRange(zoom=4, min_x=5, min_y=2, max_x=3, max_y=4)


@pytest.mark.unit
@pytest.mark.tiles
class TestCoordinateConversions:
    """Tests for TMS, QuadKey, and Hilbert tile ID conversions."""

    def test_tms_roundtrip(self):
        for z in [0, 5, 10, 14]:
            x = 0 if z == 0 else 2 ** (z - 1)
            y = 0 if z == 0 else 2 ** (z - 1)
            tx, ty = xyz_to_tms(x, y, z)
            rx, ry = tms_to_xyz(tx, ty, z)
            assert (rx, ry) == (x, y)

    def test_quadkey_roundtrip(self):
        # Known QuadKey values
        # Zoom 1: (0,0) -> "0", (1,0) -> "1", (0,1) -> "2", (1,1) -> "3"
        assert tile_to_quadkey(0, 0, 1) == "0"
        assert tile_to_quadkey(1, 0, 1) == "1"
        assert tile_to_quadkey(0, 1, 1) == "2"
        assert tile_to_quadkey(1, 1, 1) == "3"

        # Roundtrip across various zooms
        for z in range(1, 12):
            x = (1 << z) // 3
            y = (1 << z) // 4
            qk = tile_to_quadkey(x, y, z)
            assert len(qk) == z
            rz, rx, ry = quadkey_to_tile(qk)
            assert (rz, rx, ry) == (z, x, y)

    def test_quadkey_invalid_chars(self):
        with pytest.raises(ValueError, match="Invalid QuadKey"):
            quadkey_to_tile("0124")

    def test_tileid_roundtrip(self):
        for z in [0, 5, 10, 14]:
            x = 0 if z == 0 else 2 ** (z - 1)
            y = 0 if z == 0 else 2 ** (z - 1)
            tid = tile_to_tileid(z, x, y)
            assert isinstance(tid, int)
            assert tid >= 0
            rz, rx, ry = tileid_to_tile(tid)
            assert (rz, rx, ry) == (z, x, y)


@pytest.mark.unit
@pytest.mark.tiles
class TestGeodeticMath:
    """Tests for ground resolution and map scale calculations."""

    def test_ground_resolution_halving(self):
        res0 = ground_resolution(0.0, 0)
        res1 = ground_resolution(0.0, 1)
        assert res1 == pytest.approx(res0 / 2.0, rel=1e-5)

        # Latitude 60 degrees has cos(60) = 0.5, so resolution is half of equator
        res_eq = ground_resolution(0.0, 10)
        res_60 = ground_resolution(60.0, 10)
        assert res_60 == pytest.approx(res_eq * 0.5, rel=1e-4)

    def test_map_scale(self):
        scale = map_scale(0.0, 10, dpi=96.0)
        assert scale > 0.0

    def test_meters_to_tile_pixels(self):
        # 100 meters at zoom 14 should correspond to dozens of pixels
        px = meters_to_tile_pixels(100.0, 40.0, 14, extent=4096)
        assert px > 10.0


@pytest.mark.unit
@pytest.mark.tiles
class TestTileHierarchy:
    """Tests for parent, children, and neighbor calculations."""

    def test_parent_and_children(self):
        z, x, y = 10, 511, 340
        pz, px, py = parent_tile(z, x, y)
        assert (pz, px, py) == (9, 255, 170)

        children = children_tiles(z, x, y)
        assert len(children) == 4
        for cz, cx, cy in children:
            assert cz == 11
            assert parent_tile(cz, cx, cy) == (z, x, y)

    def test_tile_neighbors_boundary_clamping(self):
        # Corner tile at zoom 2 (x=0, y=0)
        nbrs = tile_neighbors(2, 0, 0, buffer_radius=1)
        # Should only contain 4 tiles: (0,0), (0,1), (1,0), (1,1)
        assert len(nbrs) == 4
        for z, x, y in nbrs:
            assert z == 2
            assert 0 <= x < 4
            assert 0 <= y < 4


@pytest.mark.unit
@pytest.mark.tiles
class TestCorridorTileMath:
    """Tests for corridor tile extraction and bounding box pyramids."""

    def test_tiles_for_bbox_pyramid(self):
        bbox = BoundingBox(min_lon=-106.5, min_lat=38.5, max_lon=-106.0, max_lat=39.0)
        tiles = tiles_for_bbox_pyramid(bbox, min_zoom=4, max_zoom=6)
        zooms = {tc.z for tc in tiles}
        assert zooms == {4, 5, 6}
        assert len(tiles) >= 3

    def test_tiles_for_corridor_overview_and_detail(self):
        # Synthetic 3-point route in Colorado
        pts = [
            (38.5, -106.5, 2500.0, 0.0, 0.0),
            (38.7, -106.3, 2800.0, 25.0, 15.5),
            (39.0, -106.0, 3200.0, 60.0, 37.2),
        ]
        # Multi-zoom calculation across z=6..10
        tiles = tiles_for_corridor(pts, zoom_or_min_zoom=6, max_zoom=10)
        assert len(tiles) > 0
        zooms = {tc.z for tc in tiles}
        assert zooms == {6, 7, 8, 9, 10}

        # Single zoom invocation
        single_tiles = tiles_for_corridor(pts, zoom_or_min_zoom=12)
        assert all(tc.z == 12 for tc in single_tiles)

    def test_tiles_for_corridor_empty_points(self):
        assert tiles_for_corridor([], 10) == []

    def test_tiles_for_corridor_invalid_zoom_raises(self):
        with pytest.raises(ValueError, match="cannot exceed max_zoom"):
            tiles_for_corridor([(38.0, -106.0)], zoom_or_min_zoom=12, max_zoom=8)


@pytest.mark.unit
@pytest.mark.tiles
class TestBoundingBoxPolymorphismAndKeywords:
    """Tests verifying all polymorphic signatures and keyword argument patterns for bbox tile queries."""

    @pytest.fixture
    def sample_bbox(self):
        return BoundingBox(min_lon=-106.5, min_lat=38.5, max_lon=-105.5, max_lat=39.5)

    def test_tile_range_for_bbox_keyword_variants_identical_to_positional(self, sample_bbox):
        zoom = 8
        expected = tile_range_for_bbox(sample_bbox, zoom)

        # Keyword BoundingBox + Keyword zoom
        assert tile_range_for_bbox(bbox=sample_bbox, zoom=zoom) == expected

        # Positional BoundingBox + Keyword zoom
        assert tile_range_for_bbox(sample_bbox, zoom=zoom) == expected

        # Keyword BoundingBox + positional zoom slot
        assert tile_range_for_bbox(bbox=sample_bbox, min_lat_or_zoom=zoom) == expected

        # Keyword alias z
        assert tile_range_for_bbox(bbox=sample_bbox, z=zoom) == expected

        # Keyword scalar coordinates
        assert (
            tile_range_for_bbox(
                min_lon=-106.5, min_lat=38.5, max_lon=-105.5, max_lat=39.5, zoom=zoom
            )
            == expected
        )

        # Positional scalar coordinates + keyword zoom
        assert (
            tile_range_for_bbox(-106.5, 38.5, -105.5, 39.5, zoom=zoom)
            == expected
        )

        # All positional scalar coordinates
        assert (
            tile_range_for_bbox(-106.5, 38.5, -105.5, 39.5, zoom)
            == expected
        )

        # Tuple bounds keyword and positional
        bounds_tuple = (-106.5, 38.5, -105.5, 39.5)
        assert tile_range_for_bbox(bounds_tuple, zoom) == expected
        assert tile_range_for_bbox(bbox=bounds_tuple, zoom=zoom) == expected
        assert tile_range_for_bbox(bounds=bounds_tuple, zoom=zoom) == expected

    def test_get_intersecting_tiles_keyword_variants_identical_to_positional(self, sample_bbox):
        zoom = 8
        expected = get_intersecting_tiles(sample_bbox, zoom)

        # Keyword BoundingBox + Keyword zoom
        assert get_intersecting_tiles(bbox=sample_bbox, zoom=zoom) == expected

        # Positional BoundingBox + Keyword zoom
        assert get_intersecting_tiles(sample_bbox, zoom=zoom) == expected

        # Keyword scalar coordinates
        assert (
            get_intersecting_tiles(
                min_lon=-106.5, min_lat=38.5, max_lon=-105.5, max_lat=39.5, zoom=zoom
            )
            == expected
        )

        # Positional scalar coordinates + keyword zoom
        assert (
            get_intersecting_tiles(-106.5, 38.5, -105.5, 39.5, zoom=zoom)
            == expected
        )

        # Tuple bounds keyword and positional
        bounds_tuple = (-106.5, 38.5, -105.5, 39.5)
        assert get_intersecting_tiles(bounds_tuple, zoom) == expected
        assert get_intersecting_tiles(bbox=bounds_tuple, zoom=zoom) == expected

    def test_missing_zoom_raises_type_error(self, sample_bbox):
        with pytest.raises(TypeError, match="zoom must be provided"):
            tile_range_for_bbox(sample_bbox)

        with pytest.raises(TypeError, match="zoom must be provided"):
            tile_range_for_bbox(bbox=sample_bbox)

        with pytest.raises(TypeError, match="zoom must be provided"):
            get_intersecting_tiles(sample_bbox)

        with pytest.raises(TypeError, match="zoom must be provided"):
            get_intersecting_tiles(bbox=sample_bbox)

    def test_missing_coordinates_raises_type_error(self):
        with pytest.raises(TypeError, match="Expected either"):
            tile_range_for_bbox()

        with pytest.raises(TypeError, match="Expected either"):
            tile_range_for_bbox(min_lon=-106.5, min_lat=38.5)

        with pytest.raises(TypeError, match="Expected either"):
            get_intersecting_tiles(min_lon=-106.5, zoom=8)
