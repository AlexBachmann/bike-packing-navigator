"""
engine/tests/test_terrain_surfaces.py - Unit tests for surface interval classification,
5D sequence protocol, zero-length elimination, gap bridging, and aggregate metrics.
"""

import pytest

from engine.terrain.surfaces import (
    SurfaceInterval,
    SurfaceStats,
    SurfaceType,
    classify_surface,
    clean_and_merge_intervals,
    compute_surface_stats,
    firmness_score_to_tracktype,
    generate_route_surfaces,
    infer_firmness,
    tracktype_to_firmness_score,
)


@pytest.mark.unit
class TestSurfaceInterval:
    """Tests for SurfaceInterval dataclass and 5D Sequence Protocol."""

    def test_sequence_protocol_and_indexing(self):
        iv = SurfaceInterval(
            start_km=0.0,
            end_km=12.5,
            highway="unclassified",
            surface="gravel",
            tracktype="grade2"
        )
        # Sequence protocol length
        assert len(iv) == 5

        # Direct indexing
        assert iv[0] == 0.0
        assert iv[1] == 12.5
        assert iv[2] == "unclassified"
        assert iv[3] == "gravel"
        assert iv[4] == "grade2"

        # Slice indexing
        assert iv[0:2] == (0.0, 12.5)

        # Sequence unpacking
        start, end, hw, surf, tt = iv
        assert start == 0.0
        assert end == 12.5
        assert hw == "unclassified"
        assert surf == "gravel"
        assert tt == "grade2"

    def test_invalid_negative_length_raises(self):
        with pytest.raises(ValueError, match="cannot be less than start_km"):
            SurfaceInterval(start_km=10.0, end_km=5.0)

    def test_properties_and_helpers(self):
        iv_paved = SurfaceInterval(0.0, 5.0, "primary", "asphalt", "grade1")
        assert iv_paved.is_paved is True
        assert iv_paved.surface_type == SurfaceType.PAVED
        assert iv_paved.firmness_score == 1
        assert iv_paved.road_class == "primary"
        assert iv_paved.length_km == 5.0

        iv_singletrack = SurfaceInterval(5.0, 10.0, "path", "dirt", "grade4")
        assert iv_singletrack.is_singletrack is True
        assert iv_singletrack.surface_type == SurfaceType.SINGLETRACK
        assert iv_singletrack.firmness_score == 4

    def test_to_list_and_to_dict(self):
        iv = SurfaceInterval(1.234, 5.678, "track", "gravel", "grade2")
        lst = iv.to_list()
        assert lst == [1.2, 5.7, "track", "gravel", "grade2"]

        d = iv.to_dict()
        assert d["start_km"] == 1.234
        assert d["end_km"] == 5.678
        assert d["startKm"] == 1.2
        assert d["endKm"] == 5.7

    def test_from_sequence(self):
        raw = [0.0, 8.4, "tertiary", "paved", "grade1"]
        iv = SurfaceInterval.from_sequence(raw)
        assert iv.start_km == 0.0
        assert iv.end_km == 8.4
        assert iv.highway == "tertiary"
        assert iv.surface == "paved"


@pytest.mark.unit
class TestSurfaceClassificationAndFirmness:
    """Tests for 7 canonical surface types and 1-5 firmness ratings."""

    def test_all_surface_types(self):
        # Sand
        assert classify_surface("path", "sand") == SurfaceType.SAND
        assert classify_surface("", "beach") == SurfaceType.SAND

        # Paved
        assert classify_surface("primary", "asphalt") == SurfaceType.PAVED
        assert classify_surface("secondary", "") == SurfaceType.PAVED
        assert classify_surface("residential", "concrete") == SurfaceType.PAVED

        # Singletrack
        assert classify_surface("path", "dirt") == SurfaceType.SINGLETRACK
        assert classify_surface("footway", "") == SurfaceType.SINGLETRACK

        # Gravel
        assert classify_surface("track", "gravel") == SurfaceType.GRAVEL
        assert classify_surface("unclassified", "compacted") == SurfaceType.GRAVEL
        assert classify_surface("unclassified", "", "grade2") == SurfaceType.GRAVEL

        # Dirt
        assert classify_surface("track", "dirt") == SurfaceType.DIRT
        assert classify_surface("track", "mud") == SurfaceType.DIRT
        assert classify_surface("track", "", "grade4") == SurfaceType.DIRT

        # Unpaved
        assert classify_surface("track", "unpaved") == SurfaceType.UNPAVED
        assert classify_surface("track", "rock") == SurfaceType.UNPAVED

        # Unknown
        assert classify_surface("", "", "") == SurfaceType.UNKNOWN

    def test_firmness_inferences(self):
        assert infer_firmness(surface="asphalt") == 1
        assert infer_firmness(tracktype="grade1") == 1
        assert infer_firmness(surface="gravel") == 2
        assert infer_firmness(tracktype="grade3") == 3
        assert infer_firmness(surface="dirt") == 4
        assert infer_firmness(surface="sand") == 5

        assert tracktype_to_firmness_score("grade4") == 4
        assert firmness_score_to_tracktype(2) == "grade2"


