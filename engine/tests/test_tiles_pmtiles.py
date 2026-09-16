"""
engine/tests/test_tiles_pmtiles.py - Unit tests for PMTiles v3 reading, writing,
corruption detection, extraction, and section slicing.
"""

import gzip
import json
from pathlib import Path
import pytest

from engine.tiles.pmtiles import (
    ArchiveBuildError,
    ArchiveStats,
    CorruptArchiveError,
    ExtractionError,
    PMTilesArchive,
    PMTilesBuilder,
    PMTilesCorridorExtractor,
    PMTilesError,
    PMTilesHeader,
    PMTilesMetadata,
    PMTilesSectionSlicer,
    SectionDefinition,
    TileNotFoundError,
)
from pmtiles.tile import Compression, TileType


@pytest.mark.unit
@pytest.mark.tiles
class TestPMTilesDataModels:
    """Tests for PMTilesHeader and PMTilesMetadata serialization."""

    def test_header_defaults_and_roundtrip(self):
        h = PMTilesHeader(
            version=3,
            min_zoom=2,
            max_zoom=10,
            min_lon=-106.5,
            min_lat=38.5,
            max_lon=-105.5,
            max_lat=39.5,
            center_zoom=6,
            center_lon=-106.0,
            center_lat=39.0,
        )
        d = h.to_dict()
        assert d["tile_type"] == TileType.MVT
        assert d["tile_compression"] == Compression.GZIP
        assert d["min_lon_e7"] == int(-106.5 * 1e7)

        # Parse back
        reader_dict = {
            "version": 3,
            "min_zoom": 2,
            "max_zoom": 10,
            "min_lon_e7": int(-106.5 * 1e7),
            "min_lat_e7": int(38.5 * 1e7),
            "max_lon_e7": int(-105.5 * 1e7),
            "max_lat_e7": int(39.5 * 1e7),
            "center_zoom": 6,
            "center_lon_e7": int(-106.0 * 1e7),
            "center_lat_e7": int(39.0 * 1e7),
            "addressed_tiles_count": 42,
            "tile_entries_count": 42,
            "tile_contents_count": 42,
            "clustered": True,
        }
        h2 = PMTilesHeader.from_dict(reader_dict)
        assert h2.version == 3
        assert h2.min_zoom == 2
        assert h2.max_zoom == 10
        assert h2.min_lon == pytest.approx(-106.5)
        assert h2.addressed_tiles_count == 42

    def test_metadata_defaults_and_roundtrip(self):
        m = PMTilesMetadata(
            name="Test Basemap",
            description="Unit test vector tiles",
            bounds=(-106.5, 38.5, -105.5, 39.5),
            center=(-106.0, 39.0, 6),
            vector_layers=[{"id": "transportation", "fields": {"class": "String"}}],
        )
        d = m.to_dict()
        assert d["name"] == "Test Basemap"
        assert d["bounds"] == "-106.5,38.5,-105.5,39.5"
        assert len(d["vector_layers"]) == 1

        # Parse back
        m2 = PMTilesMetadata.from_dict(d)
        assert m2.name == "Test Basemap"
        assert m2.bounds == (-106.5, 38.5, -105.5, 39.5)
        assert m2.center == (-106.0, 39.0, 6)
        assert len(m2.vector_layers) == 1


@pytest.mark.unit
@pytest.mark.tiles
class TestPMTilesBuilderAndArchive:
    """Tests for PMTilesBuilder atomic writer and PMTilesArchive reader."""

    def test_build_and_read_micro_archive(self, tmp_path):
        archive_path = tmp_path / "micro.pmtiles"
        builder = PMTilesBuilder(
            archive_path,
            header=PMTilesHeader(min_zoom=0, max_zoom=2),
            metadata=PMTilesMetadata(name="Micro Archive", description="Testing PMTiles builder")
        )

        # Add 3 dummy MVT tile payloads (raw bytes compressed automatically by builder)
        payload0 = b"\x00\x01\x02\x03TileZeroPayload"
        payload1 = b"\x00\x01\x02\x03TileOnePayload"
        payload2 = b"\x00\x01\x02\x03TileTwoPayload"

        builder.add_tile(0, 0, 0, payload0, compress=True)
        builder.add_tile(1, 0, 0, payload1, compress=True)
        builder.add_tile(2, 1, 1, payload2, compress=True)

        res_path = builder.finalize()
        assert res_path.exists()
        assert res_path == archive_path
        assert archive_path.stat().st_size > 100

        # Read back using PMTilesArchive
        with PMTilesArchive(archive_path) as arch:
            assert arch.validate() is True
            h = arch.header
            assert h.version == 3
            assert h.addressed_tiles_count == 3
            assert arch.metadata.name == "Micro Archive"

            # Check tile presence
            assert arch.has_tile(0, 0, 0) is True
            assert arch.has_tile(1, 0, 0) is True
            assert arch.has_tile(2, 1, 1) is True
            assert arch.has_tile(2, 0, 0) is False

            # Check tile decompression
            data0 = arch.get_tile(0, 0, 0, decompress=True)
            assert data0 == payload0
            data2 = arch.get_tile(2, 1, 1, decompress=True)
            assert data2 == payload2

            # Stats inspection
            stats = arch.get_stats()
            assert isinstance(stats, ArchiveStats)
            assert stats.tile_count == 3
            assert stats.is_valid is True

    def test_empty_builder_finalize_raises(self, tmp_path):
        builder = PMTilesBuilder(tmp_path / "empty.pmtiles")
        with pytest.raises(ArchiveBuildError, match="Cannot finalize empty"):
            builder.finalize()


