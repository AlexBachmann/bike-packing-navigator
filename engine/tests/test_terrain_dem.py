"""
engine/tests/test_terrain_dem.py - Unit tests for Copernicus 30m DEM tile math,
intersecting tile calculation, atomic caching, and bilinear raster elevation sampling.
"""

from pathlib import Path
import pytest

from engine.terrain.dem import (
    DemTile,
    ElevationSample,
    ElevationSampler,
    calculate_intersecting_dem_tiles,
    create_synthetic_dem_cog,
    download_dem_tile,
    get_dem_tile_name,
)
from engine.utils.spatial import BoundingBox


@pytest.mark.unit
class TestDemTileMath:
    """Tests for DEM tile naming and intersecting tile calculation."""

    def test_get_dem_tile_name_hemispheres(self):
        # Northern & Western (e.g. Colorado / US Rockies)
        assert get_dem_tile_name(38, -106) == "Copernicus_DSM_COG_10_N38_00_W106_00_DEM"
        # Southern & Eastern (e.g. Sydney, Australia)
        assert get_dem_tile_name(-33, 151) == "Copernicus_DSM_COG_10_S33_00_E151_00_DEM"
        # Equator & Prime Meridian
        assert get_dem_tile_name(0, 0) == "Copernicus_DSM_COG_10_N00_00_E000_00_DEM"

    def test_calculate_intersecting_dem_tiles_single_cell(self):
        pts = [
            (38.1, -105.8),
            (38.5, -105.5),
            (38.9, -105.2),
        ]
        tiles = calculate_intersecting_dem_tiles(pts)
        assert len(tiles) == 1
        assert tiles[0].lat == 38
        assert tiles[0].lon == -106
        assert tiles[0].name == "Copernicus_DSM_COG_10_N38_00_W106_00_DEM"

    def test_calculate_intersecting_dem_tiles_multi_cell_crossing(self):
        # Route crossing latitude 39.0 boundary (38.8 -> 39.2)
        pts = [
            (38.8, -106.5),
            (39.2, -106.5),
        ]
        tiles = calculate_intersecting_dem_tiles(pts)
        assert len(tiles) == 2
        lats = [t.lat for t in tiles]
        assert 38 in lats
        assert 39 in lats
        # Deterministic sort North to South
        assert tiles[0].lat == 39
        assert tiles[1].lat == 38

    def test_calculate_intersecting_dem_tiles_bounding_box(self):
        bbox = BoundingBox(min_lon=-106.5, min_lat=38.2, max_lon=-105.5, max_lat=39.5)
        tiles = calculate_intersecting_dem_tiles(bbox)
        # Should cover lat in [38, 39] and lon in [-107, -106] -> 2x2 = 4 tiles
        assert len(tiles) == 4
        names = {t.name for t in tiles}
        assert "Copernicus_DSM_COG_10_N39_00_W107_00_DEM" in names
        assert "Copernicus_DSM_COG_10_N38_00_W106_00_DEM" in names

    def test_calculate_intersecting_dem_tiles_empty(self):
        assert calculate_intersecting_dem_tiles([]) == []


@pytest.mark.unit
class TestDownloadDemTile:
    """Tests for DEM downloading and atomic caching."""

    def test_download_mock_mode(self, tmp_path):
        tile = DemTile(
            lat=38,
            lon=-106,
            name="Copernicus_DSM_COG_10_N38_00_W106_00_DEM",
            url="https://fake.url/dem.tif"
        )
        dem_file = download_dem_tile(tile, cache_dir=tmp_path, mock_mode=True)
        assert dem_file is not None
        assert dem_file.exists()
        assert dem_file.stat().st_size > 0

    def test_cached_tile_reuse(self, tmp_path):
        tile = DemTile(
            lat=38,
            lon=-106,
            name="Copernicus_DSM_COG_10_N38_00_W106_00_DEM",
            url="https://fake.url/dem.tif"
        )
        # Pre-create cached tile
        cached_file = tmp_path / f"{tile.name}.tif"
        cached_file.write_bytes(b"A" * 2000)

        # Download should return cached path without network call
        dem_file = download_dem_tile(tile, cache_dir=tmp_path, mock_mode=False)
        assert dem_file == cached_file
        assert dem_file.stat().st_size == 2000


@pytest.mark.unit
class TestElevationSampler:
    """Tests for continuous mock sampling and bilinear interpolation."""

    def test_mock_sampler_deterministic_and_continuous(self):
        sampler = ElevationSampler(mock_mode=True)
        ele1 = sampler.get_elevation(38.5, -106.5)
        ele2 = sampler.get_elevation(38.5, -106.5)
        assert ele1 == ele2
        assert ele1 > 500.0  # plausible elevation

        # Slight coordinate shift produces smooth change
        ele3 = sampler.get_elevation(38.501, -106.501)
        assert abs(ele3 - ele1) < 5.0

    def test_bilinear_interpolation_with_synthetic_raster(self, tmp_path):
        # Create a real GDAL GeoTIFF for lat=38, lon=-106
        tile_name = get_dem_tile_name(38, -106)
        tif_path = tmp_path / f"{tile_name}.tif"
        create_synthetic_dem_cog(tif_path, lat=38, lon=-106, base_ele=2000.0)

        sampler = ElevationSampler(dem_dir=tmp_path, mock_mode=False)
        ele_a = sampler.get_elevation(38.2, -105.8)
        ele_b = sampler.get_elevation(38.8, -105.2)

        assert ele_a > 1000.0
        assert ele_b > 1000.0
        sampler.close()

    def test_sample_track(self):
        sampler = ElevationSampler(mock_mode=True)
        pts = [
            (38.0, -106.0, 0.0, 0.0, 0.0),
            (38.5, -106.5, 0.0, 50.0, 31.0),
        ]
        samples = sampler.sample_track(pts)
        assert len(samples) == 2
        assert isinstance(samples[0], ElevationSample)
        assert samples[0].lat == 38.0
        assert samples[0].elevation_m > 0.0