@pytest.mark.unit
class TestCleanAndMergeIntervals:
    """Tests for gap elimination, zero-length filtering, and adjacent merging."""

    def test_zero_length_interval_elimination(self):
        # Legacy bug: production dataset had [0.0, 0.0, ...] as first element
        raw = [
            [0.0, 0.0, "unclassified", "gravel", "grade2"],
            [0.0, 5.0, "unclassified", "gravel", "grade2"],
            [5.0, 5.0, "track", "dirt", "grade4"],
            [5.0, 10.0, "track", "dirt", "grade4"],
        ]
        cleaned = clean_and_merge_intervals(raw, total_km=10.0)
        assert len(cleaned) == 2
        assert cleaned[0].start_km == 0.0
        assert cleaned[0].end_km == 5.0
        assert cleaned[1].start_km == 5.0
        assert cleaned[1].end_km == 10.0

    def test_gap_bridging_and_overlap_clamping(self):
        raw = [
            [1.0, 4.0, "primary", "asphalt", "grade1"],      # Starts at 1.0 (gap from 0.0)
            [6.0, 10.0, "track", "gravel", "grade2"],        # Gap from 4.0 to 6.0
            [9.0, 14.0, "track", "dirt", "grade4"],          # Overlaps 9.0..10.0
        ]
        cleaned = clean_and_merge_intervals(raw, total_km=15.0)

        # 1. First interval extended back to 0.0
        assert cleaned[0].start_km == 0.0
        # 2. Gap 4.0..6.0 bridged by preceding interval
        assert cleaned[0].end_km == 6.0
        # 3. Overlap at 9.0..10.0 clamped
        assert cleaned[1].start_km == 6.0
        assert cleaned[1].end_km == 10.0
        assert cleaned[2].start_km == 10.0
        # 4. Extends to total_km (15.0)
        assert cleaned[2].end_km == 15.0

        # Mathematical continuity assertion across entire route
        for i in range(len(cleaned) - 1):
            assert cleaned[i].end_km == pytest.approx(cleaned[i + 1].start_km)

    def test_adjacent_identical_merging(self):
        raw = [
            [0.0, 3.0, "unclassified", "gravel", "grade2"],
            [3.0, 6.0, "unclassified", "gravel", "grade2"],
            [6.0, 10.0, "unclassified", "gravel", "grade2"],
        ]
        cleaned = clean_and_merge_intervals(raw, total_km=10.0)
        assert len(cleaned) == 1
        assert cleaned[0].start_km == 0.0
        assert cleaned[0].end_km == 10.0

    def test_empty_intervals_default_fallback(self):
        cleaned = clean_and_merge_intervals([], total_km=25.0)
        assert len(cleaned) == 1
        assert cleaned[0].start_km == 0.0
        assert cleaned[0].end_km == 25.0


@pytest.mark.unit
class TestComputeSurfaceStats:
    """Tests for aggregate metrics calculation."""

    def test_surface_stats_percentages_and_weighted_firmness(self):
        intervals = [
            SurfaceInterval(0.0, 50.0, "primary", "asphalt", "grade1"),     # 50km paved (firmness 1)
            SurfaceInterval(50.0, 100.0, "track", "gravel", "grade2"),      # 50km gravel (firmness 2)
        ]
        stats = compute_surface_stats(intervals, total_km=100.0)
        assert stats.total_km == 100.0
        assert stats.paved_km == 50.0
        assert stats.paved_pct == 50.0
        assert stats.gravel_km == 50.0
        assert stats.gravel_pct == 50.0
        assert stats.avg_firmness == 1.5  # (50*1 + 50*2) / 100 = 1.5

        d = stats.to_dict()
        assert d["paved_pct"] == 50.0
        assert d["avg_firmness"] == 1.5


@pytest.mark.unit
class TestGenerateRouteSurfaces:
    """Tests for end-to-end route surfaces generation."""

    def test_fallback_when_no_osm_provided(self):
        track_points = [
            (38.0, -106.0, 2000.0, 0.0, 0.0),
            (38.5, -106.5, 2500.0, 50.0, 31.0),
        ]
        intervals = generate_route_surfaces(track_points)
        assert len(intervals) == 1
        assert intervals[0].start_km == 0.0
        assert intervals[0].end_km == 50.0

    def test_empty_track_returns_empty_list(self):
        assert generate_route_surfaces([]) == []