@pytest.mark.unit
@pytest.mark.tiles
class TestCorruptionDetection:
    """Tests for corrupted or invalid PMTiles archive detection."""

    def test_nonexistent_archive_raises(self, tmp_path):
        arch = PMTilesArchive(tmp_path / "does_not_exist.pmtiles")
        with pytest.raises(FileNotFoundError):
            arch.open()

    def test_plain_text_corrupt_archive_raises(self, tmp_path):
        corrupt_file = tmp_path / "fake.pmtiles"
        corrupt_file.write_text("This is not a binary PMTiles archive")

        arch = PMTilesArchive(corrupt_file)
        with pytest.raises(CorruptArchiveError):
            arch.open()

    def test_known_corrupt_sample_file(self):
        sample_path = Path("public/data/routes/sample-corridor.pmtiles")
        if sample_path.exists():
            arch = PMTilesArchive(sample_path)
            with pytest.raises(CorruptArchiveError):
                arch.open()

    def test_unsupported_version_byte_raises(self, tmp_path):
        # Version 2 header (e.g. b"PMTiles\x02" + padding)
        v2_file = tmp_path / "version2.pmtiles"
        v2_file.write_bytes(b"PMTiles\x02" + b"\x00" * 120)

        arch = PMTilesArchive(v2_file)
        with pytest.raises(CorruptArchiveError, match="Unsupported PMTiles version"):
            arch.open()

        # Version 4 header (e.g. b"PMTiles\x04" + padding)
        v4_file = tmp_path / "version4.pmtiles"
        v4_file.write_bytes(b"PMTiles\x04" + b"\x00" * 120)

        arch4 = PMTilesArchive(v4_file)
        with pytest.raises(CorruptArchiveError, match="Unsupported PMTiles version"):
            arch4.open()

    def test_truncated_header_raises(self, tmp_path):
        # Header shorter than 8 bytes
        short_file = tmp_path / "short.pmtiles"
        short_file.write_bytes(b"PMTile")

        arch = PMTilesArchive(short_file)
        with pytest.raises(CorruptArchiveError, match="Invalid PMTiles magic bytes"):
            arch.open()


@pytest.mark.unit
@pytest.mark.tiles
class TestMasterSourceExtraction:
    """Tests for extracting tile subsets from a source master archive."""

    def test_extract_subset_from_master(self, tmp_path):
        master_path = tmp_path / "master.pmtiles"
        builder = PMTilesBuilder(master_path, header=PMTilesHeader(min_zoom=0, max_zoom=2))
        builder.add_tile(0, 0, 0, b"Payload0")
        builder.add_tile(1, 0, 0, b"Payload1_0_0")
        builder.add_tile(1, 1, 0, b"Payload1_1_0")
        builder.add_tile(2, 1, 1, b"Payload2_1_1")
        builder.finalize()

        # Extract only (0, 0, 0) and (1, 1, 0)
        sub_path = tmp_path / "subset.pmtiles"
        extracted_count = PMTilesCorridorExtractor.extract_from_source(
            source_archive=master_path,
            output_path=sub_path,
            tiles=[(0, 0, 0), (1, 1, 0)]
        )
        assert extracted_count == 2
        assert sub_path.exists()

        with PMTilesArchive(sub_path) as sub_arch:
            assert sub_arch.has_tile(0, 0, 0) is True
            assert sub_arch.has_tile(1, 1, 0) is True
            assert sub_arch.has_tile(1, 0, 0) is False

    def test_extract_zero_tiles_raises_extraction_error(self, tmp_path):
        master_path = tmp_path / "master.pmtiles"
        builder = PMTilesBuilder(master_path, header=PMTilesHeader(min_zoom=0, max_zoom=2))
        builder.add_tile(0, 0, 0, b"Payload0")
        builder.finalize()

        with pytest.raises(ExtractionError, match="0 tiles extracted"):
            PMTilesCorridorExtractor.extract_from_source(
                source_archive=master_path,
                output_path=tmp_path / "empty_sub.pmtiles",
                tiles=[(5, 10, 10)]  # not present in master
            )

    def test_extractor_instance_extract_corridor(self, tmp_path):
        master_path = tmp_path / "master.pmtiles"
        builder = PMTilesBuilder(master_path, header=PMTilesHeader(min_zoom=0, max_zoom=2))
        builder.add_tile(0, 0, 0, b"Payload0")
        builder.add_tile(1, 0, 0, b"Payload1_0_0")
        builder.finalize()

        corridor_path = tmp_path / "corridor.geojson"
        corridor_path.write_text(json.dumps({
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [-180.0, -85.0],
                        [180.0, -85.0],
                        [180.0, 85.0],
                        [-180.0, 85.0],
                        [-180.0, -85.0]
                    ]]
                }
            }]
        }), encoding="utf-8")

        sub_path = tmp_path / "clipped.pmtiles"
        extractor = PMTilesCorridorExtractor(master_path)
        out = extractor.extract_corridor(corridor_path, sub_path, min_zoom=0, max_zoom=2)
        assert out == sub_path
        assert sub_path.exists()
        with PMTilesArchive(sub_path) as arch:
            assert arch.validate() is True
            assert arch.get_stats().tile_count > 0


