"""
engine/tests/test_utils_tiles.py - Unit tests for Slippy tile math in engine.utils.tiles.
"""

import pytest
from engine.utils.tiles import (
    latlon_to_tile,
    lonlat_to_tile,
    tile_to_bounds,
    tile_range_for_bbox,
    get_intersecting_tiles,
    mvt_pixel_to_lonlat,
    lonlat_to_mvt_pixel,
    dem_tile_name,
)


@pytest.mark.unit
@pytest.mark.tiles
class TestSlippyTiles:
    """Tests for Web Mercator and Slippy Tile coordinates."""

    def test_zoom_zero_tile(self, tile_benchmarks):
        data = tile_benchmarks["zoom0"]
        tx, ty = latlon_to_tile(data["lat"], data["lon"], data["z"])
        assert (tx, ty) == data["expected_tile"]

        # Test both lonlat and latlon variants
        tx2, ty2 = lonlat_to_tile(data["lon"], data["lat"], data["z"])
        assert (tx2, ty2) == data["expected_tile"]

    def test_known_locations(self, tile_benchmarks):
        london = tile_benchmarks["zoom10_london"]
        tx, ty = latlon_to_tile(london["lat"], london["lon"], london["z"])
        assert (tx, ty) == london["expected_tile"]

        paris = tile_benchmarks["zoom10_paris"]
        tx, ty = latlon_to_tile(paris["lat"], paris["lon"], paris["z"])
        assert (tx, ty) == paris["expected_tile"]

        london14 = tile_benchmarks["zoom14_london"]
        tx14, ty14 = latlon_to_tile(london14["lat"], london14["lon"], london14["z"])
        assert (tx14, ty14) == london14["expected_tile"]

    def test_tile_boundary_edge_cases(self):
        # Longitude boundaries
        assert latlon_to_tile(0.0, -180.0, 10)[0] == 0
        assert latlon_to_tile(0.0, 179.9999, 10)[0] == 1023

        # Web Mercator latitude boundaries
        assert latlon_to_tile(85.0511, 0.0, 10)[1] == 0
        assert latlon_to_tile(-85.0511, 0.0, 10)[1] == 1023

        # Extreme latitudes clamped safely
        tx, ty = latlon_to_tile(89.9, 0.0, 10)
        assert ty == 0
        tx, ty = latlon_to_tile(-89.9, 0.0, 10)
        assert ty == 1023

    def test_tile_to_bounds_inversion_and_consistency(self):
        for z in [0, 5, 10, 14]:
            tx = 0 if z == 0 else 2 ** (z - 1)
            ty = 0 if z == 0 else 2 ** (z - 1)
            # test (tx, ty, z) signature
            w, s, e, n = tile_to_bounds(tx, ty, z)
            assert w < e, f"West lon must be < East lon at zoom {z}"
            assert s < n, f"South lat must be < North lat at zoom {z}"

            # Tile center should project back to the same tile
            center_lat = (s + n) / 2.0
            center_lon = (w + e) / 2.0
            rtx, rty = latlon_to_tile(center_lat, center_lon, z)
            assert (rtx, rty) == (tx, ty)

    def test_tile_to_bounds_alternative_signatures(self):
        # Test keyword arguments
        w, s, e, n = tile_to_bounds(tx=511, ty=340, zoom=10)
        assert w < e and s < n

        # Test zoom-first order
        w2, s2, e2, n2 = tile_to_bounds(10, 511, 340)
        assert (w, s, e, n) == (w2, s2, e2, n2)

    def test_tile_to_bounds_positional_disambiguation(self):
        """Verify robust disambiguation of positional parameters."""
        # 1. Unambiguous (zoom, x, y): last argument > 30 cannot be zoom
        b_zxy_1 = tile_to_bounds(10, 511, 340)
        assert b_zxy_1 == tile_to_bounds(zoom=10, x=511, y=340)

        # 2. Unambiguous (zoom, x, y): y <= 30, but coords out of bounds for zoom c
        # (tile_to_bounds(10, 5, 2): at zoom 2 max coord is 3, so 10 cannot be tx/ty)
        b_zxy_2 = tile_to_bounds(10, 5, 2)
        assert b_zxy_2 == tile_to_bounds(zoom=10, x=5, y=2)

        # 3. Unambiguous (tx, ty, zoom): first argument > 30 cannot be zoom
        b_xyz_1 = tile_to_bounds(511, 340, 10)
        assert b_xyz_1 == tile_to_bounds(tx=511, ty=340, zoom=10)

        # 4. Unambiguous (tx, ty, zoom): a <= 30, but coords out of bounds for zoom a
        # (tile_to_bounds(2, 5, 10): at zoom 2 max coord is 3, so a=2 cannot be zoom)
        b_xyz_2 = tile_to_bounds(2, 5, 10)
        assert b_xyz_2 == tile_to_bounds(tx=2, ty=5, zoom=10)

        # 5. Ambiguous low-zoom coordinates default canonically to (tx, ty, zoom)
        b_amb = tile_to_bounds(4, 2, 3)
        assert b_amb == tile_to_bounds(tx=4, ty=2, zoom=3)

        # Explicit keywords differentiate when low-zoom values are ambiguous
        b_kw = tile_to_bounds(zoom=4, x=2, y=3)
        assert b_amb != b_kw
        assert b_kw[0] == pytest.approx(-135.0)

    def test_tile_to_bounds_invalid_coordinates_raise(self):
        """Verify invalid tile coordinates and zoom levels raise appropriate exceptions."""
        # Missing arguments
        with pytest.raises(TypeError, match="requires"):
            tile_to_bounds(10, 20)

        # Coordinate out of bounds for zoom level
        with pytest.raises(ValueError, match="out of bounds"):
            tile_to_bounds(tx=10, ty=10, zoom=2)

        # Completely invalid coordinates
        with pytest.raises(ValueError, match="Invalid tile coordinates"):
            tile_to_bounds(100, 100, 100)

        # Zoom level beyond Web Mercator limit (> 30)
        with pytest.raises(ValueError, match="out of bounds"):
            tile_to_bounds(tx=0, ty=0, zoom=35)

    def test_tile_to_bounds_keyword_aliases(self):
        """Verify interchangeable keyword aliases (z, zoom, x, tx, y, ty)."""
        expected = tile_to_bounds(tx=511, ty=340, zoom=10)
        assert tile_to_bounds(x=511, y=340, z=10) == expected
        assert tile_to_bounds(zoom=10, x=511, y=340) == expected
        assert tile_to_bounds(511, 340, zoom=10) == expected
        assert tile_to_bounds(511, 340, z=10) == expected

    def test_tile_range_for_bbox(self):
        min_tx, min_ty, max_tx, max_ty = tile_range_for_bbox(-0.2, 51.4, -0.05, 51.6, 10)
        assert min_tx <= max_tx
        assert min_ty <= max_ty
        assert (max_tx - min_tx + 1) >= 1

    def test_get_intersecting_tiles(self):
        tiles = get_intersecting_tiles(-0.2, 51.4, -0.05, 51.6, 10)
        assert len(tiles) >= 1
        for z, x, y in tiles:
            assert z == 10

    def test_mvt_pixel_to_lonlat(self):
        # Northwest corner of tile
        lon0, lat0 = mvt_pixel_to_lonlat(10, 511, 340, 0, 0, extent=4096)
        # Southeast corner of tile
        lon1, lat1 = mvt_pixel_to_lonlat(10, 511, 340, 4096, 4096, extent=4096)

        assert lon0 < lon1
        assert lat0 > lat1

    def test_dem_tile_name(self):
        assert dem_tile_name(42, -106) == "Copernicus_DSM_COG_10_N42_00_W106_00_DEM"
        assert dem_tile_name(-33, 151) == "Copernicus_DSM_COG_10_S33_00_E151_00_DEM"
        assert dem_tile_name(0, 0) == "Copernicus_DSM_COG_10_N00_00_E000_00_DEM"