@pytest.mark.unit
@pytest.mark.tiles
class TestSectionSlicer:
    """Tests for regional section slicing with boundary overlaps."""

    def test_slice_archive(self, tmp_path):
        # Create a master archive with tiles covering zooms 0..2
        master_path = tmp_path / "corridor.pmtiles"
        builder = PMTilesBuilder(master_path, header=PMTilesHeader(min_zoom=0, max_zoom=2))
        builder.add_tile(0, 0, 0, b"GlobalRoot")
        builder.add_tile(1, 0, 0, b"NorthTile")
        builder.add_tile(1, 0, 1, b"SouthTile")
        builder.finalize()

        # Track points: North (lat >= 45.0) and South (lat < 45.0)
        track_points = [
            (46.0, -110.0, 1500.0, 0.0, 0.0),
            (45.5, -110.0, 1600.0, 50.0, 31.0),
            (44.0, -110.0, 1800.0, 120.0, 74.5),
            (43.0, -110.0, 1700.0, 200.0, 124.0),
        ]

        sections = [
            SectionDefinition("1", "North Section", "section-1.pmtiles", lat_min=44.95),
            SectionDefinition("2", "South Section", "section-2.pmtiles", lat_max=45.05),
        ]

        created = PMTilesSectionSlicer.slice_archive(
            master_archive_path=master_path,
            route_dir=tmp_path,
            sections=sections,
            track_points=track_points
        )

        assert len(created) == 2
        assert (tmp_path / "section-1.pmtiles").exists()
        assert (tmp_path / "section-2.pmtiles").exists()

    def test_slicer_instance_slice_archive(self, tmp_path):
        master_path = tmp_path / "corridor.pmtiles"
        builder = PMTilesBuilder(master_path, header=PMTilesHeader(min_zoom=0, max_zoom=2))
        builder.add_tile(0, 0, 0, b"GlobalRoot")
        builder.add_tile(1, 0, 0, b"NorthTile")
        builder.add_tile(1, 0, 1, b"SouthTile")
        builder.finalize()

        track_json = tmp_path / "route-track.json"
        track_json.write_text(json.dumps({
            "points": [
                [46.0, -110.0, 1500.0, 0.0, 0.0],
                [43.0, -110.0, 1700.0, 200.0, 124.0]
            ]
        }), encoding="utf-8")

        sections_json = tmp_path / "sections.json"
        sections_json.write_text(json.dumps([
            {"section_id": "1", "name": "North", "filename": "sec-1.pmtiles", "lat_min": 44.95},
            {"section_id": "2", "name": "South", "filename": "sec-2.pmtiles", "lat_max": 45.05}
        ]), encoding="utf-8")

        out_dir = tmp_path / "sections_out"
        slicer = PMTilesSectionSlicer(master_path)
        created = slicer.slice_archive(
            track_path=track_json,
            output_dir=out_dir,
            sections_config=sections_json
        )
        assert len(created) == 2
        assert (out_dir / "sec-1.pmtiles").exists()
        assert (out_dir / "sec-2.pmtiles").exists()


@pytest.mark.unit
@pytest.mark.tiles
class TestSyntheticCorridorBuilder:
    """Tests for offline synthetic MVT corridor builder."""

    def test_build_synthetic_corridor(self, tmp_path):
        route_dir = tmp_path / "synthetic_route"
        route_dir.mkdir()

        # Create mock route-track.json
        track_data = {
            "points": [
                [38.5, -106.5, 2500.0, 0.0, 0.0],
                [38.7, -106.3, 2800.0, 25.0, 15.5],
                [39.0, -106.0, 3200.0, 60.0, 37.2],
            ]
        }
        (route_dir / "route-track.json").write_text(gzip.decompress(gzip.compress(str(track_data).replace("'", '"').encode())).decode())

        out_pmtiles = route_dir / "corridor.pmtiles"
        bbox = (-106.5, 38.5, -106.0, 39.0)

        tile_count = PMTilesCorridorExtractor.build_synthetic_corridor(
            route_dir=route_dir,
            output_path=out_pmtiles,
            bbox=bbox,
            min_zoom=0,
            max_zoom=4
        )

        assert tile_count > 0
        assert out_pmtiles.exists()

        with PMTilesArchive(out_pmtiles) as arch:
            assert arch.validate() is True
            stats = arch.get_stats()
            assert stats.tile_count == tile_count
            assert "transportation" in stats.layer_names
            assert "natural" in stats.layer_names
